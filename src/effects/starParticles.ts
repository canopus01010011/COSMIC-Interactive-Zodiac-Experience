import type { Star } from '../constellation/constellationTypes';
import type { Point2 } from '../vision/landmarkTypes';
import type { SparkleSystem } from './sparkles';
import { drawGlow, drawStar } from './sprites';

/**
 * Placed stars: soft bloom, a four-point core that twinkles, and a few tiny orbiting motes.
 * `tSec` is continuous time; `alpha` fades the whole constellation (used when it transforms).
 */
export function drawPlacedStars(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  stars: readonly Star[],
  tSec: number,
  alpha: number,
  glow: number,
  reducedFlash: boolean,
): void {
  if (alpha <= 0.01) return;
  const k = h / 720;
  const rate = reducedFlash ? 0.6 : 1.8;
  for (const s of stars) {
    const x = s.x * w;
    const y = s.y * h;
    const base = 11 * k * s.size;
    const tw = 0.82 + 0.18 * Math.sin(tSec * rate + s.id * 2.399);
    const a = alpha * s.brightness * glow;

    drawGlow(ctx, 'violet', x, y, base * 6.5, 0.42 * a * tw);
    drawGlow(ctx, 'cool', x, y, base * 3.2, 0.7 * a);
    drawStar(ctx, 'white', x, y, base * 4.4 * tw, 0.95 * a, Math.sin(tSec * 0.3 + s.id) * 0.15);
    drawGlow(ctx, 'white', x, y, base * 1.15, a);

    // Subtle orbiting motes.
    for (let m = 0; m < 3; m++) {
      const ang = tSec * (0.7 + m * 0.33) * (m % 2 ? -1 : 1) + s.id * 1.3 + (m * Math.PI * 2) / 3;
      const rad = base * (2.1 + 0.4 * m);
      drawGlow(ctx, 'lavender', x + Math.cos(ang) * rad, y + Math.sin(ang) * rad, base * 0.6, 0.65 * a);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Feedback for mode 1 (star summoning): small stars orbit the index fingertip and a ring fills while
 * the fingertip is held still. When the ring completes a star is placed.
 */
export function drawStarSummonIndicator(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cursor: Point2,
  progress: number,
  tSec: number,
  glow: number,
): void {
  const k = h / 720;
  const x = cursor.x * w;
  const y = cursor.y * h;
  const ringR = 30 * k;

  // Orbiting stars.
  for (let i = 0; i < 4; i++) {
    const ang = tSec * (1.4 + progress * 1.6) + (i * Math.PI) / 2;
    const rad = ringR * (0.85 + 0.12 * Math.sin(tSec * 3 + i));
    drawStar(ctx, i % 2 ? 'lavender' : 'white', x + Math.cos(ang) * rad, y + Math.sin(ang) * rad, 13 * k, 0.9 * glow, ang);
  }
  drawGlow(ctx, 'violet', x, y, ringR * 2.2, (0.25 + 0.4 * progress) * glow);

  // Progress ring.
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.lineWidth = 2 * k;
  ctx.strokeStyle = `rgba(190,170,255,${0.28 * glow})`;
  ctx.beginPath();
  ctx.arc(x, y, ringR * 1.35, 0, Math.PI * 2);
  ctx.stroke();
  if (progress > 0.02) {
    ctx.lineWidth = 3.2 * k;
    ctx.strokeStyle = `rgba(255,255,255,${0.95 * glow})`;
    ctx.beginPath();
    ctx.arc(x, y, ringR * 1.35, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
    drawGlow(ctx, 'white', x + Math.cos(-Math.PI / 2 + Math.PI * 2 * progress) * ringR * 1.35, y + Math.sin(-Math.PI / 2 + Math.PI * 2 * progress) * ringR * 1.35, 12 * k, 0.9 * glow);
  }
}

/** A short radial burst when a star is placed. */
export function emitStarBurst(sparkles: SparkleSystem, x: number, y: number, k: number, reducedFlash: boolean): void {
  const n = reducedFlash ? 8 : 18;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const speed = (50 + Math.random() * 120) * k;
    sparkles.emit(x, y, Math.cos(ang) * speed, Math.sin(ang) * speed, 0.5 + Math.random() * 0.6, (8 + Math.random() * 10) * k, Math.random() < 0.5 ? 0 : 2, i % 3 === 0);
  }
}
