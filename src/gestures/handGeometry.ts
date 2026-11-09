import { HAND_LM as L, type Point2, type TrackedHand } from '../vision/landmarkTypes';
import { GESTURE_CONFIG as C } from './gestureConfig';

export type PoseKind = 'none' | 'star' | 'draw';
export type FingerName = 'index' | 'middle' | 'ring' | 'pinky';

const FINGER_JOINTS: Record<FingerName, { pip: number; tip: number }> = {
  index: { pip: L.INDEX_PIP, tip: L.INDEX_TIP },
  middle: { pip: L.MIDDLE_PIP, tip: L.MIDDLE_TIP },
  ring: { pip: L.RING_PIP, tip: L.RING_TIP },
  pinky: { pip: L.PINKY_PIP, tip: L.PINKY_TIP },
};

/** Isotropic distance between two normalised points (x is scaled by the stage aspect ratio). */
export function dist(a: Point2, b: Point2, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

/** Hand size: wrist -> middle-finger knuckle. Our unit of "one palm". */
export function handSize(hand: TrackedHand, aspect: number): number {
  return dist(hand.landmarks[L.WRIST], hand.landmarks[L.MIDDLE_MCP], aspect);
}

/** Centre of the palm (mean of wrist and the four finger knuckles). */
export function palmCenter(hand: TrackedHand): Point2 {
  const ids = [L.WRIST, L.INDEX_MCP, L.MIDDLE_MCP, L.RING_MCP, L.PINKY_MCP];
  let x = 0;
  let y = 0;
  for (const i of ids) {
    x += hand.landmarks[i].x;
    y += hand.landmarks[i].y;
  }
  return { x: x / ids.length, y: y / ids.length };
}

/**
 * Orientation-independent extension ratio: how much further from the wrist the fingertip is
 * than the middle joint. > ~1.2 means extended, < ~1.0 means folded into the palm.
 */
export function extensionRatio(hand: TrackedHand, finger: FingerName, aspect: number): number {
  const wrist = hand.landmarks[L.WRIST];
  const { pip, tip } = FINGER_JOINTS[finger];
  const dPip = dist(hand.landmarks[pip], wrist, aspect);
  const dTip = dist(hand.landmarks[tip], wrist, aspect);
  return dPip > 1e-6 ? dTip / dPip : 0;
}

export interface HandAnalysis {
  pose: PoseKind;
  size: number;
  ratios: Record<FingerName, number>;
  /** Index<->middle fingertip distance in palm units. */
  closeness: number;
  /** Where the gesture "points": index tip (star) or index/middle midpoint (draw). */
  cursor: Point2;
}

/**
 * Classify a hand as `star` (one raised index finger), `draw` (index + middle extended and
 * touching, other fingers folded) or `none`. `prev` is the pose this hand had last frame and
 * selects the hysteresis thresholds (enter vs. hold) so the classification does not flicker.
 */
export function analyzeHand(hand: TrackedHand, aspect: number, prev: PoseKind): HandAnalysis {
  const lm = hand.landmarks;
  const size = handSize(hand, aspect);
  const ratios: Record<FingerName, number> = {
    index: extensionRatio(hand, 'index', aspect),
    middle: extensionRatio(hand, 'middle', aspect),
    ring: extensionRatio(hand, 'ring', aspect),
    pinky: extensionRatio(hand, 'pinky', aspect),
  };
  const idxTip = lm[L.INDEX_TIP];
  const midTip = lm[L.MIDDLE_TIP];
  const closeness = size > 1e-6 ? dist(idxTip, midTip, aspect) / size : Infinity;
  const base = { size, ratios, closeness };

  if (!(size >= C.minHandSize)) {
    return { ...base, pose: 'none', cursor: { x: idxTip.x, y: idxTip.y } };
  }

  const wasActive = prev !== 'none';
  const indexExt = ratios.index > (wasActive ? C.extend.hold : C.extend.enter);
  const middleExt = ratios.middle > (prev === 'draw' ? C.extend.hold : C.extend.enter);
  const middleFold = ratios.middle < (prev === 'star' ? C.fold.hold : C.fold.enter);
  const ringFold = ratios.ring < (wasActive ? C.fold.hold : C.fold.enter);
  const pinkyFold = ratios.pinky < (wasActive ? C.fold.hold : C.fold.enter);
  const close = closeness < (prev === 'draw' ? C.close.hold : C.close.enter);

  if (indexExt && middleFold && ringFold && pinkyFold) {
    return { ...base, pose: 'star', cursor: { x: idxTip.x, y: idxTip.y } };
  }
  if (indexExt && middleExt && ringFold && pinkyFold && close) {
    return {
      ...base,
      pose: 'draw',
      cursor: { x: (idxTip.x + midTip.x) / 2, y: (idxTip.y + midTip.y) / 2 },
    };
  }
  return { ...base, pose: 'none', cursor: { x: idxTip.x, y: idxTip.y } };
}
