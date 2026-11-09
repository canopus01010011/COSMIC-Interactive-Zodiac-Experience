import { HAND_LM as L, type Point2, type TrackedHand } from '../vision/landmarkTypes';
import { dist } from './handGeometry';

/**
 * Detects the common two-hand heart pose: paired index fingertips form the upper dip, and paired
 * thumbs form the lower point. Distances are measured in stage-height units.
 */
export function isHandHeartPose(hands: readonly TrackedHand[], aspect: number): boolean {
  if (hands.length !== 2) return false;
  const [a, b] = hands;
  const indexA = a.landmarks[L.INDEX_TIP];
  const indexB = b.landmarks[L.INDEX_TIP];
  const thumbA = a.landmarks[L.THUMB_TIP];
  const thumbB = b.landmarks[L.THUMB_TIP];
  const indexGap = dist(indexA, indexB, aspect);
  const thumbGap = dist(thumbA, thumbB, aspect);
  if (indexGap > 0.13 || thumbGap > 0.13) return false;

  const indexCenter = midpoint(indexA, indexB);
  const thumbCenter = midpoint(thumbA, thumbB);
  const height = thumbCenter.y - indexCenter.y;
  if (height < 0.045 || height > 0.3) return false;

  const spanA = dist(indexA, thumbA, aspect);
  const spanB = dist(indexB, thumbB, aspect);
  return spanA > 0.05 && spanB > 0.05;
}

function midpoint(a: Point2, b: Point2): Point2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
