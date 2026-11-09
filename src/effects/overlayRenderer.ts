import type { ConstellationModel } from '../constellation/constellation';
import type { GestureState } from '../gestures/gestureRecognizer';
import { damp } from '../gestures/smoothing';
import { FINGERTIP_INDICES, HAND_CONNECTIONS, type TrackedFace, type TrackedHand } from '../vision/landmarkTypes';
import type { QualityProfile } from '../app/settings';
import { HandAura } from './handAura';
import { drawStrokes, emitTrailSparkles } from './lightTrail';
import { SparkleSystem } from './sparkles';
import { createShow, type Show, type ShowKind } from './symbolShows';
import { drawPlacedStars, drawStarSummonIndicator, emitStarBurst } from './starParticles';

export interface OverlayFrame {
  tSec: number;
  dt: number;
  hands: readonly TrackedHand[];
  face: TrackedFace | null;
  aspect: number;
  gesture: GestureState;
  constellation: ConstellationModel;
  /** Whether the stars / lines should currently be visible (false once they become particles). */
  showConstellation: boolean;
  /** Show the star-summon ring and orbiting stars while in star mode. */
  interactive: boolean;
  quality: QualityProfile;
  reducedFlash: boolean;
  debug: boolean;
}

/**
 * The 2D effects layer drawn over the camera image: crown dust, hand aura, stars, light trails,
 * sparkles. All inputs are normalised display coordinates; everything is converted to pixels here.
 */
export class OverlayRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private readonly sparkles = new SparkleSystem(1500);
  private readonly aura = new HandAura();
  private show: Show | null = null;
  private crownAcc = 0;
  private constellationAlpha = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
  }

  /** Size in CSS pixels; the backing store is scaled by dpr. */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.w = Math.max(1, cssW);
    this.h = Math.max(1, cssH);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Burst of sparkles for a freshly placed star (normalised position). */
  onStarPlaced(x: number, y: number, reducedFlash: boolean): void {
    emitStarBurst(this.sparkles, x * this.w, y * this.h, this.h / 720, reducedFlash);
  }

  /** Start a full-screen show (Canopus / heart); replaces any show in progress. */
  startShow(kind: ShowKind, displayName = 'Canopus'): void {
    this.show = createShow(kind, displayName);
  }

  cancelShow(): void {
    this.show = null;
  }

  get showKind(): ShowKind | null {
    return this.show ? this.show.kind : null;
  }

  draw(f: OverlayFrame): void {
    const { ctx, w, h } = this;
    const dt = Math.min(f.dt, 0.1);
    this.sparkles.limit = Math.min(this.sparkles.maxCapacity, f.quality.sparkleCap);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    this.constellationAlpha = damp(this.constellationAlpha, f.showConstellation ? 1 : 0, f.showConstellation ? 10 : 7, dt);

    // --- simulation -------------------------------------------------------
    this.aura.update(f.hands, dt, f.aspect);
    this.aura.emit(this.sparkles, w, h, dt, f.quality.auraRate);
    const c = f.constellation;
    if (this.constellationAlpha > 0.05) {
      emitTrailSparkles(this.sparkles, w, h, c.strokes.strokes, c.strokes.current, dt, f.reducedFlash);
    }
    this.emitCrownDust(f, dt);
    this.sparkles.update(dt);

    // --- drawing (back to front) ------------------------------------------
    const glow = f.quality.glow;
    if (this.constellationAlpha > 0.01) {
      drawStrokes(ctx, w, h, c.strokes.strokes, c.strokes.current, this.constellationAlpha, glow);
      drawPlacedStars(ctx, w, h, c.stars.stars, f.tSec, this.constellationAlpha, glow, f.reducedFlash);
    }

    if (this.show) {
      this.show.step(dt, { ctx, w, h, glow, density: Math.min(1, Math.max(0.4, f.quality.maxParticles / 6000)), reducedFlash: f.reducedFlash });
      if (this.show.done) this.show = null;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1;
    }

    const g = f.gesture;
    const activeTips = g.activeGesture === 'star' ? [8] : g.activeGesture === 'draw' ? [8, 12] : [];
    this.aura.draw(ctx, w, h, { activeTips, glow, tSec: f.tSec });

    if (f.interactive && g.activeGesture === 'star' && g.cursor) {
      drawStarSummonIndicator(ctx, w, h, g.cursor, g.holdProgress, f.tSec, glow);
    }

    this.sparkles.draw(ctx, glow);
    ctx.globalAlpha = 1;

    if (f.debug) this.drawDebug(f);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Tiny star dust rising off the crown's tips. */
  private emitCrownDust(f: OverlayFrame, dt: number): void {
    const head = f.face?.head;
    if (!head) return;
    this.crownAcc += dt * (f.quality.auraRate * 0.22);
    const k = this.h / 720;
    const R = 0.4 * head.width * this.h;
    const ux = Math.sin(head.roll);
    const uy = -Math.cos(head.roll);
    while (this.crownAcc >= 1) {
      this.crownAcc -= 1;
      const side = (Math.random() - 0.5) * 2 * R;
      const up = Math.random() * R * 0.95;
      const x = head.x * this.w + Math.cos(head.roll) * side + ux * up;
      const y = head.y * this.h + Math.sin(head.roll) * side + uy * up;
      this.sparkles.emit(x, y, (Math.random() - 0.5) * 16 * k, (-8 - Math.random() * 22) * k, 0.8 + Math.random() * 0.9, (5 + Math.random() * 9) * k, Math.random() < 0.4 ? 0 : Math.random() < 0.6 ? 2 : 3, Math.random() < 0.45);
    }
  }

  private drawDebug(f: OverlayFrame): void {
    const { ctx, w, h } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(120,255,200,0.85)';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    for (const hand of f.hands) {
      ctx.beginPath();
      for (const [i, j] of HAND_CONNECTIONS) {
        ctx.moveTo(hand.landmarks[i].x * w, hand.landmarks[i].y * h);
        ctx.lineTo(hand.landmarks[j].x * w, hand.landmarks[j].y * h);
      }
      ctx.stroke();
      for (const lm of hand.landmarks) {
        ctx.beginPath();
        ctx.arc(lm.x * w, lm.y * h, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,230,120,1)';
      for (const i of FINGERTIP_INDICES) {
        ctx.beginPath();
        ctx.arc(hand.landmarks[i].x * w, hand.landmarks[i].y * h, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
    }
    if (f.face) {
      ctx.strokeStyle = 'rgba(255,120,220,0.9)';
      for (const eye of [f.face.leftEye, f.face.rightEye]) {
        ctx.beginPath();
        ctx.arc(eye.x * w, eye.y * h, Math.max(3, eye.radius * h), 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const p of f.face.debugPoints ?? []) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  clear(): void {
    this.sparkles.clear();
    this.aura.clear();
    this.show = null;
    this.ctx.clearRect(0, 0, this.w, this.h);
  }
}
