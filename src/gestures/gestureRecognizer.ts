import type { Point2, TrackedHand, VisionFrame } from '../vision/landmarkTypes';
import { DrawingTracker, type DrawEndReason } from './drawingGesture';
import { FinishGestureDetector } from './finishGesture';
import { GESTURE_CONFIG, type GestureConfig } from './gestureConfig';
import { analyzeHand, dist, palmCenter, type PoseKind } from './handGeometry';
import { OneEuroFilter2D } from './smoothing';
import { StarHoldTracker } from './starGesture';

export type GestureKind = PoseKind;

export type GestureEvent =
  | { type: 'STAR_HOLD'; point: Point2; t: number }
  | { type: 'DRAW_START'; point: Point2; t: number }
  | { type: 'DRAW_MOVE'; point: Point2; t: number }
  | { type: 'DRAW_END'; reason: DrawEndReason; t: number }
  | { type: 'FINISH_GESTURE'; t: number };

/** The GestureState data object from the specification. */
export interface GestureState {
  activeGesture: GestureKind;
  /** 0..1: 1 when the gesture is confirmed, otherwise progress through the confirmation interval. */
  confidence: number;
  startTime: number;
  lastPosition: Point2 | null;
  /** Smoothed fingertip cursor (null when there is no pointing hand). */
  cursor: Point2 | null;
  /** 0..1 progress of the stationary star hold. */
  holdProgress: number;
  handsVisible: number;
  /** Gesture the pose classifier currently sees (before temporal confirmation). */
  candidate: GestureKind;
}

export interface GestureUpdate {
  state: GestureState;
  events: GestureEvent[];
}

export interface EnabledGestures {
  star: boolean;
  draw: boolean;
  finishGesture: boolean;
}

/**
 * Turns per-frame hand landmarks into stable semantic events.
 *
 * Stability comes from four mechanisms: (1) landmark-geometry classification with hysteresis,
 * (2) a time-based confirmation interval before a mode becomes active, (3) a One-Euro filtered
 * cursor, and (4) cooldowns / re-arm rules in the star and finish-gesture detectors.
 */
export class GestureRecognizer {
  readonly enabled: EnabledGestures = { star: true, draw: true, finishGesture: true };

  private active: GestureKind = 'none';
  private candidate: GestureKind = 'none';
  private pending: GestureKind | null = null;
  private pendingSince = 0;
  private startTime = 0;
  private lastSeenT = -Infinity;
  private lastPosition: Point2 | null = null;
  private lastPalm: Point2 | null = null;
  private lastCandidatePose: PoseKind = 'none';
  private cursor: Point2 | null = null;
  private confidence = 1;
  private holdProgress = 0;

  private readonly cursorFilter: OneEuroFilter2D;
  private readonly star: StarHoldTracker;
  private readonly draw: DrawingTracker;
  private readonly finishGesture: FinishGestureDetector;

  constructor(private readonly cfg: GestureConfig = GESTURE_CONFIG) {
    this.cursorFilter = new OneEuroFilter2D(cfg.cursor.minCutoff, cfg.cursor.beta);
    this.star = new StarHoldTracker(cfg);
    this.draw = new DrawingTracker(cfg);
    this.finishGesture = new FinishGestureDetector(cfg);
  }

  update(frame: VisionFrame): GestureUpdate {
    const { t, aspect } = frame;
    const events: GestureEvent[] = [];
    const hands = frame.hands.filter((h) => h.score >= this.cfg.minScore);
    if (hands.length > 0) this.lastSeenT = t;

    const lost = hands.length === 0 && t - this.lastSeenT > this.cfg.lossGraceMs;

    // 1. Classify the hands and pick the one that is "pointing".
    const pick = this.pickHand(hands, aspect);
    let raw: GestureKind = pick ? pick.pose : 'none';
    if (raw !== 'none' && !this.enabled[raw]) raw = 'none';
    this.candidate = raw;
    this.lastCandidatePose = raw;

    // 2. Temporal confirmation with hysteresis (time-based, frame-rate independent).
    if (lost) {
      this.forceNone();
    } else if (hands.length > 0 || this.active === 'none') {
      this.stabilise(raw, t);
    }

    // 3. Smoothed cursor (only while a pointing pose is visible).
    let cursor: Point2 | null = null;
    if (pick && raw !== 'none') {
      cursor = this.cursorFilter.filter(pick.cursor, t);
      this.lastPosition = cursor;
      this.lastPalm = pick.palm;
    } else {
      this.cursorFilter.reset();
      if (hands.length === 0) this.lastPalm = null;
    }
    this.cursor = cursor;

    // 4. Mode behaviour.
    const starActive = this.active === 'star';
    const drawActive = this.active === 'draw';

    // A pointing mode that is still active but has no cursor this frame (a one-frame pose
    // flicker, or a short tracking dropout inside the grace period) is *paused*, not ended:
    // the mode only ends when the confirmation logic above says so. Nothing is drawn or
    // joined while paused.
    if (!(starActive && cursor === null)) {
      const starRes = this.star.update(t, cursor, starActive, aspect);
      this.holdProgress = starRes.progress;
      if (starRes.placed) events.push({ type: 'STAR_HOLD', point: starRes.placed, t });
    }

    if (!(drawActive && cursor === null)) {
      for (const e of this.draw.update(cursor, drawActive, aspect, lost)) {
        if (e.type === 'DRAW_END') events.push({ type: 'DRAW_END', reason: e.reason, t });
        else events.push({ type: e.type, point: e.point, t });
      }
    }

    // Finish last so an open stroke is closed before the transformation starts.
    if (this.enabled.finishGesture && this.finishGesture.update(t, hands, aspect)) {
      events.push({ type: 'FINISH_GESTURE', t });
    }

    return { state: this.getState(hands.length), events };
  }

  getState(handsVisible = 0): GestureState {
    return {
      activeGesture: this.active,
      confidence: this.confidence,
      startTime: this.startTime,
      lastPosition: this.lastPosition,
      cursor: this.cursor,
      holdProgress: this.holdProgress,
      handsVisible,
      candidate: this.candidate,
    };
  }

  /** Cancel everything in flight (closing any open stroke). Returns the events produced. */
  reset(t = 0): GestureEvent[] {
    const events: GestureEvent[] = this.draw.reset().map((e) => ({
      type: 'DRAW_END' as const,
      reason: (e.type === 'DRAW_END' ? e.reason : 'released') as DrawEndReason,
      t,
    }));
    this.active = 'none';
    this.candidate = 'none';
    this.pending = null;
    this.confidence = 1;
    this.holdProgress = 0;
    this.cursor = null;
    this.lastPosition = null;
    this.lastPalm = null;
    this.lastCandidatePose = 'none';
    this.cursorFilter.reset();
    this.star.reset();
    this.finishGesture.reset();
    return events;
  }

  private forceNone(): void {
    this.active = 'none';
    this.pending = null;
    this.confidence = 1;
    this.lastCandidatePose = 'none';
  }

  private stabilise(raw: GestureKind, t: number): void {
    if (raw === this.active) {
      this.pending = null;
      this.confidence = 1;
      return;
    }
    if (raw !== this.pending) {
      this.pending = raw;
      this.pendingSince = t;
    }
    const needed = this.cfg.confirmMs[raw];
    this.confidence = Math.min(1, (t - this.pendingSince) / needed);
    if (t - this.pendingSince >= needed) {
      this.active = raw;
      this.startTime = t;
      this.pending = null;
      this.confidence = 1;
      // A mode switch must not inherit the previous mode's smoothing state.
      this.cursorFilter.reset();
    }
  }

  private pickHand(
    hands: TrackedHand[],
    aspect: number,
  ): { pose: PoseKind; cursor: Point2; palm: Point2 } | null {
    if (hands.length === 0) return null;

    // Hysteresis (previous pose) only applies to the hand we were already following.
    let followed = -1;
    if (this.lastPalm) {
      let best = Infinity;
      hands.forEach((h, i) => {
        const d = dist(palmCenter(h), this.lastPalm as Point2, aspect);
        if (d < best) {
          best = d;
          followed = i;
        }
      });
      if (best > 0.25) followed = -1;
    }

    let chosen: { pose: PoseKind; cursor: Point2; palm: Point2; score: number } | null = null;
    hands.forEach((h, i) => {
      const prev: PoseKind = i === followed ? this.lastCandidatePose : 'none';
      const a = analyzeHand(h, aspect, prev);
      if (a.pose === 'none' || !this.enabled[a.pose]) return;
      const palm = palmCenter(h);
      // Prefer the hand we were already following, otherwise the most confident one.
      const score = h.score + (i === followed ? 1 : 0);
      if (!chosen || score > chosen.score) chosen = { pose: a.pose, cursor: a.cursor, palm, score };
    });

    if (chosen) {
      const c = chosen as { pose: PoseKind; cursor: Point2; palm: Point2 };
      return { pose: c.pose, cursor: c.cursor, palm: c.palm };
    }
    // No pointing hand: report none but keep the first hand's palm for continuity.
    return { pose: 'none', cursor: { x: 0, y: 0 }, palm: palmCenter(hands[0]) };
  }
}
