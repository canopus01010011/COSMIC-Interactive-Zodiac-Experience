import type { Point2, TrackedHand } from '../vision/landmarkTypes';
import { palmCenter } from './handGeometry';
import { recognizeShape, type ShapeKind } from './shapeRecognizer';

export const TRACER_CONFIG = {
  /** Palm speed (stage-heights / s) that starts a stroke. */
  startSpeed: 0.28,
  /** Palm speed below which the stroke counts as "paused". */
  stopSpeed: 0.12,
  /** A pause this long finishes the stroke. */
  pauseMs: 330,
  /** Losing the hand this long finishes the stroke. */
  lossMs: 220,
  /** Strokes longer than this are abandoned (not a deliberate shape). */
  maxStrokeMs: 5500,
  minStrokeMs: 450,
  /** Samples closer than this (stage-heights) are skipped. */
  minStep: 0.005,
  /** After a recognised shape, ignore everything for this long. */
  cooldownMs: 2500,
  /** Jumps larger than this between samples mean a tracking glitch: restart the stroke. */
  maxJump: 0.2,
} as const;

export interface SymbolEvent {
  shape: ShapeKind;
  t: number;
  /** Centre of the traced stroke (normalised stage coordinates). */
  center: Point2;
  distance: number;
}

/**
 * Watches ONE open hand moving through the air and recognises a traced "C" or heart.
 * A stroke starts when the palm moves briskly, ends when it pauses (or the hand leaves), and is then
 * matched against the shape templates. Failed strokes are silently discarded.
 */
export class SymbolTracer {
  private pts: Array<Point2 & { t: number }> = [];
  private tracing = false;
  private slowSince: number | null = null;
  private lastT = 0;
  private lostSince: number | null = null;
  private cooldownUntil = 0;
  private smooth: Point2 | null = null;
  private recent: Array<{ x: number; y: number; t: number }> = [];

  /** Points of the stroke in progress (for a UI trail, if wanted). */
  get trail(): readonly Point2[] {
    return this.tracing ? this.pts : [];
  }

  get isTracing(): boolean {
    return this.tracing;
  }

  reset(): void {
    this.pts = [];
    this.tracing = false;
    this.slowSince = null;
    this.lostSince = null;
    this.smooth = null;
    this.recent = [];
  }

  /**
   * @param hands tracked hands this frame (only an exactly-one-hand frame is used)
   * @param enabled false while a star/draw gesture is active, a show is playing, etc.
   */
  update(t: number, hands: readonly TrackedHand[], aspect: number, enabled: boolean): SymbolEvent | null {
    const cfg = TRACER_CONFIG;
    this.lastT = t;
    if (!enabled || t < this.cooldownUntil || hands.length > 1) {
      if (this.tracing || this.pts.length) this.reset();
      return null;
    }
    if (hands.length === 0) {
      if (this.tracing) {
        this.lostSince ??= t;
        if (t - this.lostSince >= cfg.lossMs) return this.finish(t, aspect);
      }
      return null;
    }
    this.lostSince = null;

    const raw = palmCenter(hands[0]);
    // Light smoothing so tracker jitter does not look like a wiggly stroke.
    this.smooth = this.smooth ? { x: this.smooth.x + (raw.x - this.smooth.x) * 0.6, y: this.smooth.y + (raw.y - this.smooth.y) * 0.6 } : raw;
    const p = this.smooth;

    // Speed over the last ~150 ms (stage-heights / s).
    this.recent.push({ x: p.x, y: p.y, t });
    while (this.recent.length > 1 && t - this.recent[0].t > 150) this.recent.shift();
    const first = this.recent[0];
    const span = (t - first.t) / 1000;
    const speed = span > 0.03 ? Math.hypot((p.x - first.x) * aspect, p.y - first.y) / span : 0;

    const last = this.pts[this.pts.length - 1];
    if (last && Math.hypot((p.x - last.x) * aspect, p.y - last.y) > cfg.maxJump) {
      this.reset();
      return null;
    }

    if (!this.tracing) {
      if (speed >= cfg.startSpeed) {
        this.tracing = true;
        this.pts = [{ ...first, t: first.t }];
        this.slowSince = null;
      } else return null;
    }

    if (!last || Math.hypot((p.x - last.x) * aspect, p.y - last.y) >= cfg.minStep) this.pts.push({ x: p.x, y: p.y, t });

    if (t - this.pts[0].t > cfg.maxStrokeMs) {
      this.reset();
      return null;
    }
    if (speed < cfg.stopSpeed) {
      this.slowSince ??= t;
      if (t - this.slowSince >= cfg.pauseMs) return this.finish(t, aspect);
    } else {
      this.slowSince = null;
    }
    return null;
  }

  private finish(t: number, aspect: number): SymbolEvent | null {
    const cfg = TRACER_CONFIG;
    // Drop the trailing pause samples so the resting hand does not bend the end of the stroke.
    let end = this.pts.length;
    if (this.slowSince !== null) {
      const cut = this.slowSince;
      while (end > 8 && this.pts[end - 1].t >= cut) end--;
    }
    const stroke = this.pts.slice(0, end);
    const duration = stroke.length ? stroke[stroke.length - 1].t - stroke[0].t : 0;
    this.reset();
    if (duration < cfg.minStrokeMs) return null;
    const res = recognizeShape(stroke, aspect);
    if (!res.shape) return null;
    let sx = 0;
    let sy = 0;
    for (const p of stroke) {
      sx += p.x;
      sy += p.y;
    }
    this.cooldownUntil = t + cfg.cooldownMs;
    return { shape: res.shape, t, center: { x: sx / stroke.length, y: sy / stroke.length }, distance: res.distance };
  }
}
