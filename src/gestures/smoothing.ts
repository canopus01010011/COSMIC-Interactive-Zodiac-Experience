import type { Point2 } from '../vision/landmarkTypes';

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export const easeInCubic = (t: number): number => t * t * t;
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Frame-rate independent exponential smoothing toward a target. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

class LowPassFilter {
  private s: number | null = null;
  filter(value: number, alpha: number): number {
    this.s = this.s === null ? value : alpha * value + (1 - alpha) * this.s;
    return this.s;
  }
  last(): number | null {
    return this.s;
  }
  reset(): void {
    this.s = null;
  }
}

const smoothingAlpha = (cutoffHz: number, dtSec: number): number => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
};

/**
 * One Euro filter (Casiez et al.): low latency when moving fast, strong smoothing when
 * (nearly) still, which is exactly what fingertip cursors need to kill tracking jitter.
 * Timestamps are in milliseconds.
 */
export class OneEuroFilter {
  private readonly x = new LowPassFilter();
  private readonly dx = new LowPassFilter();
  private lastT: number | null = null;

  constructor(
    private readonly minCutoff = 1.0,
    private readonly beta = 0.0,
    private readonly dCutoff = 1.0,
  ) {}

  filter(value: number, tMs: number): number {
    if (this.lastT === null) {
      this.lastT = tMs;
      this.dx.filter(0, 1);
      return this.x.filter(value, 1);
    }
    const dt = Math.max((tMs - this.lastT) / 1000, 1e-3);
    this.lastT = tMs;
    const prev = this.x.last() ?? value;
    const rate = (value - prev) / dt;
    const edx = this.dx.filter(rate, smoothingAlpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, smoothingAlpha(cutoff, dt));
  }

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastT = null;
  }
}

export class OneEuroFilter2D {
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;

  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.fx = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.fy = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  filter(p: Point2, tMs: number): Point2 {
    return { x: this.fx.filter(p.x, tMs), y: this.fy.filter(p.y, tMs) };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }
}

/** Rolling time window of samples (used for fingertip speed and gesture timing). */
export class TimedHistory<T extends { t: number }> {
  readonly items: T[] = [];

  constructor(private readonly windowMs: number) {}

  push(item: T): void {
    this.items.push(item);
    const cutoff = item.t - this.windowMs;
    while (this.items.length > 0 && this.items[0].t < cutoff) this.items.shift();
  }

  clear(): void {
    this.items.length = 0;
  }

  get length(): number {
    return this.items.length;
  }
}
