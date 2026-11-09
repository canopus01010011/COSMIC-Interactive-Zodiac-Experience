import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GestureRecognizer, type GestureEvent } from '../src/gestures/gestureRecognizer';
import { FinishGestureDetector } from '../src/gestures/finishGesture';
import { HAND_LM as L } from '../src/vision/landmarkTypes';
import { buildMockHand, type MockHandSpec } from '../src/vision/mockHand';
import { count, run } from './helpers';

const ASPECT = 16 / 9;

const openHands = (left = 0.2, right = 0.8, size = 0.15): MockHandSpec[] => [
  { pose: 'open', x: left, y: 0.55, size },
  { pose: 'open', x: right, y: 0.55, size },
];

describe('two open palms finish gesture', () => {
  it('finishes after holding both open palms apart', () => {
    const recognizer = new GestureRecognizer();
    const events: GestureEvent[] = [];

    run(recognizer, 0, 900, () => openHands(), events);

    assert.equal(count(events, 'FINISH_GESTURE'), 1);
  });

  it('works with hands at different distances from the camera', () => {
    for (const size of [0.07, 0.12, 0.2]) {
      const recognizer = new GestureRecognizer();
      const events: GestureEvent[] = [];
      run(recognizer, 0, 900, () => openHands(0.15, 0.85, size), events);
      assert.equal(count(events, 'FINISH_GESTURE'), 1, `hand size ${size}`);
    }
  });

  it('does not trigger for one hand, closed fingers, or palms held close together', () => {
    const recognizer = new GestureRecognizer();
    const events: GestureEvent[] = [];
    run(recognizer, 0, 1200, () => [openHands()[0]], events);
    run(recognizer, 1200, 1200, () => [
      { pose: 'two', x: 0.2, y: 0.55 },
      { pose: 'two', x: 0.8, y: 0.55 },
    ], events);
    run(recognizer, 2400, 1200, () => openHands(0.44, 0.56), events);
    assert.equal(count(events, 'FINISH_GESTURE'), 0);
  });

  it('does not confuse the two-hand heart pose with the finish gesture', () => {
    const detector = new FinishGestureDetector();
    const left = buildMockHand({ pose: 'open', x: 0.3, y: 0.5, aspect: ASPECT });
    const right = buildMockHand({ pose: 'open', x: 0.7, y: 0.5, aspect: ASPECT });
    left.landmarks[L.INDEX_TIP] = { x: 0.49, y: 0.4, z: 0 };
    right.landmarks[L.INDEX_TIP] = { x: 0.51, y: 0.4, z: 0 };
    left.landmarks[L.THUMB_TIP] = { x: 0.49, y: 0.56, z: 0 };
    right.landmarks[L.THUMB_TIP] = { x: 0.51, y: 0.56, z: 0 };

    for (let t = 0; t < 1200; t += 33) {
      assert.equal(detector.update(t, [left, right], ASPECT), false);
    }
  });

  it('fires only once while the pose is held and rearms after the pose is released', () => {
    const recognizer = new GestureRecognizer();
    const events: GestureEvent[] = [];
    let result = run(recognizer, 0, 2200, () => openHands(), events);
    assert.equal(count(events, 'FINISH_GESTURE'), 1);

    result = run(recognizer, result.endT, 200, () => [openHands()[0]], events);
    run(recognizer, result.endT, 900, () => openHands(), events);
    assert.equal(count(events, 'FINISH_GESTURE'), 2);
  });

  it('closes an open stroke before reporting the finish gesture', () => {
    const recognizer = new GestureRecognizer();
    const events: GestureEvent[] = [];
    let result = run(recognizer, 0, 700, () => [
      { pose: 'two', x: 0.8, y: 0.5 },
      { pose: 'open', x: 0.15, y: 0.5 },
    ], events);
    result = run(recognizer, result.endT, 900, () => openHands(0.15, 0.8), events);

    const finishIndex = events.findIndex((event) => event.type === 'FINISH_GESTURE');
    const drawEndIndex = events.findIndex((event) => event.type === 'DRAW_END');
    assert.ok(finishIndex >= 0 && drawEndIndex >= 0 && drawEndIndex <= finishIndex);
  });
});
