import { GESTURE_CONFIG, type GestureConfig } from '../gestures/gestureConfig';
import { dist } from '../gestures/handGeometry';
import type { Point2 } from '../vision/landmarkTypes';
import type { Stroke } from './constellationTypes';
import type { StarManager } from './starManager';

export class StrokeManager {
  private _strokes: Stroke[] = [];
  private _current: Stroke | null = null;
  private nextId = 1;
  aspect = 16 / 9;

  constructor(private readonly cfg: GestureConfig = GESTURE_CONFIG) {}

  get strokes(): readonly Stroke[] {
    return this._strokes;
  }

  /** The stroke currently being drawn (already visible, not yet committed). */
  get current(): Stroke | null {
    return this._current;
  }

  begin(p: Point2, t: number): Stroke | null {
    if (this._current) this.cancelCurrent();
    if (this._strokes.length >= this.cfg.draw.maxStrokes) return null;
    this._current = {
      id: this.nextId++,
      points: [{ x: p.x, y: p.y }],
      color: '#f4f6ff',
      width: 1,
      createdAt: t,
    };
    return this._current;
  }

  extend(p: Point2): boolean {
    const s = this._current;
    if (!s || s.points.length >= this.cfg.draw.maxPointsPerStroke) return false;
    s.points.push({ x: p.x, y: p.y });
    return true;
  }

  static length(points: readonly Point2[], aspect: number): number {
    let len = 0;
    for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i], aspect);
    return len;
  }

  /**
   * Commit the current stroke. Very short strokes are discarded. The first / last point snap to a
   * nearby star (recording the intended connection) so constellations visibly join up.
   */
  end(stars: StarManager): Stroke | null {
    const s = this._current;
    this._current = null;
    if (!s) return null;
    if (s.points.length < 2 || StrokeManager.length(s.points, this.aspect) < this.cfg.draw.minStrokeLength) {
      return null;
    }

    const first = s.points[0];
    const last = s.points[s.points.length - 1];
    const a = stars.nearest(first.x, first.y, this.cfg.draw.snapToStar);
    const b = stars.nearest(last.x, last.y, this.cfg.draw.snapToStar);
    if (a) {
      s.startStarId = a.id;
      s.points[0] = { x: a.x, y: a.y };
    }
    if (b) {
      s.endStarId = b.id;
      s.points[s.points.length - 1] = { x: b.x, y: b.y };
    }
    this._strokes.push(s);
    return s;
  }

  cancelCurrent(): void {
    this._current = null;
  }

  removeLast(): Stroke | undefined {
    return this._strokes.pop();
  }

  clear(): void {
    this._strokes = [];
    this._current = null;
  }
}
