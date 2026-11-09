import { buildMockFace, buildMockHand, type MockHandSpec, type MockPose } from './mockHand';
import type { TrackedFace, TrackedHand } from './landmarkTypes';
import type { VisionBackend } from './visionPipeline';

/**
 * A scriptable stand-in for MediaPipe: `?mock=1` lets you drive the entire experience with the
 * mouse and keyboard (no hand needed) and powers the automated end-to-end test.
 *
 *   mouse move ......... moves the hand            hold 1 ... one finger (summon stars)
 *   hold 2 ............. two close fingers (draw)  hold 3 ... "peace" sign (does nothing)
 *   B (toggle) ......... second hand               K ....... finish gesture
 *   mouse wheel ........ second-hand distance      H ....... hide hands
 *   Alt + wheel ........ second-hand height (twist two hands to rotate)
 *
 * Without keys held the hand is an open palm, which no gesture reacts to.
 */
export class MockBackend implements VisionBackend {
  private specs: MockHandSpec[] = [];
  private face: TrackedFace | null = null;
  private faceEnabled = true;
  private readonly t0 = performance.now();
  private aspect = 16 / 9;

  setHands(specs: MockHandSpec[]): void {
    this.specs = specs;
  }

  setFaceEnabled(on: boolean): void {
    this.faceEnabled = on;
  }

  detectHands(video: HTMLVideoElement): TrackedHand[] {
    if (video.videoWidth > 0) this.aspect = video.videoWidth / video.videoHeight;
    return this.specs.map((s) => buildMockHand({ aspect: this.aspect, ...s }));
  }

  detectFace(): TrackedFace | null {
    this.face = this.faceEnabled ? buildMockFace((performance.now() - this.t0) / 1000) : null;
    return this.face;
  }

  close(): void {
    this.specs = [];
  }
}

export interface MockControl {
  backend: MockBackend;
  /** Sets the hands directly (used by automated tests). */
  setHands(specs: MockHandSpec[]): void;
  /** Shows both open palms apart long enough to finish the constellation. */
  finishGesture(): Promise<void>;
  dispose(): void;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Wires the mock backend to the mouse + keyboard over the stage element. */
export function createMockControl(stage: HTMLElement): MockControl {
  const backend = new MockBackend();
  const mouse = { x: 0.5, y: 0.6, inside: false };
  const keys = new Set<string>();
  let secondHand = false;
  let spread = 0.3;
  let tilt = 0;
  let scripted = false; // true while a programmatic sequence owns the hands

  const poseFromKeys = (): MockPose => {
    if (keys.has('1')) return 'one';
    if (keys.has('2')) return 'two';
    if (keys.has('3')) return 'peace';
    return 'open';
  };

  const refresh = () => {
    if (scripted) return;
    if (!mouse.inside || keys.has('h')) {
      backend.setHands([]);
      return;
    }
    const specs: MockHandSpec[] = [{ pose: poseFromKeys(), x: mouse.x, y: mouse.y, size: 0.15 }];
    if (secondHand) {
      specs.push({ pose: 'open', x: Math.min(0.95, mouse.x + spread), y: Math.min(0.95, Math.max(0.05, mouse.y + tilt)), size: 0.15, handedness: 'Left' });
    }
    backend.setHands(specs);
  };

  const onMove = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width;
    mouse.y = (e.clientY - r.top) / r.height;
    mouse.inside = mouse.x >= 0 && mouse.x <= 1 && mouse.y >= 0 && mouse.y <= 1;
    refresh();
  };
  const onLeave = () => {
    mouse.inside = false;
    refresh();
  };
  const onWheel = (e: WheelEvent) => {
    if (e.altKey) tilt = Math.min(0.4, Math.max(-0.4, tilt - e.deltaY * 0.0005));
    else spread = Math.min(0.7, Math.max(0.08, spread - e.deltaY * 0.0004));
    refresh();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (e.repeat) return;
    if (k === 'b') secondHand = !secondHand;
    if (k === 'k') void control.finishGesture();
    keys.add(k);
    refresh();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.key.toLowerCase());
    refresh();
  };

  window.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerleave', onLeave);
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  const control: MockControl = {
    backend,
    setHands(specs) {
      scripted = true;
      backend.setHands(specs);
    },
    async finishGesture() {
      const hand = (x: number): MockHandSpec => ({ pose: 'open', x, y: 0.55, size: 0.15 });
      scripted = true;
      backend.setHands([hand(0.2), hand(0.8)]);
      await sleep(850);
      scripted = false;
      refresh();
    },
    dispose() {
      window.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
  return control;
}
