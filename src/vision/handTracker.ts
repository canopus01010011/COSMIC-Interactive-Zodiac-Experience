import type { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { resolveModelUrl, resolveWasmBase } from './mediapipeAssets';
import type { Handedness, TrackedHand } from './landmarkTypes';

type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

let filesetPromise: Promise<Fileset> | null = null;

/** The MediaPipe WASM fileset is shared by the hand and face trackers. */
export async function getVisionFileset(): Promise<Fileset> {
  if (!filesetPromise) {
    filesetPromise = (async () => {
      const { FilesetResolver } = await import('@mediapipe/tasks-vision');
      return FilesetResolver.forVisionTasks(await resolveWasmBase());
    })();
    filesetPromise.catch(() => {
      filesetPromise = null;
    });
  }
  return filesetPromise;
}

export function resetVisionFileset(): void {
  filesetPromise = null;
}

/** Create a vision task on the GPU, falling back to the CPU if the GPU delegate is unavailable. */
export async function createWithDelegateFallback<T extends { close(): void }>(
  make: (delegate: 'GPU' | 'CPU') => Promise<T>,
): Promise<T> {
  try {
    return await make('GPU');
  } catch (gpuError) {
    console.warn('[COSMIC] MediaPipe GPU delegate unavailable, falling back to CPU.', gpuError);
    return make('CPU');
  }
}

/** MediaPipe Hand Landmarker wrapper: 21 landmarks for up to two hands, mirrored to display space. */
export class HandTracker {
  private lastTimestamp = -1;

  private constructor(private readonly landmarker: HandLandmarker) {}

  static async create(): Promise<HandTracker> {
    const [{ HandLandmarker }, fileset, modelAssetPath] = await Promise.all([
      import('@mediapipe/tasks-vision'),
      getVisionFileset(),
      resolveModelUrl('hand_landmarker'),
    ]);
    const landmarker = await createWithDelegateFallback((delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }),
    );
    return new HandTracker(landmarker);
  }

  detect(video: HTMLVideoElement, nowMs: number): TrackedHand[] {
    // MediaPipe requires strictly increasing timestamps.
    const ts = Math.max(nowMs, this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    const result = this.landmarker.detectForVideo(video, ts);
    const hands: TrackedHand[] = [];
    for (let i = 0; i < result.landmarks.length; i++) {
      const lms = result.landmarks[i];
      if (!lms || lms.length < 21) continue;
      const category = result.handedness?.[i]?.[0];
      const handedness: Handedness =
        category?.categoryName === 'Left' || category?.categoryName === 'Right' ? category.categoryName : 'Unknown';
      hands.push({
        // Selfie view: the displayed video is mirrored, so mirror x here once and for all.
        landmarks: lms.map((l) => ({ x: 1 - l.x, y: l.y, z: l.z })),
        handedness,
        score: category?.score ?? 1,
      });
    }
    return hands;
  }

  close(): void {
    try {
      this.landmarker.close();
    } catch {
      /* ignore */
    }
  }
}
