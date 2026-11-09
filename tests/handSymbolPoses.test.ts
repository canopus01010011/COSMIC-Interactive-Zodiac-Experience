import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isHandCPose } from '../src/gestures/handSymbolPoses';
import { buildMockHand } from '../src/vision/mockHand';
import { handSize } from '../src/gestures/handGeometry';

const ASPECT = 16 / 9;

describe('C hand pose', () => {
  it('recognises a curved C-shaped fingertip span with a visible thumb gap', () => {
    const hand = buildMockHand({ pose: 'open', x: 0.5, y: 0.5, aspect: ASPECT });
    const size = handSize(hand, ASPECT);
    const index = hand.landmarks[8];
    hand.landmarks[4] = { x: index.x + (0.55 * size) / ASPECT, y: index.y, z: 0 };
    hand.landmarks[20] = { x: index.x + (0.4 * size) / ASPECT, y: index.y, z: 0 };
    assert.equal(isHandCPose([hand], ASPECT), true);
  });

  it('rejects an open hand and more than one hand', () => {
    const open = buildMockHand({ pose: 'open', x: 0.5, y: 0.5, aspect: ASPECT });
    assert.equal(isHandCPose([open], ASPECT), false);
    assert.equal(isHandCPose([open, open], ASPECT), false);
  });
});
