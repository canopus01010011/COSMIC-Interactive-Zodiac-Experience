import type { TrackedHand } from '../vision/landmarkTypes';
import { GESTURE_CONFIG, type GestureConfig } from './gestureConfig';
import { dist, extensionRatio, handSize, palmCenter, type FingerName } from './handGeometry';
import { isHandHeartPose } from './heartPose';

const FINGERS: FingerName[] = ['index', 'middle', 'ring', 'pinky'];

/** Triggers a transformation when two open palms are held apart. */
export class FinishGestureDetector {
  private poseSince: number | null = null;
  private lastValidT = -Infinity;
  private lastTriggerT = -Infinity;
  private latched = false;

  constructor(private readonly cfg: GestureConfig = GESTURE_CONFIG) {}

  update(t: number, hands: TrackedHand[], aspect: number): boolean {
    const config = this.cfg.finishGesture;
    const validPose = this.hasWideOpenPalms(hands, aspect);

    if (!validPose) {
      if (t - this.lastValidT > config.trackingGraceMs) {
        this.poseSince = null;
        this.latched = false;
      }
      return false;
    }

    this.poseSince ??= t;
    this.lastValidT = t;
    if (this.latched || t - this.poseSince < config.holdMs || t - this.lastTriggerT < config.cooldownMs) {
      return false;
    }

    this.lastTriggerT = t;
    this.latched = true;
    return true;
  }

  reset(): void {
    this.poseSince = null;
    this.lastValidT = -Infinity;
    this.lastTriggerT = -Infinity;
    this.latched = false;
  }

  private hasWideOpenPalms(hands: TrackedHand[], aspect: number): boolean {
    if (isHandHeartPose(hands, aspect)) return false;

    const openHands = hands.filter((hand) =>
      handSize(hand, aspect) >= this.cfg.minHandSize &&
      FINGERS.every((finger) => extensionRatio(hand, finger, aspect) >= this.cfg.finishGesture.extensionRatio),
    );

    for (let i = 0; i < openHands.length; i++) {
      for (let j = i + 1; j < openHands.length; j++) {
        const averageSize = (handSize(openHands[i], aspect) + handSize(openHands[j], aspect)) / 2;
        const separation = dist(palmCenter(openHands[i]), palmCenter(openHands[j]), aspect) / averageSize;
        if (separation >= this.cfg.finishGesture.minSeparation) return true;
      }
    }
    return false;
  }
}
