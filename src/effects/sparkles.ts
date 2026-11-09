import { drawGlow, drawStar, type PaletteName } from './sprites';

/** Fixed-capacity pool of short-lived 2D sparkles (pixel space). Shared by the aura, trails and star bursts. */
export class SparkleSystem {
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly spin: Float32Array;
  private readonly color: Uint8Array;
  private readonly twinkle: Uint8Array;
  private count = 0;

  private static readonly COLORS: PaletteName[] = ['white', 'cool', 'lavender', 'violet'];

  /** Soft limit (quality setting); the typed arrays are sized for `maxCapacity`. */
  limit: number;

  constructor(readonly maxCapacity: number) {
    const capacity = maxCapacity;
    this.limit = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.color = new Uint8Array(capacity);
    this.twinkle = new Uint8Array(capacity);
  }

  get active(): number {
    return this.count;
  }

  /** colorIndex: 0 white, 1 cool-white, 2 lavender, 3 violet. `star` renders a 4-point twinkle instead of a dot. */
  emit(x: number, y: number, vx: number, vy: number, life: number, size: number, colorIndex: number, star = false): void {
    if (this.count >= this.limit) return; // pool full: drop (cheap graceful degradation)
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.spin[i] = Math.random() * Math.PI;
    this.color[i] = colorIndex;
    this.twinkle[i] = star ? 1 : 0;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const last = --this.count;
        if (i !== last) {
          this.x[i] = this.x[last];
          this.y[i] = this.y[last];
          this.vx[i] = this.vx[last];
          this.vy[i] = this.vy[last];
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.size[i] = this.size[last];
          this.spin[i] = this.spin[last];
          this.color[i] = this.color[last];
          this.twinkle[i] = this.twinkle[last];
        }
        continue;
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.vx[i] *= 1 - 0.9 * dt;
      this.vy[i] *= 1 - 0.9 * dt;
      i++;
    }
  }

  draw(ctx: CanvasRenderingContext2D, intensity = 1): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.life[i] / this.maxLife[i]; // 1 -> 0
      const fadeIn = Math.min(1, (1 - p) * 8);
      const a = Math.min(1, p * 1.6) * fadeIn * intensity;
      const color = SparkleSystem.COLORS[this.color[i]] ?? 'white';
      if (this.twinkle[i]) {
        drawStar(ctx, color, this.x[i], this.y[i], this.size[i] * (0.6 + 0.6 * p), a, this.spin[i] + (1 - p) * 1.2);
      } else {
        drawGlow(ctx, color, this.x[i], this.y[i], this.size[i] * (0.5 + 0.6 * p), a);
      }
    }
  }

  clear(): void {
    this.count = 0;
  }
}
