import type { Point2 } from '../vision/landmarkTypes';
import { GESTURE_CONFIG, type GestureConfig } from './gestureConfig';
import { dist } from './handGeometry';

export type DrawEndReason = 'released' | 'tracking-lost' | 'jump';

export type DrawEvent =
  | { type: 'DRAW_START'; point: Point2 }
  | { type: 'DRAW_MOVE'; point: Point2 }
  | { type: 'DRAW_END'; reason: DrawEndReason };

/**
 * Mode 2 - celestial drawing.
 * Drawing is active only while the two-finger pose is held. Tiny movements are ignored,
 * and if tracking is lost or the cursor teleports the stroke is ended instead of being
 * joined to a distant point by an unintended line.
 */
export class DrawingTracker {
  private drawing = false;
  private last: Point2 | null = null;

  constructor(private readonly cfg: GestureConfig = GESTURE_CONFIG) {}

  get isDrawing(): boolean {
    return this.drawing;
  }

  update(cursor: Point2 | null, active: boolean, aspect: number, trackingLost = false): DrawEvent[] {
    const events: DrawEvent[] = [];

    if (!active || !cursor) {
      if (this.drawing) {
        events.push({ type: 'DRAW_END', reason: trackingLost ? 'tracking-lost' : 'released' });
        this.drawing = false;
        this.last = null;
      }
      return events;
    }

    if (!this.drawing) {
      this.drawing = true;
      this.last = cursor;
      events.push({ type: 'DRAW_START', point: cursor });
      return events;
    }

    const d = this.last ? dist(cursor, this.last, aspect) : 0;
    if (d > this.cfg.draw.maxJump) {
      // Tracking glitch / teleport: finish this stroke and begin a fresh one.
      events.push({ type: 'DRAW_END', reason: 'jump' });
      events.push({ type: 'DRAW_START', point: cursor });
      this.last = cursor;
      return events;
    }
    if (d >= this.cfg.draw.minSegment) {
      this.last = cursor;
      events.push({ type: 'DRAW_MOVE', point: cursor });
    }
    return events;
  }

  reset(): DrawEvent[] {
    const events: DrawEvent[] = this.drawing ? [{ type: 'DRAW_END', reason: 'tracking-lost' }] : [];
    this.drawing = false;
    this.last = null;
    return events;
  }
}
