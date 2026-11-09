/**
 * Application state machine (section 12 of the specification).
 *
 *   START -> CAMERA_READY -> IDLE <-> STAR_MODE / DRAW_MODE
 *   any gesture state --finish gesture--> TRANSFORMING -> CREATURE_MODE -> (restart) IDLE
 *   anything --camera failure--> CAMERA_ERROR -> (retry) START
 */
export type AppState =
  | 'START'
  | 'CAMERA_READY'
  | 'IDLE'
  | 'STAR_MODE'
  | 'DRAW_MODE'
  | 'TRANSFORMING'
  | 'CREATURE_MODE'
  | 'CAMERA_ERROR';

export type AppEvent =
  | 'CAMERA_OK'
  | 'CAMERA_FAIL'
  | 'TRACKING_READY'
  | 'STAR_GESTURE'
  | 'DRAW_GESTURE'
  | 'GESTURE_RELEASED'
  | 'FINISH_GESTURE'
  | 'TRANSFORM_DONE'
  | 'CANCEL'
  | 'RESTART'
  | 'CAMERA_OFF'
  | 'RETRY';

type Table = Record<AppState, Partial<Record<AppEvent, AppState>>>;

const TABLE: Table = {
  START: { CAMERA_OK: 'CAMERA_READY', CAMERA_FAIL: 'CAMERA_ERROR' },
  CAMERA_READY: { TRACKING_READY: 'IDLE', CAMERA_FAIL: 'CAMERA_ERROR', CAMERA_OFF: 'START' },
  IDLE: {
    STAR_GESTURE: 'STAR_MODE',
    DRAW_GESTURE: 'DRAW_MODE',
    FINISH_GESTURE: 'TRANSFORMING',
    CAMERA_FAIL: 'CAMERA_ERROR',
    CAMERA_OFF: 'START',
  },
  STAR_MODE: {
    GESTURE_RELEASED: 'IDLE',
    DRAW_GESTURE: 'DRAW_MODE',
    FINISH_GESTURE: 'TRANSFORMING',
    CAMERA_FAIL: 'CAMERA_ERROR',
    CAMERA_OFF: 'START',
  },
  DRAW_MODE: {
    GESTURE_RELEASED: 'IDLE',
    STAR_GESTURE: 'STAR_MODE',
    FINISH_GESTURE: 'TRANSFORMING',
    CAMERA_FAIL: 'CAMERA_ERROR',
    CAMERA_OFF: 'START',
  },
  TRANSFORMING: {
    TRANSFORM_DONE: 'CREATURE_MODE',
    CANCEL: 'IDLE',
    CAMERA_FAIL: 'CAMERA_ERROR',
    CAMERA_OFF: 'START',
  },
  CREATURE_MODE: { RESTART: 'IDLE', CAMERA_FAIL: 'CAMERA_ERROR', CAMERA_OFF: 'START' },
  CAMERA_ERROR: { RETRY: 'START' },
};

/** Returns the next state, or the same state if the event is not allowed here. */
export function transition(state: AppState, event: AppEvent): AppState {
  return TABLE[state][event] ?? state;
}

export function canTransition(state: AppState, event: AppEvent): boolean {
  return TABLE[state][event] !== undefined;
}

/** States in which the user can create stars / strokes with gestures. */
export function isDrawingState(state: AppState): boolean {
  return state === 'IDLE' || state === 'STAR_MODE' || state === 'DRAW_MODE';
}

/** States in which the camera stream is expected to be live. */
export function isCameraLive(state: AppState): boolean {
  return state !== 'START' && state !== 'CAMERA_ERROR';
}
