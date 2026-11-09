import { CameraController } from '../camera/cameraController';
import { CameraError, mapCameraError } from '../camera/cameraErrors';
import { ConstellationModel } from '../constellation/constellation';
import { getSign, type ZodiacId } from '../data/zodiacSigns';
import { EnergySphere } from '../effects/energySphere';
import { ExplosionShockwave } from '../effects/particleExplosion';
import { OverlayRenderer } from '../effects/overlayRenderer';
import type { ShowKind } from '../effects/symbolShows';
import { SymbolTracer } from '../gestures/symbolTracer';
import { isHandHeartPose } from '../gestures/heartPose';
import { isHandCPose } from '../gestures/handSymbolPoses';
import { CrystalCrown } from '../three/crystalCrown';
import { clamp, easeOutCubic, smoothstep } from '../gestures/smoothing';
import { GestureRecognizer, type GestureEvent, type GestureState } from '../gestures/gestureRecognizer';
import { CreatureController } from '../three/creatureController';
import { loadCreature, sampleSurface } from '../three/modelLoader';
import { ParticleMorph, type MorphPhase, type MorphViewInfo } from '../three/particleMorph';
import { SceneManager } from '../three/sceneManager';
import { createMockControl, type MockControl } from '../vision/mockTracker';
import type { TrackedHand, VisionFrame } from '../vision/landmarkTypes';
import { VisionPipeline, createMediaPipeBackend, type VisionBackend } from '../vision/visionPipeline';
import { resetAssetResolution } from '../vision/mediapipeAssets';
import {
  loadSettings,
  loadSign,
  qualityFor,
  saveSettings,
  saveSign,
  type EngineSettings,
  type QualityProfile,
} from './settings';
import { isDrawingState, transition, type AppEvent, type AppState } from './stateMachine';

export interface EngineHost {
  stage: HTMLElement;
  video: HTMLVideoElement;
  threeCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
}

export interface Problem {
  code: string;
  title: string;
  message: string;
  steps: string[];
}

export interface EngineSnapshot {
  appState: AppState;
  gesture: GestureState['activeGesture'];
  gestureConfidence: number;
  holdProgress: number;
  hands: number;
  face: boolean;
  fps: number;
  visionFps: number;
  inferenceMs: number;
  loading: string | null;
  problem: Problem | null;
  sign: ZodiacId;
  settings: EngineSettings;
  starCount: number;
  strokeCount: number;
  phase: MorphPhase;
  phaseProgress: number;
  toast: { id: number; text: string } | null;
  mock: boolean;
  creatureLoading: boolean;
  /** Where the creature model came from, for the HUD. */
  creatureSource: 'procedural' | 'glb' | null;
  /** The full-screen Canopus / heart show currently playing. */
  show: ShowKind | null;
}

const IDLE_GESTURE: GestureState = {
  activeGesture: 'none',
  confidence: 1,
  startTime: 0,
  lastPosition: null,
  cursor: null,
  holdProgress: 0,
  handsVisible: 0,
  candidate: 'none',
};

/**
 * Orchestrates every layer: camera -> vision -> gestures -> constellation -> effects -> 3D.
 * React only renders UI from `getSnapshot()` and calls the public methods; all real-time work
 * happens here, outside React's render cycle.
 */
export class CosmicEngine {
  // ---- layers ---------------------------------------------------------------------------------
  private readonly camera: CameraController;
  private pipeline: VisionPipeline | null = null;
  private readonly recognizer = new GestureRecognizer();
  readonly constellation = new ConstellationModel();
  private readonly overlay: OverlayRenderer;
  private readonly scene: SceneManager;
  private readonly creature: CreatureController;
  private readonly morph: ParticleMorph;
  private readonly sphere = new EnergySphere();
  private readonly crown = new CrystalCrown();
  private readonly tracer = new SymbolTracer();
  private readonly shockwave = new ExplosionShockwave();
  private readonly mockControl: MockControl | null;
  private readonly view: MorphViewInfo = { worldW: 7.8, worldH: 4.37, pointScale: 1000 };

  // ---- state ----------------------------------------------------------------------------------
  private appState: AppState = 'START';
  private gesture: GestureState = IDLE_GESTURE;
  private latest: VisionFrame | null = null;
  private settings: EngineSettings = loadSettings();
  private sign: ZodiacId = loadSign();
  private problem: Problem | null = null;
  private loading: string | null = null;
  private toast: { id: number; text: string } | null = null;
  private toastTimer: number | null = null;
  private toastId = 0;
  private creatureLoading = false;
  private creatureSource: 'procedural' | 'glb' | null = null;
  private showKind: ShowKind | null = null;
  private aspect = 16 / 9;
  private session = 0;
  private transformToken = 0;
  private heartPoseSince: number | null = null;
  private cPoseSince: number | null = null;
  private containerW = 0;
  private containerH = 0;

  // ---- loop / stats ---------------------------------------------------------------------------
  private rafId: number | null = null;
  private lastFrameTs = 0;
  private fps = 60;
  private lastEmit = 0;
  private lowFpsSeconds = 0;
  private autoDowngraded = false;
  private disposed = false;

  private snapshot: EngineSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly host: EngineHost,
    private readonly options: { mock: boolean },
  ) {
    try {
      this.scene = new SceneManager(host.threeCanvas);
    } catch (err) {
      throw new CameraError('webgl-unavailable', err instanceof Error ? err.message : undefined, { cause: err });
    }
    this.overlay = new OverlayRenderer(host.overlayCanvas);
    this.camera = new CameraController(host.video);
    this.camera.onLost = (e) => this.fail(e);
    this.creature = new CreatureController({ worldH: this.scene.worldH });
    this.morph = new ParticleMorph(qualityFor({ displayName: 'Canopus', lowEffects: false, reducedFlash: false, showDebug: false }).maxParticles);
    this.morph.onPhase = (p) => this.onMorphPhase(p);

    this.scene.scene.add(this.creature.root, this.sphere.group, this.shockwave.object, this.crown.group);
    this.sphere.setSign(getSign(this.sign));
    this.constellation.selectedSign = this.sign;
    this.mockControl = options.mock ? createMockControl(host.stage) : null;
    if (options.mock) (window as unknown as { __COSMIC__?: unknown }).__COSMIC__ = { engine: this, mock: this.mockControl };

    window.addEventListener('pagehide', this.handlePageHide);
    this.snapshot = this.buildSnapshot();
    this.rafId = requestAnimationFrame(this.frame);
  }

  // ======================================================================================
  // React integration
  // ======================================================================================

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EngineSnapshot => this.snapshot;

  private buildSnapshot(): EngineSnapshot {
    const stats = this.pipeline?.stats;
    return {
      appState: this.appState,
      gesture: this.gesture.activeGesture,
      gestureConfidence: this.gesture.confidence,
      holdProgress: this.gesture.holdProgress,
      hands: this.latest && performance.now() - this.latest.t < 400 ? this.latest.hands.length : 0,
      face: !!this.latest?.face && performance.now() - this.latest.t < 400,
      fps: Math.round(this.fps),
      visionFps: Math.round(stats?.fps ?? 0),
      inferenceMs: Math.round((stats?.inferenceMs ?? 0) * 10) / 10,
      loading: this.loading,
      problem: this.problem,
      sign: this.sign,
      settings: this.settings,
      starCount: this.constellation.stars.stars.length,
      strokeCount: this.constellation.strokes.strokes.length,
      phase: this.morph.phase,
      phaseProgress: Math.round(this.morph.progress * 20) / 20,
      toast: this.toast,
      mock: this.options.mock,
      creatureLoading: this.creatureLoading,
      creatureSource: this.creatureSource,
      show: this.showKind,
    };
  }

  private refresh(force = false): void {
    const next = this.buildSnapshot();
    const prev = this.snapshot;
    if (!force) {
      let same = true;
      for (const k of Object.keys(next) as Array<keyof EngineSnapshot>) {
        if (next[k] !== prev[k]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }

  // ======================================================================================
  // Layout
  // ======================================================================================

  /** Fit the stage (same aspect ratio as the camera) into the container and size every layer. */
  layout(containerW: number, containerH: number): void {
    this.containerW = containerW;
    this.containerH = containerH;
    if (containerW < 2 || containerH < 2) return;
    let w = containerW;
    let h = containerW / this.aspect;
    if (h > containerH) {
      h = containerH;
      w = containerH * this.aspect;
    }
    w = Math.floor(w);
    h = Math.floor(h);
    const s = this.host.stage.style;
    s.width = `${w}px`;
    s.height = `${h}px`;
    const q = this.quality();
    const dpr = Math.min(window.devicePixelRatio || 1, q.dprCap);
    this.scene.resize(w, h, dpr);
    this.overlay.resize(w, h, dpr);
    this.view.worldW = this.scene.worldW;
    this.view.worldH = this.scene.worldH;
    this.view.pointScale = this.scene.pointScale;
    this.creature.setViewHeight(this.scene.worldH);
    this.constellation.setAspect(this.aspect);
  }

  private quality(): QualityProfile {
    return qualityFor(this.settings);
  }

  // ======================================================================================
  // Camera lifecycle
  // ======================================================================================

  async start(): Promise<void> {
    if (this.appState !== 'START' || this.disposed) return;
    const session = ++this.session;
    this.problem = null;
    this.loading = 'Requesting camera access...';
    this.refresh(true);

    try {
      const info = await this.camera.start();
      if (session !== this.session) {
        this.camera.stop();
        return;
      }
      this.aspect = info.width / info.height || 16 / 9;
      this.layout(this.containerW, this.containerH);
      this.dispatch('CAMERA_OK');
    } catch (err) {
      if (session === this.session) this.fail(mapCameraError(err));
      return;
    }

    this.loading = this.options.mock ? 'Starting mock tracker...' : 'Loading hand & face tracking...';
    this.refresh(true);
    let backend: VisionBackend;
    try {
      backend = this.mockControl
        ? this.mockControl.backend
        : await createMediaPipeBackend((m) => this.showToast(m));
    } catch (err) {
      console.error('[COSMIC] Tracking models failed to load', err);
      if (session === this.session) {
        this.fail(new CameraError('tracking-unavailable', err instanceof Error ? err.message : undefined, { cause: err }));
      }
      return;
    }
    if (session !== this.session) {
      backend.close();
      return;
    }

    this.pipeline = new VisionPipeline(backend, {
      maxFps: 30,
      onFrame: (f) => this.onVisionFrame(f),
      onError: (e) => {
        console.error('[COSMIC] Vision pipeline stopped', e);
        this.fail(new CameraError('tracking-unavailable', 'tracking stopped unexpectedly'));
      },
    });
    this.pipeline.start(this.host.video);
    this.loading = null;
    this.dispatch('TRACKING_READY');
  }

  /** Turn the camera off and return to the start screen. */
  stopCamera(): void {
    this.session++;
    this.teardownRuntime();
    this.problem = null;
    this.loading = null;
    this.dispatch('CAMERA_OFF');
  }

  /** From the error screen: forget the failure and request the camera again. */
  retry(): void {
    resetAssetResolution();
    this.problem = null;
    this.dispatch('RETRY');
    void this.start();
  }

  private fail(error: CameraError): void {
    this.session++;
    this.teardownRuntime();
    this.loading = null;
    this.problem = { code: error.code, title: error.title, message: error.message, steps: error.steps };
    this.dispatch('CAMERA_FAIL');
  }

  /** Stops tracking and the camera (turning the camera light off) and clears all runtime state. */
  private teardownRuntime(): void {
    this.transformToken++;
    this.heartPoseSince = null;
    this.cPoseSince = null;
    this.pipeline?.dispose();
    this.pipeline = null;
    this.camera.stop();
    this.recognizer.reset(performance.now());
    this.tracer.reset();
    this.showKind = null;
    this.constellation.clear();
    this.morph.cancel();
    this.sphere.setState(0, 0);
    this.shockwave.stop();
    this.creature.hide();
    this.overlay.clear();
    this.latest = null;
    this.gesture = IDLE_GESTURE;
    this.creatureLoading = false;
  }

  private handlePageHide = (): void => {
    this.camera.stop();
  };

  // ======================================================================================
  // State
  // ======================================================================================

  private dispatch(event: AppEvent): void {
    const next = transition(this.appState, event);
    if (next !== this.appState) {
      this.appState = next;
      this.refresh(true);
    }
  }

  get state(): AppState {
    return this.appState;
  }

  // ======================================================================================
  // Vision -> gestures
  // ======================================================================================

  private onVisionFrame(frame: VisionFrame): void {
    this.latest = frame;
    if (!isDrawingState(this.appState)) return;
    // While a Canopus / heart show plays, hand input is ignored (Esc or the Skip button ends it).
    if (this.showKind) return;

    const hands = frame.hands.filter((h) => h.score >= 0.5);
    if (isHandHeartPose(hands, frame.aspect)) {
      this.heartPoseSince ??= frame.t;
      if (frame.t - this.heartPoseSince >= 650) {
        this.heartPoseSince = null;
        this.startShow('heart');
        return;
      }
    } else {
      this.heartPoseSince = null;
    }

    const { state, events } = this.recognizer.update(frame);
    this.gesture = state;
    for (const e of events) this.handleGestureEvent(e);

    // Keep the application state machine in step with the confirmed gesture.
    if (isDrawingState(this.appState)) {
      const g = state.activeGesture;
      if (g === 'star' && this.appState !== 'STAR_MODE') this.dispatch('STAR_GESTURE');
      else if (g === 'draw' && this.appState !== 'DRAW_MODE') this.dispatch('DRAW_GESTURE');
      else if (g === 'none' && this.appState !== 'IDLE') this.dispatch('GESTURE_RELEASED');
    }

    if (state.activeGesture === 'none' && isHandCPose(hands, frame.aspect)) {
      this.cPoseSince ??= frame.t;
      if (frame.t - this.cPoseSince >= 650) {
        this.cPoseSince = null;
        this.startShow('canopus');
        return;
      }
    } else {
      this.cPoseSince = null;
    }

    // Traced symbols: an open hand drawing a "C" or a heart in the air.
    if (isDrawingState(this.appState)) {
      const idle = state.activeGesture === 'none';
      const sym = this.tracer.update(frame.t, hands, frame.aspect, idle);
      if (sym) this.startShow(sym.shape === 'C' ? 'canopus' : 'heart');
    }
  }

  /** Play the Canopus (traced "C") or love (traced heart) show. Also callable from tests / the UI. */
  startShow(kind: ShowKind): void {
    if (!isDrawingState(this.appState) || this.showKind) return;
    this.heartPoseSince = null;
    this.cPoseSince = null;
    for (const e of this.recognizer.reset(performance.now())) this.handleGestureEvent(e);
    this.tracer.reset();
    this.gesture = IDLE_GESTURE;
    if (this.appState !== 'IDLE') this.dispatch('GESTURE_RELEASED');
    this.showKind = kind;
    this.overlay.startShow(kind, this.settings.displayName);
    this.showToast(kind === 'canopus' ? `Writing ${this.settings.displayName || 'Canopus'} in the stars...` : 'Love - a heart of stardust...');
    this.refresh(true);
  }

  cancelShow(): void {
    if (!this.showKind) return;
    this.showKind = null;
    this.overlay.cancelShow();
    this.recognizer.reset(performance.now());
    this.tracer.reset();
    this.refresh(true);
  }

  private handleGestureEvent(e: GestureEvent): void {
    if (!isDrawingState(this.appState)) return;
    switch (e.type) {
      case 'STAR_HOLD': {
        const { star } = this.constellation.apply(e);
        if (star) {
          this.overlay.onStarPlaced(star.x, star.y, this.settings.reducedFlash);
          this.refresh(true);
        }
        break;
      }
      case 'DRAW_START':
      case 'DRAW_MOVE':
        this.constellation.apply(e);
        break;
      case 'DRAW_END':
        this.constellation.apply(e);
        this.refresh(true);
        break;
      case 'FINISH_GESTURE':
        this.beginTransform();
        break;
    }
  }

  // ======================================================================================
  // Transformation sequence
  // ======================================================================================

  /** Finish the drawing and start the transformation (also reachable via the on-screen button). */
  finishDrawing(): void {
    this.beginTransform();
  }

  private beginTransform(): void {
    if (!isDrawingState(this.appState)) return;
    if (this.constellation.isEmpty) {
      this.showToast('Place a star or draw a line first, then raise both open palms apart.');
      return;
    }

    this.recognizer.reset(performance.now());
    this.constellation.freeze();
    const snapshot = this.constellation.snapshot();
    this.gesture = IDLE_GESTURE;
    this.dispatch('FINISH_GESTURE');

    const token = ++this.transformToken;
    const q = this.quality();
    const sign = getSign(this.sign);
    this.creature.hide();
    this.sphere.setSign(sign);
    this.sphere.glowScale = q.glow;
    this.morph.begin(snapshot, this.view, this.scene.scene, {
      count: q.maxParticles,
      timeScale: q.phaseScale,
      reducedFlash: this.settings.reducedFlash,
    });

    // Load the creature while the first phases play; its surface points become the reassembly targets.
    this.creatureLoading = true;
    this.refresh(true);
    loadCreature(sign, this.creature.material)
      .then((model) => {
        if (token !== this.transformToken || this.disposed) {
          model.dispose();
          return;
        }
        this.creature.setModel(model, sign.id);
        this.creatureSource = model.source;
        this.creature.setOpacityImmediate(0);
        const targets = sampleSurface(this.creature.root, q.maxParticles);
        this.morph.setTargets(targets, this.creature.root);
        this.creatureLoading = false;
        this.refresh(true);
      })
      .catch((err) => {
        if (token !== this.transformToken) return;
        console.error('[COSMIC] Creature failed to load', err);
        this.creatureLoading = false;
        this.showToast('Could not load the creature model. The transformation was cancelled.');
        this.cancelTransform();
      });
  }

  private onMorphPhase(phase: MorphPhase): void {
    switch (phase) {
      case 'explosion':
        this.shockwave.trigger(this.morph.sphereCenter, this.morph.sphereRadius * 3.4, this.settings.reducedFlash ? 0.12 : 0.38);
        break;
      case 'awakening':
        this.creature.fadeTo(1);
        break;
      case 'done':
        this.dispatch('TRANSFORM_DONE');
        this.creature.setInteractive(true);
        this.showToast('Move your hand to rotate. Spread two hands apart to resize.');
        break;
      default:
        break;
    }
    this.refresh(true);
  }

  /** Abort a running transformation; the constellation is restored so the user can keep editing. */
  cancelTransform(): void {
    if (this.appState !== 'TRANSFORMING') return;
    this.transformToken++;
    this.morph.cancel();
    this.sphere.setState(0, 0);
    this.shockwave.stop();
    this.creature.hide();
    this.creatureLoading = false;
    this.constellation.unfreeze();
    this.recognizer.reset(performance.now());
    this.dispatch('CANCEL');
  }

  /** From the creature view: clear everything and start a new constellation. */
  restart(): void {
    if (this.appState === 'TRANSFORMING') {
      this.cancelTransform();
      return;
    }
    if (this.appState !== 'CREATURE_MODE') return;
    this.transformToken++;
    this.morph.cancel();
    this.sphere.setState(0, 0);
    this.creature.hide();
    this.constellation.clear();
    this.recognizer.reset(performance.now());
    this.dispatch('RESTART');
  }

  resetCreature(): void {
    this.creature.resetTransform();
  }

  clearConstellation(): void {
    if (!isDrawingState(this.appState)) return;
    this.recognizer.reset(performance.now());
    this.constellation.clear();
    this.refresh(true);
  }

  undo(): void {
    if (!isDrawingState(this.appState)) return;
    this.constellation.undo();
    this.refresh(true);
  }

  // ======================================================================================
  // Settings / sign
  // ======================================================================================

  setSign(id: ZodiacId): void {
    if (id === this.sign || this.appState === 'TRANSFORMING') return;
    this.sign = id;
    saveSign(id);
    this.constellation.selectedSign = id;
    this.sphere.setSign(getSign(id));
    if (this.appState === 'CREATURE_MODE') {
      // Swap the creature in place with a quick fade.
      const token = ++this.transformToken;
      this.creatureLoading = true;
      this.refresh(true);
      loadCreature(getSign(id), this.creature.material)
        .then((model) => {
          if (token !== this.transformToken || this.appState !== 'CREATURE_MODE') {
            model.dispose();
            return;
          }
          this.creature.setOpacityImmediate(0);
          this.creature.setModel(model, id);
          this.creatureSource = model.source;
          this.creature.fadeTo(1);
          this.creatureLoading = false;
          this.refresh(true);
        })
        .catch(() => {
          this.creatureLoading = false;
          this.refresh(true);
        });
    }
    this.refresh(true);
  }

  updateSettings(patch: Partial<EngineSettings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    if (patch.lowEffects !== undefined) {
      this.lowFpsSeconds = 0;
      this.layout(this.containerW, this.containerH);
    }
    this.refresh(true);
  }

  private showToast(text: string): void {
    this.toast = { id: ++this.toastId, text };
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast = null;
      this.refresh(true);
    }, 4200);
    this.refresh(true);
  }

  // ======================================================================================
  // Render loop (requestAnimationFrame, independent of vision inference)
  // ======================================================================================

  private frame = (ts: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);
    const dt = this.lastFrameTs ? Math.min((ts - this.lastFrameTs) / 1000, 0.1) : 1 / 60;
    this.lastFrameTs = ts;
    const tSec = ts / 1000;
    if (dt > 0) this.fps += (1 / dt - this.fps) * Math.min(1, dt * 1.5);

    const now = performance.now();
    const live = this.appState !== 'START' && this.appState !== 'CAMERA_ERROR';
    const q = this.quality();

    // Ignore stale tracking results (e.g. the vision loop stalled).
    const fresh = this.latest && now - this.latest.t < 400 ? this.latest : null;
    const hands: readonly TrackedHand[] = live && fresh ? fresh.hands : [];

    if (this.showKind && !this.overlay.showKind) {
      // the show finished on its own
      this.showKind = null;
      this.recognizer.reset(now);
      this.tracer.reset();
      this.refresh(true);
    }

    if (live) {
      this.overlay.draw({
        tSec,
        dt,
        hands,
        face: fresh?.face ?? null,
        aspect: this.aspect,
        gesture: this.gesture,
        constellation: this.constellation,
        showConstellation: isDrawingState(this.appState) && !this.showKind,
        interactive: isDrawingState(this.appState),
        quality: q,
        reducedFlash: this.settings.reducedFlash,
        debug: this.settings.showDebug,
      });
    }

    this.crown.update(dt, tSec, live ? fresh?.face?.head ?? null : null, this.scene, q.glow);
    this.morph.update(dt);
    this.updateSphere(dt, q);
    this.shockwave.update(dt);
    this.creature.update(dt, tSec, this.appState === 'CREATURE_MODE' ? hands : [], this.aspect);
    this.scene.render();

    this.watchPerformance(dt, live);
    if (now - this.lastEmit > 250) {
      this.lastEmit = now;
      this.refresh();
    }
  };

  private updateSphere(dt: number, q: QualityProfile): void {
    this.sphere.glowScale = q.glow;
    if (this.appState !== 'TRANSFORMING') {
      this.sphere.setState(0, 0);
      return;
    }
    const p = this.morph.progress;
    const R = this.morph.sphereRadius;
    let intensity = 0;
    let glyph = 0;
    let radius = R * 0.35;
    switch (this.morph.phase) {
      case 'convergence':
        intensity = 0.35 * smoothstep(0.6, 1, p);
        break;
      case 'sphere': {
        const grow = easeOutCubic(clamp(p / 0.5, 0, 1));
        intensity = smoothstep(0, 0.5, p);
        glyph = smoothstep(0.3, 0.75, p);
        radius = R * (0.35 + 0.65 * grow);
        break;
      }
      case 'explosion':
        intensity = 1 - smoothstep(0, 0.45, p);
        glyph = 1 - smoothstep(0, 0.25, p);
        radius = R * (1 + 0.3 * p);
        break;
      default:
        break;
    }
    this.sphere.setCenter(this.morph.sphereCenter);
    this.sphere.setRadius(radius);
    this.sphere.setState(intensity, glyph);
    this.sphere.update(dt);
  }

  /** If the GPU/CPU cannot keep up, drop to low-effects mode once and tell the user. */
  private watchPerformance(dt: number, live: boolean): void {
    if (!live || this.autoDowngraded || this.settings.lowEffects || document.hidden) {
      this.lowFpsSeconds = 0;
      return;
    }
    this.lowFpsSeconds = this.fps < 20 ? this.lowFpsSeconds + dt : Math.max(0, this.lowFpsSeconds - dt);
    if (this.lowFpsSeconds > 4) {
      this.autoDowngraded = true;
      this.updateSettings({ lowEffects: true });
      this.showToast('Switched to low-effects mode for smoother performance. You can change this in Settings.');
    }
  }

  // ======================================================================================

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    window.removeEventListener('pagehide', this.handlePageHide);
    this.session++;
    this.teardownRuntime();
    this.mockControl?.dispose();
    this.morph.dispose();
    this.sphere.dispose();
    this.crown.dispose();
    this.shockwave.dispose();
    this.creature.dispose();
    this.scene.dispose();
    this.listeners.clear();
  }
}
