import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OneEuroFilter, OneEuroFilter2D, TimedHistory, clamp, damp, easeInOutCubic, smoothstep } from '../src/gestures/smoothing';

describe('smoothing utilities', () => {
  it('One-Euro filter removes jitter on a stationary signal', () => {
    const f = new OneEuroFilter(1.6, 6);
    let t = 0;
    let maxDev = 0;
    for (let i = 0; i < 90; i++) {
      const noisy = 0.5 + (i % 2 === 0 ? 0.004 : -0.004);
      const out = f.filter(noisy, t);
      if (i > 20) maxDev = Math.max(maxDev, Math.abs(out - 0.5));
      t += 33;
    }
    assert.ok(maxDev < 0.0025, `max deviation ${maxDev}`);
  });

  it('One-Euro filter follows fast movement with little lag', () => {
    const f = new OneEuroFilter(1.6, 6);
    let out = 0;
    let t = 0;
    let target = 0;
    for (let i = 0; i < 30; i++) {
      target = i * 0.02; // 0.6 units/second
      out = f.filter(target, t);
      t += 33;
    }
    assert.ok(target - out < 0.05, `lag ${target - out}`);
  });

  it('2D filter resets', () => {
    const f = new OneEuroFilter2D(1, 0);
    f.filter({ x: 1, y: 1 }, 0);
    f.reset();
    const p = f.filter({ x: 5, y: 7 }, 1000);
    assert.deepEqual(p, { x: 5, y: 7 });
  });

  it('helpers behave', () => {
    assert.equal(clamp(5, 0, 1), 1);
    assert.equal(smoothstep(0, 1, 0.5), 0.5);
    assert.equal(easeInOutCubic(0), 0);
    assert.equal(easeInOutCubic(1), 1);
    const v = damp(0, 10, 5, 1 / 60);
    assert.ok(v > 0 && v < 10);
    // Frame-rate independence: two half steps ~= one full step.
    const a = damp(damp(0, 1, 8, 0.01), 1, 8, 0.01);
    const b = damp(0, 1, 8, 0.02);
    assert.ok(Math.abs(a - b) < 1e-9);
  });

  it('TimedHistory keeps only the window', () => {
    const h = new TimedHistory<{ t: number }>(100);
    for (let t = 0; t <= 500; t += 10) h.push({ t });
    assert.ok(h.items[0].t >= 400);
    h.clear();
    assert.equal(h.length, 0);
  });
});
