import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eyesFromLandmarks } from '../src/vision/faceTracker';

function fakeFace(n: number): Array<{ x: number; y: number }> {
  const lms = Array.from({ length: n }, () => ({ x: 0.5, y: 0.5 }));
  // Raw (un-mirrored) positions: subject's right eye on the image left.
  lms[33] = { x: 0.34, y: 0.4 }; lms[133] = { x: 0.42, y: 0.4 };
  lms[362] = { x: 0.58, y: 0.4 }; lms[263] = { x: 0.66, y: 0.4 };
  if (n >= 478) { lms[468] = { x: 0.38, y: 0.41 }; lms[473] = { x: 0.62, y: 0.41 }; }
  return lms;
}

describe('eye landmark extraction', () => {
  it('uses iris centres and mirrors x into display space', () => {
    const face = eyesFromLandmarks(fakeFace(478), 16 / 9);
    assert.ok(face && face.hasIris);
    assert.ok(Math.abs(face.leftEye.x - (1 - 0.62)) < 1e-9);
    assert.ok(Math.abs(face.rightEye.x - (1 - 0.38)) < 1e-9);
    assert.ok(face.leftEye.x < face.rightEye.x, 'left eye has the smaller display x');
    assert.ok(face.leftEye.radius > 0.03 && face.leftEye.radius < 0.1);
    assert.ok(Math.abs(face.roll) < 0.05);
  });

  it('falls back to eye-corner midpoints when there are no iris landmarks', () => {
    const face = eyesFromLandmarks(fakeFace(468), 16 / 9);
    assert.ok(face && !face.hasIris);
    assert.ok(Math.abs(face.rightEye.x - (1 - 0.38)) < 1e-9);
  });

  it('returns null for an incomplete landmark set', () => {
    assert.equal(eyesFromLandmarks(fakeFace(100), 16 / 9), null);
  });
});

import { headFromLandmarks } from '../src/vision/faceTracker';

describe('head pose for the crown', () => {
  const upright = () => {
    const lms = fakeFace(478);
    lms[10] = { x: 0.5, y: 0.12 }; lms[152] = { x: 0.5, y: 0.8 };
    lms[234] = { x: 0.3, y: 0.45 }; lms[454] = { x: 0.7, y: 0.45 };
    lms[1] = { x: 0.5, y: 0.5 };
    return lms;
  };
  it('anchors the crown above the forehead with the right size and no tilt', () => {
    const head = headFromLandmarks(upright(), 16 / 9)!;
    assert.ok(Math.abs(head.x - 0.5) < 1e-6);
    assert.ok(head.y < 0.12, 'above the forehead landmark');
    assert.ok(Math.abs(head.width - 0.4 * (16 / 9)) < 1e-6);
    assert.ok(Math.abs(head.roll) < 1e-6 && Math.abs(head.yaw) < 1e-6);
  });
  it('reports roll direction and yaw direction in display space', () => {
    const lms = upright();
    lms[10] = { x: 0.4, y: 0.12 }; // raw x smaller = display right: the top of the head leans right on screen
    const tilted = headFromLandmarks(lms, 16 / 9)!;
    assert.ok(tilted.roll > 0.1, `roll ${tilted.roll}`);
    const turned = upright();
    turned[1] = { x: 0.4, y: 0.5 }; // nose towards raw left = display right
    assert.ok(headFromLandmarks(turned, 16 / 9)!.yaw > 0.2);
  });
  it('is undefined when the landmarks collapse', () => {
    assert.equal(headFromLandmarks(fakeFace(478), 16 / 9), undefined);
  });
});
