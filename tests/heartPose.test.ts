import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isHandHeartPose } from '../src/gestures/heartPose';
import { buildMockHand } from '../src/vision/mockHand';

const ASPECT = 16 / 9;

function handHeartPair() {
  const left = buildMockHand({ pose: 'open', x: 0.4, y: 0.5, aspect: ASPECT });
  const right = buildMockHand({ pose: 'open', x: 0.6, y: 0.5, aspect: ASPECT });
  left.landmarks[8] = { x: 0.49, y: 0.4, z: 0 };
  right.landmarks[8] = { x: 0.51, y: 0.4, z: 0 };
  left.landmarks[4] = { x: 0.49, y: 0.56, z: 0 };
  right.landmarks[4] = { x: 0.51, y: 0.56, z: 0 };
  return [left, right];
}

describe('two-hand heart pose', () => {
  it('recognises paired index tips above paired thumbs', () => {
    assert.equal(isHandHeartPose(handHeartPair(), ASPECT), true);
  });

  it('does not trigger for a single hand, separated fingertips, or an inverted pose', () => {
    const pair = handHeartPair();
    assert.equal(isHandHeartPose(pair.slice(0, 1), ASPECT), false);

    pair[1].landmarks[8] = { x: 0.7, y: 0.4, z: 0 };
    assert.equal(isHandHeartPose(pair, ASPECT), false);

    const inverted = handHeartPair();
    inverted[0].landmarks[4] = { x: 0.49, y: 0.35, z: 0 };
    inverted[1].landmarks[4] = { x: 0.51, y: 0.35, z: 0 };
    assert.equal(isHandHeartPose(inverted, ASPECT), false);
  });
});
