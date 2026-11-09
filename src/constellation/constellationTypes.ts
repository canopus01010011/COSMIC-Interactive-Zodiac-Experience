import type { ZodiacId } from '../data/zodiacSigns';
import type { Point2 } from '../vision/landmarkTypes';

/** A placed star in normalised (display) camera coordinates. */
export interface Star {
  id: number;
  x: number;
  y: number;
  createdAt: number;
  /** Relative size multiplier (about 0.8 .. 1.4). */
  size: number;
  /** 0..1 */
  brightness: number;
}

/** A continuous gesture-drawn path. */
export interface Stroke {
  id: number;
  points: Point2[];
  color: string;
  width: number;
  createdAt: number;
  /** Set when the stroke's start / end was snapped to a nearby star (an intended connection). */
  startStarId?: number;
  endStarId?: number;
}

/** The complete drawing before transformation. */
export interface Constellation {
  stars: Star[];
  strokes: Stroke[];
  selectedSign: ZodiacId;
  createdAt: number;
}
