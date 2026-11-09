import type { Point2 } from '../vision/landmarkTypes';

export type ShapeKind = 'C' | 'HEART';

export interface ShapeResult {
  shape: ShapeKind | null;
  /** Mean normalised distance to the best template (lower = better). */
  distance: number;
  /** Name of the best matching template family, including the rejected ones ('circle'). */
  best: 'C' | 'HEART' | 'circle' | 'none';
}

export const SHAPE_CONFIG = {
  /** Smallest accepted drawing, in stage-height units (longest bounding-box side). */
  minSize: 0.14,
  /** Largest accepted drawing. */
  maxSize: 1.4,
  minPathLength: 0.3,
  /** start/end gap (fraction of the bounding box) below which a stroke counts as closed. */
  closedGap: 0.4,
  /** Maximum mean template distance (templates are scaled to a unit bounding box). */
  maxDistanceC: 0.13,
  maxDistanceHeart: 0.105,
} as const;

const N = 48;

type Pt = [number, number];

function resample(src: readonly Pt[], n: number): Pt[] {
  let total = 0;
  for (let i = 1; i < src.length; i++) total += Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]);
  if (total === 0) return Array.from({ length: n }, () => [src[0][0], src[0][1]] as Pt);
  const step = total / (n - 1);
  const out: Pt[] = [[src[0][0], src[0][1]]];
  let acc = 0;
  let prev = src[0];
  let i = 1;
  while (i < src.length && out.length < n) {
    const cur = src[i];
    const d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    if (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q: Pt = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
      out.push(q);
      prev = q;
      acc = 0;
    } else {
      acc += d;
      prev = cur;
      i++;
    }
  }
  while (out.length < n) out.push([src[src.length - 1][0], src[src.length - 1][1]]);
  return out;
}

/** Centre the bounding box on the origin and scale its longest side to 1. */
function normalise(pts: Pt[]): Pt[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const s = Math.max(maxX - minX, maxY - minY) || 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return pts.map(([x, y]) => [(x - cx) / s, (y - cy) / s] as Pt);
}

function rotate(pts: Pt[], a: number): Pt[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c] as Pt);
}

function meanDist(a: Pt[], b: Pt[], shift = 0): number {
  let sum = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const q = b[(i + shift + n) % n];
    sum += Math.hypot(a[i][0] - q[0], a[i][1] - q[1]);
  }
  return sum / n;
}

// ---- templates (screen space: x right, y DOWN) --------------------------------------------------

function buildC(spanDeg: number): Pt[] {
  const gap = ((360 - spanDeg) / 2) * (Math.PI / 180);
  const span = (spanDeg * Math.PI) / 180;
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const th = gap + (i / (N - 1)) * span; // upper right -> top -> left -> bottom -> lower right
    pts.push([Math.cos(th), -Math.sin(th)]);
  }
  return normalise(pts);
}

function buildClosed(f: (t: number) => Pt): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) pts.push(f((i / N) * Math.PI * 2));
  return normalise(pts);
}

/** The classic parametric heart, y flipped so the two lobes are on top of the screen. */
export function heartPoint(t: number): Pt {
  const x = 16 * Math.sin(t) ** 3;
  const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  return [x, -y];
}

const C_TEMPLATES: Pt[][] = [];
for (const span of [230, 265, 300]) {
  const t = buildC(span);
  C_TEMPLATES.push(t, [...t].reverse());
}
const HEART_TEMPLATE = buildClosed(heartPoint);
const CIRCLE_TEMPLATE = buildClosed((t) => [Math.cos(t), Math.sin(t)]);

const ROTATIONS = [-0.3, -0.15, 0, 0.15, 0.3];

function bestOpen(path: Pt[], templates: Pt[][]): number {
  let best = Infinity;
  for (const r of ROTATIONS) {
    const p = rotate(path, r);
    for (const t of templates) best = Math.min(best, meanDist(p, t));
  }
  return best;
}

function bestClosed(path: Pt[], template: Pt[]): number {
  let best = Infinity;
  const rev = [...template].reverse();
  for (const r of ROTATIONS) {
    const p = rotate(path, r);
    for (const t of [template, rev]) {
      for (let s = 0; s < N; s += 2) best = Math.min(best, meanDist(p, t, s));
    }
  }
  return best;
}

/**
 * Recognise a hand-traced "C" or heart.
 * @param points path in normalised stage coordinates (x right, y down, in display space)
 * @param aspect stage width / height, so the shape is measured isotropically
 */
export function recognizeShape(points: readonly Point2[], aspect: number): ShapeResult {
  const none: ShapeResult = { shape: null, distance: Infinity, best: 'none' };
  if (points.length < 8) return none;
  const raw: Pt[] = points.map((p) => [p.x * aspect, p.y] as Pt);

  let length = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) length += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
    minX = Math.min(minX, raw[i][0]);
    maxX = Math.max(maxX, raw[i][0]);
    minY = Math.min(minY, raw[i][1]);
    maxY = Math.max(maxY, raw[i][1]);
  }
  const size = Math.max(maxX - minX, maxY - minY);
  const cfg = SHAPE_CONFIG;
  if (size < cfg.minSize || size > cfg.maxSize || length < cfg.minPathLength) return none;
  // A stroke that is basically a line (very thin box) is never a C or a heart.
  if (Math.min(maxX - minX, maxY - minY) < size * 0.35) return none;

  const gap = Math.hypot(raw[0][0] - raw[raw.length - 1][0], raw[0][1] - raw[raw.length - 1][1]) / size;
  const path = normalise(resample(raw, N));

  if (gap < cfg.closedGap) {
    const dHeart = bestClosed(path, HEART_TEMPLATE);
    const dCircle = bestClosed(path, CIRCLE_TEMPLATE);
    if (dHeart <= dCircle * 0.92 && dHeart < cfg.maxDistanceHeart) return { shape: 'HEART', distance: dHeart, best: 'HEART' };
    return { shape: null, distance: Math.min(dHeart, dCircle), best: dHeart <= dCircle ? 'HEART' : 'circle' };
  }
  const dC = bestOpen(path, C_TEMPLATES);
  if (dC < cfg.maxDistanceC) return { shape: 'C', distance: dC, best: 'C' };
  return { shape: null, distance: dC, best: 'C' };
}
