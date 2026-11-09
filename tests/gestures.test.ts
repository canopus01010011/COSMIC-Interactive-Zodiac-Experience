import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GESTURE_CONFIG } from '../src/gestures/gestureConfig';
import { analyzeHand } from '../src/gestures/handGeometry';
import { GestureRecognizer, type GestureEvent } from '../src/gestures/gestureRecognizer';
import { buildMockHand, type MockPose } from '../src/vision/mockHand';
import { ASPECT, count, run } from './helpers';

describe('pose classification (landmark geometry)', () => {
  const classify = (pose: MockPose, rotation = 0, size = 0.16) =>
    analyzeHand(buildMockHand({ pose, x: 0.5, y: 0.5, rotation, size, aspect: ASPECT }), ASPECT, 'none').pose;

  it('recognises one raised finger as "star"', () => assert.equal(classify('one'), 'star'));
  it('recognises two close fingers as "draw"', () => assert.equal(classify('two'), 'draw'));
  it('does not trigger on an open hand, a fist or a spread peace sign', () => {
    assert.equal(classify('open'), 'none');
    assert.equal(classify('fist'), 'none');
    assert.equal(classify('peace'), 'none');
  });
  it('is rotation invariant', () => {
    for (const r of [-1.0, -0.5, 0.4, 0.9]) {
      assert.equal(classify('one', r), 'star', `one @ ${r}`);
      assert.equal(classify('two', r), 'draw', `two @ ${r}`);
    }
  });
  it('works across hand sizes (near / far from the camera) but ignores tiny hands', () => {
    assert.equal(classify('one', 0, 0.06), 'star');
    assert.equal(classify('one', 0, 0.3), 'star');
    assert.equal(classify('one', 0, 0.02), 'none');
  });
  it('does not call a half-curled middle finger a one-finger gesture', () => {
    const hand = buildMockHand({ pose: 'one', x: 0.5, y: 0.5, aspect: ASPECT });
    // Lift the middle fingertip about half way out of the fold (extension ratio ~1.07: neither
    // clearly folded nor clearly extended).
    hand.landmarks[12] = { ...hand.landmarks[12], y: hand.landmarks[12].y - 0.07 };
    const ratio = analyzeHand(hand, ASPECT, 'none').ratios.middle;
    assert.ok(ratio > GESTURE_CONFIG.fold.enter && ratio < GESTURE_CONFIG.extend.enter, `ratio ${ratio}`);
    assert.equal(analyzeHand(hand, ASPECT, 'none').pose, 'none');
  });
  it('uses hysteresis: a pose that is borderline stays active but cannot be entered', () => {
    const hand = buildMockHand({ pose: 'two', x: 0.5, y: 0.5, aspect: ASPECT });
    // Spread the fingertips so closeness lands between the enter (0.34) and hold (0.5) thresholds.
    const size = analyzeHand(hand, ASPECT, 'none').size;
    hand.landmarks[8] = { ...hand.landmarks[8], x: hand.landmarks[8].x - (0.28 * size) / ASPECT };
    const closeness = analyzeHand(hand, ASPECT, 'none').closeness;
    assert.ok(closeness > GESTURE_CONFIG.close.enter && closeness < GESTURE_CONFIG.close.hold, `closeness ${closeness}`);
    assert.equal(analyzeHand(hand, ASPECT, 'none').pose, 'none');
    assert.equal(analyzeHand(hand, ASPECT, 'draw').pose, 'draw');
  });
});

describe('GestureRecognizer - temporal stability', () => {
  it('requires a confirmation interval before a gesture becomes active', () => {
    const rec = new GestureRecognizer();
    const one = [{ pose: 'one' as const, x: 0.5, y: 0.5 }];
    const early = run(rec, 0, 100, () => one);
    assert.equal(early.last?.state.activeGesture, 'none', 'not active after 100ms');
    const later = run(rec, early.endT, 300, () => one);
    assert.equal(later.last?.state.activeGesture, 'star');
  });

  it('a single stray frame does not switch modes', () => {
    const rec = new GestureRecognizer();
    let r = run(rec, 0, 600, () => [{ pose: 'one', x: 0.5, y: 0.5 }]);
    assert.equal(r.last?.state.activeGesture, 'star');
    // One frame of an open hand in the middle of a one-finger gesture.
    r = run(rec, r.endT, 34, () => [{ pose: 'open', x: 0.5, y: 0.5 }]);
    assert.equal(r.last?.state.activeGesture, 'star');
    r = run(rec, r.endT, 300, () => [{ pose: 'one', x: 0.5, y: 0.5 }]);
    assert.equal(r.last?.state.activeGesture, 'star');
  });

  it('leaves the gesture after the pose is gone for the exit interval', () => {
    const rec = new GestureRecognizer();
    let r = run(rec, 0, 600, () => [{ pose: 'one', x: 0.5, y: 0.5 }]);
    r = run(rec, r.endT, 400, () => [{ pose: 'open', x: 0.5, y: 0.5 }]);
    assert.equal(r.last?.state.activeGesture, 'none');
  });

  it('switches directly from star to draw', () => {
    const rec = new GestureRecognizer();
    let r = run(rec, 0, 600, () => [{ pose: 'one', x: 0.5, y: 0.5 }]);
    r = run(rec, r.endT, 600, () => [{ pose: 'two', x: 0.5, y: 0.5 }]);
    assert.equal(r.last?.state.activeGesture, 'draw');
  });
});

describe('Mode 1 - star summoning', () => {
  it('places exactly one star after a ~1 second stationary hold, at the fingertip', () => {
    const rec = new GestureRecognizer();
    const events: GestureEvent[] = [];
    run(rec, 0, 2500, () => [{ pose: 'one', x: 0.4, y: 0.35 }], events);
    assert.equal(count(events, 'STAR_HOLD'), 1, 'exactly one star for one long hold');
    const star = events.find((e) => e.type === 'STAR_HOLD');
    assert.ok(star && star.type === 'STAR_HOLD');
    assert.ok(Math.abs(star.point.x - 0.4) < 0.01 && Math.abs(star.point.y - 0.35) < 0.01, 'placed at the fingertip');
    assert.ok(star.t >= 1000 && star.t <= 1700, `placed at ${star.t}ms (after confirm + ~1s hold)`);
  });

  it('does not place a star when the fingertip keeps moving', () => {
    const rec = new GestureRecognizer();
    const events: GestureEvent[] = [];
    run(rec, 0, 4000, (ms) => [{ pose: 'one', x: 0.3 + 0.3 * Math.abs(Math.sin(ms / 700)), y: 0.4 }], events);
    assert.equal(count(events, 'STAR_HOLD'), 0);
  });

  it('tolerates natural fingertip jitter while holding still', () => {
    const rec = new GestureRecognizer();
    const events: GestureEvent[] = [];
    run(
      rec,
      0,
      2200,
      (ms) => [{ pose: 'one', x: 0.5 + 0.0025 * Math.sin(ms / 31), y: 0.5 + 0.0025 * Math.cos(ms / 23) }],
      events,
    );
    assert.equal(count(events, 'STAR_HOLD'), 1);
  });

  it('requires movement (re-arm) before placing a second star, then places it', () => {
    const rec = new GestureRecognizer();
    const events: GestureEvent[] = [];
    let r = run(rec, 0, 3500, () => [{ pose: 'one', x: 0.3, y: 0.4 }], events);
    assert.equal(count(events, 'STAR_HOLD'), 1, 'no duplicates while holding');
    r = run(rec, r.endT, 2600, () => [{ pose: 'one', x: 0.55, y: 0.4 }], events);
    assert.equal(count(events, 'STAR_HOLD'), 2, 'second star after moving away and holding');
    const stars = events.filter((e) => e.type === 'STAR_HOLD');
    assert.ok(stars.length === 2);
  });

  it('exposes hold progress for the on-screen ring', () => {
    const rec = new GestureRecognizer();
    const r = run(rec, 0, 900, () => [{ pose: 'one', x: 0.5, y: 0.5 }]);
    const p = r.last?.state.holdProgress ?? 0;
    assert.ok(p > 0.2 && p < 1, `progress ${p}`);
  });
});

describe('Mode 2 - celestial drawing', () => {
  it('draws only while the two-finger pose is held and ends cleanly on release', () => {
    const rec = new GestureRecognizer();
    const events: GestureEvent[] = [];
    let r = run(rec, 0, 400, () => [{ pose: 'two', x: 0.3, y: 0.5 }], events);
    r = run(rec, r.endT, 1200, (ms) => [{ pose: 'two', x: 0.3 + ms / 4000, y: 0.5 + 0.1 * Math.sin(ms / 400) }], events);
    r = run(rec, r.endT, 600, () => [{ pose: 'open', x: 0.6, y: 0.5 }], events);
    assert.equal(count(events, 'DRAW_START'), 1);
    assert.ok(count(events, 'DRAW_MOVE') > 10, 'collected points while moving');
    assert.equal(count(events, 'DRAW_END'), 1);
    const end = events.find((e) => e.type === 'DRAW_END');
    assert.ok(end && end.type === 'DRAW_END' && end.reason === 'released');
    const startIdx = events.findIndex((e) => e.type === 'DRAW_START');
    const endIdx = events.findIndex((e) => e.type === 'DRAW_END');
    assert.ok(startIdx < endIdx);
  });

  it('ignores tiny jitter (no DRAW_MOVE while the hand is still)', () => {
    const rec = new GestureRecognizer();
    const events: GestureEvent[] = [];
    run(rec, 0, 1500, (ms) => [{ pose: 'two', x: 0.5 + 0.0008 * Math.sin(ms / 20), y: 0.5 }], events);
    assert.equal(count(events, 'DRAW_START'), 1);
    assert.ok(count(events, 'DRAW_MOVE') <= 2, `${count(events, 'DRAW_MOVE')} moves while still`);
  });

  it('does not start drawing during ordinary hand movement (open hand, peace sign)', () => {
    const rec = new GestureRecognizer();
    const events: GestureEvent[] = [];
    run(rec, 0, 1500, (ms) => [{ pose: 'open', x: 0.3 + ms / 5000, y: 0.5 }], events);
    run(rec, 1600, 1500, (ms) => [{ pose: 'peace', x: 0.3 + ms / 5000, y: 0.5 }], events);
    assert.equal(count(events, 'DRAW_START'), 0);
  });

  it('ends the stroke when tracking is lost and does not join a distant point afterwards', () => {
    const rec = new GestureRecognizer();
    const events: GestureEvent[] = [];
    let r = run(rec, 0, 1000, (ms) => [{ pose: 'two', x: 0.2 + ms / 5000, y: 0.5 }], events);
    r = run(rec, r.endT, 500, () => [], events); // hand leaves the frame
    const endAfterLoss = events.filter((e) => e.type === 'DRAW_END');
    assert.equal(endAfterLoss.length, 1);
    assert.ok(endAfterLoss[0].type === 'DRAW_END' && endAfterLoss[0].reason === 'tracking-lost');
    const before = events.length;
    // Hand reappears far away: must begin a NEW stroke, never a DRAW_MOVE from the old point.
    run(rec, r.endT, 800, () => [{ pose: 'two', x: 0.85, y: 0.2 }], events);
    const after = events.slice(before);
    const firstDraw = after.find((e) => e.type === 'DRAW_START' || e.type === 'DRAW_MOVE');
    assert.ok(firstDraw && firstDraw.type === 'DRAW_START');
  });

  it('survives a one-frame tracking dropout without splitting the stroke', () => {
    const rec = new GestureRecognizer();
    const events: GestureEvent[] = [];
    let r = run(rec, 0, 800, (ms) => [{ pose: 'two', x: 0.2 + ms / 5000, y: 0.5 }], events);
    r = run(rec, r.endT, 34, () => [], events);
    r = run(rec, r.endT, 600, (ms) => [{ pose: 'two', x: 0.37 + ms / 5000, y: 0.5 }], events);
    assert.equal(count(events, 'DRAW_START'), 1);
    assert.equal(count(events, 'DRAW_END'), 0);
  });

  it('splits the stroke on a teleporting cursor instead of drawing a long line', () => {
    const rec = new GestureRecognizer();
    const events: GestureEvent[] = [];
    let r = run(rec, 0, 700, () => [{ pose: 'two', x: 0.2, y: 0.5 }], events);
    run(rec, r.endT, 700, () => [{ pose: 'two', x: 0.8, y: 0.5 }], events);
    const end = events.find((e) => e.type === 'DRAW_END');
    assert.ok(end && end.type === 'DRAW_END');
    assert.ok(count(events, 'DRAW_START') >= 2);
  });
});

describe('enabling / resetting', () => {
  it('emits nothing for a disabled gesture', () => {
    const rec = new GestureRecognizer();
    rec.enabled.star = false;
    const events: GestureEvent[] = [];
    run(rec, 0, 2500, () => [{ pose: 'one', x: 0.5, y: 0.5 }], events);
    assert.equal(events.length, 0);
  });

  it('reset() closes an open stroke', () => {
    const rec = new GestureRecognizer();
    const events: GestureEvent[] = [];
    const r = run(rec, 0, 800, (ms) => [{ pose: 'two', x: 0.2 + ms / 5000, y: 0.5 }], events);
    const resetEvents = rec.reset(r.endT);
    assert.equal(resetEvents.filter((e) => e.type === 'DRAW_END').length, 1);
    assert.equal(rec.getState().activeGesture, 'none');
  });
});
