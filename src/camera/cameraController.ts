import { CameraError, mapCameraError } from './cameraErrors';

export interface CameraInfo {
  width: number;
  height: number;
}

/**
 * Camera layer: requests webcam permission, starts / stops the stream, reports errors and
 * provides frames through the <video> element. Frames never leave the browser.
 */
export class CameraController {
  private stream: MediaStream | null = null;
  private permissionStatus: PermissionStatus | null = null;

  /** Called when the stream dies by itself (device unplugged, permission revoked...). */
  onLost: ((error: CameraError) => void) | null = null;

  constructor(private readonly video: HTMLVideoElement) {}

  get isActive(): boolean {
    return this.stream !== null && this.stream.getVideoTracks().some((t) => t.readyState === 'live');
  }

  async start(): Promise<CameraInfo> {
    this.stop();

    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      throw new CameraError('insecure-context');
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new CameraError('unsupported');
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
    } catch (err) {
      const mapped = mapCameraError(err);
      if (mapped.code !== 'overconstrained') throw mapped;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (err2) {
        throw mapCameraError(err2);
      }
    }

    this.stream = stream;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', this.handleTrackEnded);
    }
    this.watchPermission();

    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;

    try {
      await this.waitForMetadata();
      await this.video.play();
    } catch (err) {
      this.stop();
      throw mapCameraError(err);
    }

    return { width: this.video.videoWidth, height: this.video.videoHeight };
  }

  /** Stops every track so the camera light turns off. Safe to call repeatedly. */
  stop(): void {
    if (this.permissionStatus) {
      this.permissionStatus.onchange = null;
      this.permissionStatus = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.removeEventListener('ended', this.handleTrackEnded);
        track.stop();
      }
      this.stream = null;
    }
    try {
      this.video.pause();
    } catch {
      /* ignore */
    }
    this.video.srcObject = null;
  }

  private readonly handleTrackEnded = (): void => {
    // Ignore the event if we stopped the stream ourselves.
    if (!this.stream) return;
    this.stop();
    this.onLost?.(new CameraError('stream-ended'));
  };

  private waitForMetadata(): Promise<void> {
    if (this.video.readyState >= 1 && this.video.videoWidth > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new CameraError('aborted', 'timed out waiting for the first video frame'));
      }, 10000);
      const onMeta = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new CameraError('aborted', 'video element error'));
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        this.video.removeEventListener('loadedmetadata', onMeta);
        this.video.removeEventListener('error', onError);
      };
      this.video.addEventListener('loadedmetadata', onMeta);
      this.video.addEventListener('error', onError);
    });
  }

  /** Best effort: notice permission being revoked while the stream is running. */
  private watchPermission(): void {
    try {
      const perms = navigator.permissions;
      if (!perms?.query) return;
      perms
        .query({ name: 'camera' as PermissionName })
        .then((status) => {
          if (!this.stream) return;
          this.permissionStatus = status;
          status.onchange = () => {
            if (status.state === 'denied' && this.stream) {
              this.stop();
              this.onLost?.(new CameraError('permission-denied'));
            }
          };
        })
        .catch(() => {
          /* Permissions API for "camera" is not supported everywhere. */
        });
    } catch {
      /* ignore */
    }
  }
}
