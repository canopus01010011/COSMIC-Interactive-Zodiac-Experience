import type { Point2 } from '../vision/landmarkTypes';
import { GESTURE_CONFIG, type GestureConfig } from './gestureConfig';
import { dist } from './handGeometry';

export interface StarHoldResult {
  /** 0..1 progress toward placing a star (for the on-screen ring). */
  progress: number;
  /** Set on the single frame a hold completes. */
  placed: Point2 | null;
}

/**
 * Mode 1 - star summoning.
 * A star is placed when the index fingertip stays (nearly) stationary for `holdMs`.
 * After a placement the tracker is disarmed until the fingertip has travelled
 * `rearmDistance` away, so one hold can never place more than one star.
 */
export class StarHoldTracker {
  private anchor: Point2 | null = null;
  private anchorSince = 0;
  private armed = true;
  private lastPlaced: Point2 | null = null;

  constructor(private readonly cfg: GestureConfig = GESTURE_CONFIG) {}

  update(t: number, cursor: Point2 | null, active: boolean, aspect: number): StarHoldResult {
    if (!active || !cursor) {
      // Releasing the gesture re-arms it (a brand-new hold is a deliberate new action).
      this.anchor = null;
      this.armed = true;
      this.lastPlaced = null;
      return { progress: 0, placed: null };
    }

    if (!this.armed) {
      if (this.lastPlaced && dist(cursor, this.lastPlaced, aspect) > this.cfg.star.rearmDistance) {
        this.armed = true;
        this.anchor = cursor;
        this.anchorSince = t;
      }
      return { progress: 0, placed: null };
    }

    if (!this.anchor || dist(cursor, this.anchor, aspect) > this.cfg.star.holdRadius) {
      this.anchor = cursor;
      this.anchorSince = t;
      return { progress: 0, placed: null };
    }

    const progress = Math.min(1, (t - this.anchorSince) / this.cfg.star.holdMs);
    if (progress >= 1) {
      const placed = { x: this.anchor.x, y: this.anchor.y };
      this.armed = false;
      this.lastPlaced = placed;
      this.anchor = null;
      return { progress: 1, placed };
    }
    return { progress, placed: null };
  }

  reset(): void {
    this.anchor = null;
    this.armed = true;
    this.lastPlaced = null;
  }
}
