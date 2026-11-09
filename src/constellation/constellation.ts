import { DEFAULT_SIGN, type ZodiacId } from '../data/zodiacSigns';
import type { GestureEvent } from '../gestures/gestureRecognizer';
import type { Constellation, Star, Stroke } from './constellationTypes';
import { StarManager } from './starManager';
import { StrokeManager } from './strokeManager';

/**
 * The live constellation: placed stars + drawn strokes. Once `freeze()` is called (transformation
 * started) no further mutation is accepted, and `snapshot()` returns an immutable copy of the geometry.
 */
export class ConstellationModel {
  readonly stars = new StarManager();
  readonly strokes = new StrokeManager();
  selectedSign: ZodiacId = DEFAULT_SIGN;
  createdAt = Date.now();
  private _frozen = false;

  get frozen(): boolean {
    return this._frozen;
  }

  get isEmpty(): boolean {
    return this.stars.stars.length === 0 && this.strokes.strokes.length === 0 && !this.strokes.current;
  }

  setAspect(aspect: number): void {
    this.stars.aspect = aspect;
    this.strokes.aspect = aspect;
  }

  /** Apply a gesture event. Returns the Star if one was placed. */
  apply(event: GestureEvent): { star?: Star; stroke?: Stroke } {
    if (this._frozen) return {};
    switch (event.type) {
      case 'STAR_HOLD': {
        const star = this.stars.add(event.point.x, event.point.y, event.t);
        return star ? { star } : {};
      }
      case 'DRAW_START':
        this.strokes.begin(event.point, event.t);
        return {};
      case 'DRAW_MOVE':
        this.strokes.extend(event.point);
        return {};
      case 'DRAW_END': {
        const stroke = this.strokes.end(this.stars);
        return stroke ? { stroke } : {};
      }
      default:
        return {};
    }
  }

  /** Close any stroke that is still being drawn. */
  endActiveStroke(): Stroke | null {
    return this._frozen ? null : this.strokes.end(this.stars);
  }

  freeze(): void {
    this.endActiveStroke();
    this._frozen = true;
  }

  unfreeze(): void {
    this._frozen = false;
  }

  /** Immutable deep copy of the geometry (the `Constellation` data object from the spec). */
  snapshot(): Constellation {
    const snap: Constellation = {
      stars: this.stars.stars.map((s) => ({ ...s })),
      strokes: this.strokes.strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })),
      selectedSign: this.selectedSign,
      createdAt: this.createdAt,
    };
    return Object.freeze(snap);
  }

  /** Remove the most recent stroke (or star if there are no strokes). */
  undo(): void {
    if (this._frozen) return;
    if (!this.strokes.removeLast()) this.stars.removeLast();
  }

  clear(): void {
    this.stars.clear();
    this.strokes.clear();
    this._frozen = false;
    this.createdAt = Date.now();
  }
}
