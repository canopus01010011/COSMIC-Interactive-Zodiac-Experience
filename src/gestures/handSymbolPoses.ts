import { HAND_LM as L, type TrackedHand } from '../vision/landmarkTypes';
import { dist, handSize } from './handGeometry';

/** Detects an ASL-style C handshape from the thumb/index gap and curled finger-tip span. */
export function isHandCPose(hands: readonly TrackedHand[], aspect: number): boolean {
  if (hands.length !== 1) return false;
  const hand = hands[0];
  const size = handSize(hand, aspect);
  if (size <= 1e-6) return false;

  const thumbIndexGap = dist(hand.landmarks[L.THUMB_TIP], hand.landmarks[L.INDEX_TIP], aspect) / size;
  const fingerSpan = dist(hand.landmarks[L.INDEX_TIP], hand.landmarks[L.PINKY_TIP], aspect) / size;
  return thumbIndexGap >= 0.3 && thumbIndexGap <= 0.9 && fingerSpan < 0.78;
}
