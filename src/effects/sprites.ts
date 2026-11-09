/** Pre-rendered glow / star sprites. drawImage of a small cached canvas is far cheaper than building gradients every frame. */

export const PALETTE = {
  white: '255,255,255',
  cool: '224,234,255',
  lavender: '198,178,255',
  violet: '150,104,255',
  deep: '112,64,232',
  pink: '255,112,200',
  rose: '255,170,228',
} as const;

export type PaletteName = keyof typeof PALETTE;

const glowCache = new Map<string, HTMLCanvasElement>();
const starCache = new Map<string, HTMLCanvasElement>();

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  return [c, ctx];
}

/** Soft radial glow with a bright core. */
export function glowSprite(color: PaletteName, size = 96): HTMLCanvasElement {
  const key = `${color}:${size}`;
  let c = glowCache.get(key);
  if (!c) {
    const [canvas, ctx] = makeCanvas(size);
    const r = size / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    const rgb = PALETTE[color];
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(0.18, `rgba(${rgb},0.65)`);
    g.addColorStop(0.45, `rgba(${rgb},0.18)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    c = canvas;
    glowCache.set(key, c);
  }
  return c;
}

/** Four-pointed twinkle star with a soft centre. */
export function starSprite(color: PaletteName, size = 128): HTMLCanvasElement {
  const key = `${color}:${size}`;
  let c = starCache.get(key);
  if (!c) {
    const [canvas, ctx] = makeCanvas(size);
    const m = size / 2;
    const k = size * 0.045; // pinch of the concave sides
    const rgb = PALETTE[color];

    const g = ctx.createRadialGradient(m, m, 0, m, m, m);
    g.addColorStop(0, `rgba(255,255,255,1)`);
    g.addColorStop(0.25, `rgba(${rgb},0.95)`);
    g.addColorStop(1, `rgba(${rgb},0.0)`);

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(m, 0);
    ctx.quadraticCurveTo(m + k, m - k, size, m);
    ctx.quadraticCurveTo(m + k, m + k, m, size);
    ctx.quadraticCurveTo(m - k, m + k, 0, m);
    ctx.quadraticCurveTo(m - k, m - k, m, 0);
    ctx.closePath();
    ctx.fill();

    // Soft halo behind the spikes.
    const h = ctx.createRadialGradient(m, m, 0, m, m, m * 0.5);
    h.addColorStop(0, `rgba(${rgb},0.55)`);
    h.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = h;
    ctx.fillRect(0, 0, size, size);

    c = canvas;
    starCache.set(key, c);
  }
  return c;
}

export function drawGlow(
  ctx: CanvasRenderingContext2D,
  color: PaletteName,
  x: number,
  y: number,
  diameter: number,
  alpha: number,
): void {
  if (alpha <= 0.003 || diameter <= 0.5) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(glowSprite(color), x - diameter / 2, y - diameter / 2, diameter, diameter);
}

export function drawStar(
  ctx: CanvasRenderingContext2D,
  color: PaletteName,
  x: number,
  y: number,
  diameter: number,
  alpha: number,
  rotation = 0,
): void {
  if (alpha <= 0.003 || diameter <= 0.5) return;
  ctx.globalAlpha = Math.min(1, alpha);
  const s = starSprite(color);
  if (rotation === 0) {
    ctx.drawImage(s, x - diameter / 2, y - diameter / 2, diameter, diameter);
  } else {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.drawImage(s, -diameter / 2, -diameter / 2, diameter, diameter);
    ctx.restore();
  }
}
