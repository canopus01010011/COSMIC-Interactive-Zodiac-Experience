import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { createWithDelegateFallback, getVisionFileset } from './handTracker';
import { resolveModelUrl } from './mediapipeAssets';
import type { HeadPose, Point2, TrackedEye, TrackedFace } from './landmarkTypes';

/** MediaPipe Face Mesh landmark indices used for the eyes. */
const EYE = {
  /** Subject's right eye (corners) and iris centre. */
  a: { outer: 33, inner: 133, iris: 468 },
  /** Subject's left eye (corners) and iris centre. */
  b: { outer: 263, inner: 362, iris: 473 },
} as const;

interface Lm {
  x: number;
  y: number;
}

/** Pure function (unit-testable): derive eye positions from raw (un-mirrored) face landmarks. */
export function eyesFromLandmarks(lms: readonly Lm[], aspect: number): TrackedFace | null {
  if (lms.length < 468) return null;
  const hasIris = lms.length >= 478;

  const build = (e: { outer: number; inner: number; iris: number }): TrackedEye => {
    const o = lms[e.outer];
    const i = lms[e.inner];
    const cx = hasIris ? lms[e.iris].x : (o.x + i.x) / 2;
    const cy = hasIris ? lms[e.iris].y : (o.y + i.y) / 2;
    const width = Math.hypot((o.x - i.x) * aspect, o.y - i.y);
    return { x: 1 - cx, y: cy, radius: width / 2 };
  };

  const a = build(EYE.a);
  const b = build(EYE.b);
  // After mirroring, "left" is the eye with the smaller x.
  const [leftEye, rightEye] = a.x <= b.x ? [a, b] : [b, a];
  const roll = Math.atan2((rightEye.y - leftEye.y), (rightEye.x - leftEye.x) * aspect);
  return { leftEye, rightEye, roll, hasIris, head: headFromLandmarks(lms, aspect) };
}

/** Pure function (unit-testable): head anchor above the forehead, face width, roll and yaw from raw landmarks. */
export function headFromLandmarks(lms: readonly Lm[], aspect: number): HeadPose | undefined {
  const top = lms[10];
  const chin = lms[152];
  const cheekA = lms[234];
  const cheekB = lms[454];
  const nose = lms[1];
  if (!top || !chin || !cheekA || !cheekB || !nose) return undefined;
  const width = Math.hypot((cheekA.x - cheekB.x) * aspect, cheekA.y - cheekB.y);
  if (width < 1e-3) return undefined;
  // Up axis of the head (chin -> forehead) in isotropic, mirrored space.
  const ux = (-(top.x - chin.x)) * aspect;
  const uy = top.y - chin.y;
  const len = Math.hypot(ux, uy) || 1;
  const roll = Math.atan2(ux, -uy);
  const lift = 0.1 * width;
  const x = 1 - top.x + ((ux / len) * lift) / aspect;
  const y = top.y + (uy / len) * lift;
  const mid = 1 - (cheekA.x + cheekB.x) / 2;
  const half = Math.abs(cheekA.x - cheekB.x) / 2 || 1e-3;
  const ratio = Math.max(-1, Math.min(1, (1 - nose.x - mid) / half));
  return { x, y, width, roll, yaw: ratio * 0.9 };
}

/** MediaPipe Face Landmarker wrapper: eye centres (iris when available) in display space. */
export class FaceTracker {
  private lastTimestamp = -1;

  private constructor(private readonly landmarker: FaceLandmarker) {}

  static async create(): Promise<FaceTracker> {
    const [{ FaceLandmarker }, fileset, modelAssetPath] = await Promise.all([
      import('@mediapipe/tasks-vision'),
      getVisionFileset(),
      resolveModelUrl('face_landmarker'),
    ]);
    const landmarker = await createWithDelegateFallback((delegate) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      }),
    );
    return new FaceTracker(landmarker);
  }

  detect(video: HTMLVideoElement, nowMs: number, aspect: number): TrackedFace | null {
    const ts = Math.max(nowMs, this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    const result = this.landmarker.detectForVideo(video, ts);
    const lms = result.faceLandmarks?.[0];
    if (!lms) return null;
    const face = eyesFromLandmarks(lms, aspect);
    if (face) {
      // Sparse mirrored landmarks for the debug overlay (face oval corners + nose).
      const pts: Point2[] = [1, 10, 33, 61, 133, 152, 263, 291, 362].map((i) => ({ x: 1 - lms[i].x, y: lms[i].y }));
      face.debugPoints = pts;
    }
    return face;
  }

  close(): void {
    try {
      this.landmarker.close();
    } catch {
      /* ignore */
    }
  }
}
