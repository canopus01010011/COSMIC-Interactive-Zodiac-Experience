import { FaceTracker } from './faceTracker';
import { HandTracker } from './handTracker';
import type { TrackedFace, TrackedHand, VisionFrame } from './landmarkTypes';

/** Anything that can turn a video frame into hands (+ optionally a face). */
export interface VisionBackend {
  detectHands(video: HTMLVideoElement, nowMs: number): TrackedHand[];
  /** Optional: face tracking may be unavailable (the experience still works without eye effects). */
  detectFace?(video: HTMLVideoElement, nowMs: number, aspect: number): TrackedFace | null;
  close(): void;
}

/** Real backend: MediaPipe hand + face landmarkers. */
export async function createMediaPipeBackend(
  onWarning?: (message: string) => void,
): Promise<VisionBackend> {
  const hands = await HandTracker.create();
  let face: FaceTracker | null = null;
  try {
    face = await FaceTracker.create();
  } catch (err) {
    console.warn('[COSMIC] Face tracking unavailable; continuing with hands only.', err);
    onWarning?.('Face tracking could not be loaded - the eye effect is disabled.');
  }
  return {
    detectHands: (video, now) => hands.detect(video, now),
    detectFace: face ? (video, now, aspect) => face.detect(video, now, aspect) : undefined,
    close: () => {
      hands.close();
      face?.close();
    },
  };
}

export interface VisionStats {
  /** Vision inference frames per second. */
  fps: number;
  /** Average inference time per cycle in ms. */
  inferenceMs: number;
}

export interface VisionPipelineOptions {
  /** Upper bound for inference cycles per second. */
  maxFps?: number;
  onFrame: (frame: VisionFrame) => void;
  onError?: (error: unknown) => void;
}

/**
 * Vision layer scheduler. Inference is driven by new *video frames* (requestVideoFrameCallback,
 * falling back to timers) at a capped rate, completely independent of the requestAnimationFrame
 * render loop, so a slow model never blocks drawing and vice-versa. The face model (the heavier
 * one) runs every other cycle and its last result is reused in between.
 */
export class VisionPipeline {
  private running = false;
  private video: HTMLVideoElement | null = null;
  private handle: number | null = null;
  private usingVfc = false;
  private lastRun = 0;
  private lastVideoTime = -1;
  private cycle = 0;
  private lastFace: TrackedFace | null = null;
  private lastFaceT = 0;
  private consecutiveErrors = 0;
  private fpsWindowStart = 0;
  private fpsCount = 0;
  private inferenceAccum = 0;
  private _stats: VisionStats = { fps: 0, inferenceMs: 0 };

  constructor(
    private backend: VisionBackend,
    private readonly opts: VisionPipelineOptions,
  ) {}

  get stats(): VisionStats {
    return this._stats;
  }

  start(video: HTMLVideoElement): void {
    this.stop();
    this.video = video;
    this.running = true;
    this.lastRun = 0;
    this.lastVideoTime = -1;
    this.fpsWindowStart = performance.now();
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.handle !== null) {
      if (this.usingVfc && this.video && 'cancelVideoFrameCallback' in this.video) {
        (this.video as HTMLVideoElement & { cancelVideoFrameCallback(h: number): void }).cancelVideoFrameCallback(this.handle);
      } else {
        window.clearTimeout(this.handle);
      }
      this.handle = null;
    }
  }

  /** Stop and release the backend's resources. */
  dispose(): void {
    this.stop();
    this.backend.close();
    this.video = null;
    this.lastFace = null;
  }

  private schedule(): void {
    const video = this.video;
    if (!this.running || !video) return;
    if ('requestVideoFrameCallback' in video) {
      this.usingVfc = true;
      this.handle = (video as HTMLVideoElement & { requestVideoFrameCallback(cb: () => void): number }).requestVideoFrameCallback(() => this.tick());
    } else {
      this.usingVfc = false;
      this.handle = window.setTimeout(() => this.tick(), 1000 / 60);
    }
  }

  private tick(): void {
    const video = this.video;
    if (!this.running || !video) return;
    const now = performance.now();
    const minInterval = 1000 / (this.opts.maxFps ?? 30);

    const hasNewFrame = video.currentTime !== this.lastVideoTime;
    if (now - this.lastRun >= minInterval - 2 && video.readyState >= 2 && video.videoWidth > 0 && hasNewFrame) {
      this.lastRun = now;
      this.lastVideoTime = video.currentTime;
      this.process(video, now);
    }
    this.schedule();
  }

  private process(video: HTMLVideoElement, now: number): void {
    const aspect = video.videoWidth / video.videoHeight;
    const t0 = performance.now();
    try {
      const hands = this.backend.detectHands(video, now);
      if (this.backend.detectFace && this.cycle % 2 === 0) {
        this.lastFace = this.backend.detectFace(video, now, aspect);
        this.lastFaceT = now;
      }
      // Drop a stale face result rather than leaving effects frozen in place.
      if (this.lastFace && now - this.lastFaceT > 400) this.lastFace = null;
      this.cycle++;
      this.consecutiveErrors = 0;

      const t1 = performance.now();
      this.inferenceAccum += t1 - t0;
      this.fpsCount++;
      if (t1 - this.fpsWindowStart >= 1000) {
        this._stats = {
          fps: (this.fpsCount * 1000) / (t1 - this.fpsWindowStart),
          inferenceMs: this.inferenceAccum / this.fpsCount,
        };
        this.fpsWindowStart = t1;
        this.fpsCount = 0;
        this.inferenceAccum = 0;
      }

      this.opts.onFrame({ t: now, hands, face: this.lastFace, aspect });
    } catch (err) {
      this.consecutiveErrors++;
      console.warn('[COSMIC] Vision inference error', err);
      if (this.consecutiveErrors >= 30) {
        this.running = false;
        this.opts.onError?.(err);
      }
    }
  }
}
