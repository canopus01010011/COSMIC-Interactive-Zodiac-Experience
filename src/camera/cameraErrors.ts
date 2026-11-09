export type CameraErrorCode =
  | 'permission-denied'
  | 'no-device'
  | 'device-busy'
  | 'insecure-context'
  | 'unsupported'
  | 'overconstrained'
  | 'aborted'
  | 'stream-ended'
  | 'tracking-unavailable'
  | 'webgl-unavailable'
  | 'unknown';

export interface ErrorDescription {
  title: string;
  message: string;
  /** Concrete recovery instructions shown to the user. */
  steps: string[];
}

const DESCRIPTIONS: Record<CameraErrorCode, ErrorDescription> = {
  'permission-denied': {
    title: 'Camera access was blocked',
    message: 'COSMIC needs your webcam to track your hands and show you in the experience. Nothing is recorded or uploaded.',
    steps: [
      'Click the camera / lock icon in your browser\'s address bar and set Camera to "Allow".',
      'Check that your operating system allows this browser to use the camera (System Settings > Privacy > Camera).',
      'Then press "Try again".',
    ],
  },
  'no-device': {
    title: 'No webcam found',
    message: 'The browser could not find a camera on this computer.',
    steps: [
      'Plug in a USB webcam, or check that your built-in camera is enabled.',
      'If you just connected one, give it a few seconds, then press "Try again".',
    ],
  },
  'device-busy': {
    title: 'The camera is already in use',
    message: 'Another application or browser tab is using the webcam, so COSMIC cannot open it.',
    steps: [
      'Close other apps that may use the camera (video calls, recorders, other browser tabs).',
      'Then press "Try again".',
    ],
  },
  'insecure-context': {
    title: 'Camera needs a secure connection',
    message: 'Browsers only allow webcam access on HTTPS pages or on localhost.',
    steps: [
      'Open COSMIC from http://localhost:5173 during development, or serve it over HTTPS when deployed.',
    ],
  },
  unsupported: {
    title: 'This browser cannot access a webcam',
    message: 'The camera API (getUserMedia) is not available here.',
    steps: ['Use a recent version of Chrome, Edge, Firefox or Safari on a desktop or laptop.'],
  },
  overconstrained: {
    title: 'The camera does not support the requested settings',
    message: 'The webcam could not provide a video stream with the requested resolution.',
    steps: ['Press "Try again". If it keeps failing, try another camera or restart the browser.'],
  },
  aborted: {
    title: 'The camera could not be started',
    message: 'Starting the webcam was interrupted.',
    steps: ['Press "Try again". If it keeps failing, reload the page.'],
  },
  'stream-ended': {
    title: 'The camera was disconnected',
    message: 'The webcam stream stopped - it may have been unplugged, or camera permission was revoked.',
    steps: [
      'Check that the webcam is connected and that camera permission is still allowed for this page.',
      'Then press "Try again".',
    ],
  },
  'tracking-unavailable': {
    title: 'Hand tracking could not be loaded',
    message: 'The hand-tracking model failed to load, so COSMIC cannot follow your hands.',
    steps: [
      'Check your internet connection (the models are fetched from Google storage if they are not bundled).',
      'Developers: run "npm run setup:mediapipe" to bundle the models locally.',
      'Then press "Try again".',
    ],
  },
  'webgl-unavailable': {
    title: 'WebGL is not available',
    message: 'COSMIC renders its 3D effects with WebGL, which this browser or computer has disabled or does not support.',
    steps: [
      'Use a recent desktop version of Chrome, Edge, Firefox or Safari.',
      'Make sure hardware acceleration is enabled in the browser settings, then reload the page.',
    ],
  },
  unknown: {
    title: 'Something went wrong with the camera',
    message: 'An unexpected error occurred while starting the webcam.',
    steps: ['Press "Try again". If it keeps failing, reload the page or restart the browser.'],
  },
};

export class CameraError extends Error {
  readonly code: CameraErrorCode;
  readonly title: string;
  readonly steps: string[];

  constructor(code: CameraErrorCode, detail?: string, options?: { cause?: unknown }) {
    const d = DESCRIPTIONS[code];
    super(detail ? `${d.message} (${detail})` : d.message, options);
    this.name = 'CameraError';
    this.code = code;
    this.title = d.title;
    this.steps = d.steps;
  }
}

/** Translate a getUserMedia / DOM exception into a CameraError with recovery instructions. */
export function mapCameraError(err: unknown): CameraError {
  if (err instanceof CameraError) return err;
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  const detail = err instanceof Error ? err.message : undefined;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return new CameraError('permission-denied', undefined, { cause: err });
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new CameraError('no-device', undefined, { cause: err });
    case 'NotReadableError':
    case 'TrackStartError':
      return new CameraError('device-busy', undefined, { cause: err });
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return new CameraError('overconstrained', undefined, { cause: err });
    case 'AbortError':
      return new CameraError('aborted', undefined, { cause: err });
    case 'SecurityError':
      return new CameraError('insecure-context', undefined, { cause: err });
    case 'TypeError':
      return new CameraError('unsupported', detail, { cause: err });
    default:
      return new CameraError('unknown', detail, { cause: err });
  }
}
