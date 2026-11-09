/**
 * Every tunable gesture threshold lives here. All distances are measured in
 * "stage-height" units (the stage height is 1.0; x is multiplied by the aspect ratio),
 * or relative to hand size (wrist -> middle-finger knuckle = 1.0 "palm unit").
 *
 * These defaults are derived from landmark geometry and unit-tested, but every webcam /
 * lighting setup is different: if gestures feel too eager or too stubborn, tune them here.
 */
export const GESTURE_CONFIG = {
  /** Ignore hands detected with lower confidence than this. */
  minScore: 0.5,
  /** Ignore hands whose wrist->knuckle length is smaller than this (too far / unreliable). */
  minHandSize: 0.035,

  /**
   * Finger extension ratio = |tip - wrist| / |pip - wrist|.
   * Straight finger ~1.35-1.45, fully curled ~0.7-0.9. Enter/hold pairs give hysteresis.
   */
  extend: { enter: 1.22, hold: 1.12 },
  fold: { enter: 1.0, hold: 1.1 },

  /** Index<->middle fingertip distance in palm units for the two-finger "draw" gesture. */
  close: { enter: 0.34, hold: 0.5 },

  /** A gesture must be stable this long before it becomes active (ms). Leaving needs `none`. */
  confirmMs: { star: 220, draw: 140, none: 120 },
  /** When every hand disappears for longer than this the active gesture ends (ms). */
  lossGraceMs: 90,

  /** One-Euro cursor smoothing (units/second domain). */
  cursor: { minCutoff: 1.6, beta: 6 },

  star: {
    /** Stationary hold time that places a star (ms). */
    holdMs: 1000,
    /** Fingertip must stay within this radius of the anchor to count as "still". */
    holdRadius: 0.028,
    /** After placing, the fingertip must travel this far before another star can be placed. */
    rearmDistance: 0.07,
    /** Reject a star closer than this to an existing one. */
    minSpacing: 0.035,
    maxStars: 48,
  },

  draw: {
    /** Ignore cursor movements smaller than this (jitter). */
    minSegment: 0.004,
    /** A single-frame jump larger than this is a tracking glitch: end the stroke. */
    maxJump: 0.22,
    /** Discard strokes shorter than this. */
    minStrokeLength: 0.03,
    /** Snap stroke ends to a star within this distance. */
    snapToStar: 0.05,
    maxPointsPerStroke: 2500,
    maxStrokes: 64,
  },

  finishGesture: {
    /** Minimum wrist-to-finger distance ratio for each extended finger. */
    extensionRatio: 1.16,
    /** Minimum palm-centre distance in average palm sizes. */
    minSeparation: 2.4,
    /** Hold both open palms apart for this long (ms). */
    holdMs: 650,
    /** Brief tracking dropouts do not reset the hold (ms). */
    trackingGraceMs: 120,
    cooldownMs: 1500,
  },
} as const;

export type GestureConfig = typeof GESTURE_CONFIG;
