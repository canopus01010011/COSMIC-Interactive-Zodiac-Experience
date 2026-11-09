import type { Stroke } from '../constellation/constellationTypes';
import type { Point2 } from '../vision/landmarkTypes';
import type { SparkleSystem } from './sparkles';
import { drawGlow } from './sprites';

/** Trace a smooth curve through the points (quadratic curves through segment midpoints). */
function tracePath(ctx: CanvasRenderingContext2D, pts: readonly Point2[], from: number, w: number, h: number): void {
  const n = pts.length;
  ctx.beginPath();
  ctx.moveTo(pts[from].x * w, pts[from].y * h);
  if (n - from < 3) {
    for (let i = from + 1; i < n; i++) ctx.lineTo(pts[i].x * w, pts[i].y * h);
    return;
  }
  for (let i = from + 1; i < n - 1; i++) {
    const mx = ((pts[i].x + pts[i + 1].x) / 2) * w;
    const my = ((pts[i].y + pts[i + 1].y) / 2) * h;
    ctx.quadraticCurveTo(pts[i].x * w, pts[i].y * h, mx, my);
  }
  ctx.lineTo(pts[n - 1].x * w, pts[n - 1].y * h);
}

/** Three-pass glowing line: wide violet halo, cool-white body, bright white core. */
function strokeGlow(ctx: CanvasRenderingContext2D, k: number, alpha: number, glow: number): void {
  const passes: Array<[number, string]> = [
    [15 * k, `rgba(140,110,255,${0.1 * alpha * glow})`],
    [7 * k, `rgba(205,215,255,${0.24 * alpha * glow})`],
    [2.6 * k, `rgba(255,255,255,${0.95 * alpha})`],
  ];
  for (const [width, style] of passes) {
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.stroke();
  }
}

/**
 * Draws committed strokes plus the one currently being drawn. The live stroke gets an extra
 * brighter "head" section that fades back into the body, plus a glowing orb at the fingertip.
 */
export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strokes: readonly Stroke[],
  current: Stroke | null,
  alpha: number,
  glow: number,
): void {
  if (alpha <= 0.01) return;
  const k = h / 720;
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const s of strokes) {
    if (s.points.length < 2) continue;
    tracePath(ctx, s.points, 0, w, h);
    strokeGlow(ctx, k, alpha * 0.9, glow);
  }

  if (current && current.points.length >= 1) {
    const pts = current.points;
    if (pts.length >= 2) {
      tracePath(ctx, pts, 0, w, h);
      strokeGlow(ctx, k, alpha * 0.8, glow);
      // Bright head: the last ~28 points are drawn again, in two nested segments so the tail fades.
      for (const [len, boost] of [[28, 0.55], [12, 0.9]] as const) {
        const from = Math.max(0, pts.length - len);
        if (pts.length - from >= 2) {
          tracePath(ctx, pts, from, w, h);
          ctx.lineWidth = 3 * k;
          ctx.strokeStyle = `rgba(255,255,255,${boost * alpha})`;
          ctx.stroke();
        }
      }
    }
    const head = pts[pts.length - 1];
    drawGlow(ctx, 'violet', head.x * w, head.y * h, 54 * k, 0.55 * alpha * glow);
    drawGlow(ctx, 'white', head.x * w, head.y * h, 22 * k, 0.95 * alpha);
  }
  ctx.globalAlpha = 1;
}

/** Sparse sparkles: a trickle from the live head, and occasional twinkles on saved lines. */
export function emitTrailSparkles(
  sparkles: SparkleSystem,
  w: number,
  h: number,
  strokes: readonly Stroke[],
  current: Stroke | null,
  dt: number,
  reducedFlash: boolean,
): void {
  const k = h / 720;
  const speed = reducedFlash ? 0.45 : 1;

  if (current && current.points.length > 0) {
    const p = current.points[current.points.length - 1];
    if (Math.random() < 34 * dt * speed) {
      sparkles.emit(
        p.x * w + (Math.random() - 0.5) * 10 * k,
        p.y * h + (Math.random() - 0.5) * 10 * k,
        (Math.random() - 0.5) * 50 * k,
        (Math.random() - 0.5) * 50 * k + 10 * k,
        0.5 + Math.random() * 0.6,
        (7 + Math.random() * 10) * k,
        Math.random() < 0.6 ? 0 : 1,
        Math.random() < 0.4,
      );
    }
  }

  for (const s of strokes) {
    if (s.points.length < 2) continue;
    if (Math.random() < 2.2 * dt * speed) {
      const p = s.points[(Math.random() * s.points.length) | 0];
      sparkles.emit(p.x * w, p.y * h, (Math.random() - 0.5) * 12 * k, (Math.random() - 0.5) * 12 * k, 0.7 + Math.random() * 0.7, (8 + Math.random() * 8) * k, Math.random() < 0.5 ? 0 : 2, true);
    }
  }
}
