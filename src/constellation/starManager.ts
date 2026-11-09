import { GESTURE_CONFIG, type GestureConfig } from '../gestures/gestureConfig';
import { dist } from '../gestures/handGeometry';
import type { Star } from './constellationTypes';

export class StarManager {
  private _stars: Star[] = [];
  private nextId = 1;
  aspect = 16 / 9;

  constructor(private readonly cfg: GestureConfig = GESTURE_CONFIG) {}

  get stars(): readonly Star[] {
    return this._stars;
  }

  /** Adds a star unless the cap is reached or it would overlap an existing star. */
  add(x: number, y: number, t: number, rng: () => number = Math.random): Star | null {
    if (this._stars.length >= this.cfg.star.maxStars) return null;
    if (this.nearest(x, y, this.cfg.star.minSpacing)) return null;
    const star: Star = {
      id: this.nextId++,
      x,
      y,
      createdAt: t,
      size: 0.8 + rng() * 0.6,
      brightness: 0.75 + rng() * 0.25,
    };
    this._stars.push(star);
    return star;
  }

  nearest(x: number, y: number, maxDist: number): Star | null {
    let best: Star | null = null;
    let bestD = maxDist;
    for (const s of this._stars) {
      const d = dist(s, { x, y }, this.aspect);
      if (d <= bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  byId(id: number): Star | undefined {
    return this._stars.find((s) => s.id === id);
  }

  removeLast(): Star | undefined {
    return this._stars.pop();
  }

  clear(): void {
    this._stars = [];
  }
}
