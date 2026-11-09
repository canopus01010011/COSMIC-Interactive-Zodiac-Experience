import { heartPoint } from '../gestures/shapeRecognizer';

/** Cursive "Canopus" as ONE continuous pen stroke. Units: x-height = 1, baseline y = 0, y UP. */
export const CANOPUS_SCRIPT: ReadonlyArray<readonly [number, number]> = [
  [1.25,1.55], [0.85,1.95], [0.3,2], [-0.1,1.6], [-0.22,1], [-0.1,0.4], [0.3,0.02], [0.8,0.06], [1.12,0.38],
  [1.45,0.75], [1.85,0.98], [1.62,0.86], [1.45,0.5], [1.58,0.12], [1.95,0.04], [2.2,0.35], [2.25,0.85],
  [2.3,0.98], [2.3,0.5], [2.38,0.06], [2.62,0.1], [2.82,0.62], [2.95,0.98], [2.95,0.5], [2.97,0.04],
  [3,0.5], [3.2,0.98], [3.55,0.98], [3.75,0.7], [3.76,0.3], [3.82,0.05], [4.05,0.12], [4.22,0.62],
  [4.5,0.97], [4.18,0.8], [4.08,0.45], [4.25,0.1], [4.6,0.03], [4.92,0.2], [4.95,0.62], [4.75,0.95],
  [4.5,0.97], [4.95,1], [5.3,0.98], [5.55,1.02], [5.6,0.4], [5.58,-0.5], [5.5,-1.15], [5.38,-1.3],
  [5.5,-0.9], [5.6,-0.1], [5.7,0.55], [5.95,0.97], [6.3,0.95], [6.52,0.6], [6.35,0.15], [6,0.05],
  [5.75,0.25], [5.8,0.4], [6.1,0.2], [6.55,0.1], [6.72,0.62], [6.82,0.98], [6.78,0.5], [6.92,0.1],
  [7.25,0.04], [7.55,0.35], [7.62,0.98], [7.58,0.5], [7.62,0.06], [7.9,0.12], [8.12,0.62], [8.4,0.98],
  [8.72,0.86], [8.5,0.56], [8.3,0.42], [8.62,0.16], [8.5,-0.02], [8.15,0.04],
];

/** Uniform Catmull-Rom spline through the control points, `k` samples per segment. */
export function splinePoints(ctrl: ReadonlyArray<readonly [number, number]>, k = 10): Array<[number, number]> {
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const out: Array<[number, number]> = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let s = 0; s < k; s++) {
      const t = s / k;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push([P[P.length - 2][0], P[P.length - 2][1]]);
  return out;
}

export interface CarinaStar {
  name: string;
  /** Right ascension (hours) and declination (degrees). */
  ra: number;
  dec: number;
  /** Apparent magnitude (smaller = brighter). */
  mag: number;
}

/** The brightest stars of Carina, the constellation that holds Canopus (alpha Carinae). */
export const CARINA_STARS: readonly CarinaStar[] = [
  { name: 'Canopus', ra: 6.399, dec: -52.696, mag: -0.74 },
  { name: 'Avior', ra: 8.375, dec: -59.51, mag: 1.86 },
  { name: 'Miaplacidus', ra: 9.22, dec: -69.717, mag: 1.68 },
  { name: 'Aspidiske', ra: 9.285, dec: -59.275, mag: 2.25 },
  { name: 'Theta Car', ra: 10.715, dec: -64.394, mag: 2.74 },
  { name: 'Upsilon Car', ra: 9.785, dec: -65.072, mag: 2.97 },
  { name: 'Omega Car', ra: 10.229, dec: -70.038, mag: 3.29 },
  { name: 'Chi Car', ra: 7.947, dec: -52.982, mag: 3.46 },
  { name: 'p Car', ra: 10.532, dec: -61.685, mag: 3.3 },
  { name: 'q Car', ra: 10.285, dec: -61.332, mag: 3.4 },
];

/** Stick-figure joining the stars above (indices into CARINA_STARS), stylised. */
export const CARINA_LINES: ReadonlyArray<readonly [number, number]> = [
  [0, 7], [7, 1], [1, 3], [3, 2], [3, 5], [5, 4], [2, 6], [6, 4], [4, 8], [8, 9], [9, 5],
];

/**
 * Sky positions -> flat chart (east to the left, north up) scaled to fit a unit box.
 * Returns x, y in 0..1 (y down) preserving the real aspect ratio, centred.
 */
export function carinaLayout(): Array<{ x: number; y: number }> {
  const rad = Math.PI / 180;
  const ra0 = 8.8 * 15 * rad;
  const dec0 = -61 * rad;
  const raw = CARINA_STARS.map((s) => {
    const ra = s.ra * 15 * rad;
    const dec = s.dec * rad;
    const cosc = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(ra - ra0);
    const east = (Math.cos(dec) * Math.sin(ra - ra0)) / cosc;
    const north = (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(ra - ra0)) / cosc;
    return { x: -east, y: -north };
  });
  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const s = Math.max(maxX - minX, maxY - minY);
  return raw.map((p) => ({ x: 0.5 + (p.x - (minX + maxX) / 2) / s, y: 0.5 + (p.y - (minY + maxY) / 2) / s }));
}

/** Closed heart outline starting at the bottom tip (math y flipped to screen y), normalised to a unit box. */
export function heartOutline(n = 180): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const [x, y] = heartPoint(Math.PI + (i / n) * Math.PI * 2);
    out.push([x / 32, (y - 2.5) / 32]); // bbox: x in [-16,16], screen y in [-12,17] -> about [-0.45,0.45] (same scale on both axes)
  }
  return out;
}
