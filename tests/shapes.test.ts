import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { heartPoint, recognizeShape } from '../src/gestures/shapeRecognizer';
import type { Point2 } from '../src/vision/landmarkTypes';

const ASPECT = 16 / 9;

/** Tiny deterministic PRNG so the tests are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Opt { cx?: number; cy?: number; size?: number; jitter?: number; rot?: number; seed?: number; n?: number; reverse?: boolean; start?: number }

/** Convert a path in arbitrary units to a noisy, rotated, placed stage path (stage-height units / aspect). */
function place(raw: Array<[number, number]>, o: Opt): Point2[] {
  const { cx = 0.5, cy = 0.5, size = 0.4, jitter = 0.008, rot = 0, seed = 1 } = o;
  const r = rng(seed);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of raw) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const s = size / Math.max(maxX - minX, maxY - minY);
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const c = Math.cos(rot), sn = Math.sin(rot);
  return raw.map(([x, y]) => {
    const px = (x - mx) * s, py = (y - my) * s;
    const rx = px * c - py * sn + (r() - 0.5) * 2 * jitter;
    const ry = px * sn + py * c + (r() - 0.5) * 2 * jitter;
    return { x: cx + rx / ASPECT, y: cy + ry };
  });
}

function cPath(spanDeg: number, n = 60, reverse = false): Array<[number, number]> {
  const gap = ((360 - spanDeg) / 2) * (Math.PI / 180);
  const span = (spanDeg * Math.PI) / 180;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) { const th = gap + (i / (n - 1)) * span; out.push([Math.cos(th), -Math.sin(th)]); }
  return reverse ? out.reverse() : out;
}
function heartPath(n = 70, start = 0, reverse = false): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) { const t = ((i + start) / n) * Math.PI * 2; out.push(heartPoint(t) as [number, number]); }
  return reverse ? out.reverse() : out;
}

describe('shape recognizer', () => {
  it('recognises a C at several sizes, spans, positions and rotations', () => {
    for (const span of [240, 270, 300]) {
      for (const size of [0.22, 0.4, 0.7]) {
        for (const rot of [-0.2, 0, 0.2]) {
          const res = recognizeShape(place(cPath(span), { size, rot, cx: 0.3 + size * 0.3, seed: span + size * 100 }), ASPECT);
          assert.equal(res.shape, 'C', `C span=${span} size=${size} rot=${rot} d=${res.distance.toFixed(3)}`);
        }
      }
    }
  });
  it('recognises a C drawn in either direction', () => {
    assert.equal(recognizeShape(place(cPath(270, 60, true), { seed: 3 }), ASPECT).shape, 'C');
  });
  it('recognises a heart from any start point, either direction, with hand jitter', () => {
    for (const start of [0, 12, 25, 40, 58]) {
      for (const reverse of [false, true]) {
        for (const size of [0.25, 0.5]) {
          const res = recognizeShape(place(heartPath(70, start, reverse), { size, seed: start + 7, jitter: 0.01 }), ASPECT);
          assert.equal(res.shape, 'HEART', `heart start=${start} rev=${reverse} size=${size} d=${res.distance.toFixed(3)} best=${res.best}`);
        }
      }
    }
  });
  it('does not confuse circles, lines, zig-zags, tiny wiggles or huge strokes', () => {
    const circle: Array<[number, number]> = Array.from({ length: 71 }, (_, i) => [Math.cos((i / 70) * 6.283), Math.sin((i / 70) * 6.283)]);
    assert.equal(recognizeShape(place(circle, { seed: 5 }), ASPECT).shape, null, 'circle');
    const line: Array<[number, number]> = Array.from({ length: 40 }, (_, i) => [i, i * 0.1]);
    assert.equal(recognizeShape(place(line, { seed: 6 }), ASPECT).shape, null, 'line');
    const zig: Array<[number, number]> = Array.from({ length: 40 }, (_, i) => [i, i % 8 < 4 ? 0 : 3]);
    assert.equal(recognizeShape(place(zig, { seed: 7 }), ASPECT).shape, null, 'zigzag');
    assert.equal(recognizeShape(place(cPath(270), { size: 0.05 }), ASPECT).shape, null, 'tiny');
    assert.equal(recognizeShape(place(cPath(270), { size: 2.5 }), ASPECT).shape, null, 'huge');
    assert.equal(recognizeShape([], ASPECT).shape, null, 'empty');
    const sShape: Array<[number, number]> = Array.from({ length: 60 }, (_, i) => { const t = (i / 59) * 2 * Math.PI; return [Math.sin(t), -t / 3]; });
    assert.equal(recognizeShape(place(sShape, { seed: 9 }), ASPECT).shape, null, 'S / wave');
  });
});

import { SymbolTracer } from '../src/gestures/symbolTracer';
import { buildMockHand } from '../src/vision/mockHand';

/** Feed a stroke (30 fps) followed by a rest, returning every event produced. */
function runStroke(path: Point2[], opts: { restMs?: number; enabled?: boolean; msPerPoint?: number } = {}) {
  const tracer = new SymbolTracer();
  const { restMs = 700, enabled = true, msPerPoint = 33 } = opts;
  const events = [];
  let t = 1000;
  // a short still lead-in
  for (let i = 0; i < 5; i++, t += 33) tracer.update(t, [buildMockHand({ pose: 'open', x: path[0].x, y: path[0].y, size: 0.15 })], ASPECT, enabled);
  for (const p of path) {
    t += msPerPoint;
    const e = tracer.update(t, [buildMockHand({ pose: 'open', x: p.x, y: p.y, size: 0.15 })], ASPECT, enabled);
    if (e) events.push(e);
  }
  const last = path[path.length - 1];
  for (let ms = 0; ms < restMs; ms += 33, t += 33) {
    const e = tracer.update(t, [buildMockHand({ pose: 'open', x: last.x, y: last.y, size: 0.15 })], ASPECT, enabled);
    if (e) events.push(e);
  }
  return events;
}

describe('symbol tracer', () => {
  const c = place(cPath(270, 45), { size: 0.4, jitter: 0.002, seed: 11 });
  const h = place(heartPath(60, 0), { size: 0.4, jitter: 0.002, seed: 12 });
  it('emits C for a traced C once the hand pauses', () => {
    const ev = runStroke(c);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].shape, 'C');
  });
  it('emits HEART for a traced heart', () => {
    const ev = runStroke(h);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].shape, 'HEART');
  });
  it('emits nothing while disabled, for a slow drift or a straight sweep', () => {
    assert.equal(runStroke(c, { enabled: false }).length, 0);
    assert.equal(runStroke(c, { msPerPoint: 400 }).length, 0, 'too slow to be a stroke');
    const sweep = Array.from({ length: 40 }, (_, i) => ({ x: 0.2 + i * 0.012, y: 0.5 }));
    assert.equal(runStroke(sweep).length, 0);
  });
  it('does not fire twice during the cooldown and ignores two-hand frames', () => {
    const tracer = new SymbolTracer();
    let t = 0;
    let n = 0;
    for (let rep = 0; rep < 2; rep++) {
      for (const p of c) { t += 33; if (tracer.update(t, [buildMockHand({ pose: 'open', x: p.x, y: p.y, size: 0.15 })], ASPECT, true)) n++; }
      for (let i = 0; i < 20; i++) { t += 33; if (tracer.update(t, [buildMockHand({ pose: 'open', x: c[c.length - 1].x, y: c[c.length - 1].y, size: 0.15 })], ASPECT, true)) n++; }
    }
    assert.equal(n, 1, 'second C inside the cooldown is ignored');
    const two = new SymbolTracer();
    let m = 0;
    for (const p of c) { t += 33; if (two.update(t, [buildMockHand({ pose: 'open', x: p.x, y: p.y }), buildMockHand({ pose: 'open', x: 0.9, y: 0.5 })], ASPECT, true)) m++; }
    assert.equal(m, 0);
  });
});
