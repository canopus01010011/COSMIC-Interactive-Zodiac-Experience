/**
 * Shared vision types.
 *
 * COORDINATE CONVENTION (important - used everywhere downstream):
 *   x, y are normalised 0..1 over the *displayed, mirrored* camera stage
 *   (origin top-left, y down). The vision layer converts from raw video
 *   coordinates (x -> 1 - x) so that nothing else needs to know about mirroring.
 *   The stage always has the same aspect ratio as the video, so a normalised
 *   position maps 1:1 to the video, the 2D overlay and the 3D scene.
 *   `aspect` (= width / height) is carried on each frame so that distances can
 *   be measured isotropically (multiply dx by aspect).
 */

export interface Point2 {
  x: number;
  y: number;
}

export interface Landmark extends Point2 {
  z: number;
}

/** MediaPipe hand landmark indices (21 points). */
export const HAND_LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export const FINGERTIP_INDICES: ReadonlyArray<number> = [4, 8, 12, 16, 20];

export type Handedness = 'Left' | 'Right' | 'Unknown';

export interface TrackedHand {
  /** 21 landmarks, display-normalised (mirrored). */
  landmarks: Landmark[];
  handedness: Handedness;
  /** Detection / handedness confidence 0..1. */
  score: number;
}

export interface TrackedEye {
  x: number;
  y: number;
  /** Approximate eye half-width, in stage-HEIGHT units (multiply by stage height for pixels). */
  radius: number;
}

/** Where the top of the head is and how it is turned (display space). */
export interface HeadPose {
  /** Crown anchor: just above the forehead, normalised stage coordinates. */
  x: number;
  y: number;
  /** Face width (cheek to cheek) in stage-HEIGHT units. */
  width: number;
  /** Radians; 0 = upright, positive = top of the head leaning to the right of the screen. */
  roll: number;
  /** Radians; positive = face turned towards the right of the screen. */
  yaw: number;
}

export interface TrackedFace {
  leftEye: TrackedEye;
  rightEye: TrackedEye;
  /** Head roll in radians (eye line angle). */
  roll: number;
  /** True when iris landmarks were available; otherwise eye centres come from the eye corners. */
  hasIris: boolean;
  /** Head position / orientation (used by the crystal crown). */
  head?: HeadPose;
  /** Optional sparse landmark set for the debug overlay. */
  debugPoints?: Point2[];
}

export interface VisionFrame {
  /** performance.now() timestamp in ms. */
  t: number;
  hands: TrackedHand[];
  face: TrackedFace | null;
  /** Stage / video aspect ratio (width / height). */
  aspect: number;
}
