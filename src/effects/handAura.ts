import { dist, handSize, palmCenter } from '../gestures/handGeometry';
import { damp } from '../gestures/smoothing';
import { FINGERTIP_INDICES, HAND_CONNECTIONS, type Point2, type TrackedHand } from '../vision/landmarkTypes';
import type { SparkleSystem } from './sparkles';
import { drawGlow } from './sprites';

interface Slot {
  pts: Point2[];
  palm: Point2;
  /** Palm size in stage-height units. */
  size: number;
  alpha: number;
  target: number;
  emitAcc: number;
}

export interface AuraDrawOptions {
  /** Landmark indices of the "active" fingertips (brighter accent). */
  activeTips: readonly number[];
  glow: number;
  tSec: number;
}

/**
 * Purple star-dust aura around tracked hands: a soft palm glow, small fingertip accents (brightest on the
 * active gesture fingertips) and a cloud of drifting star dust. No lines are drawn on the hand. Hands are matched to
 * persistent slots so the aura fades in/out smoothly and survives brief tracking dropouts.
 */
export class HandAura {
  private slots: Slot[] = [];

  update(hands: readonly TrackedHand[], dt: number, aspect: number): void {
    const unmatched = new Set(this.slots);
    for (const hand of hands) {
      const palm = palmCenter(hand);
      let best: Slot | null = null;
      let bestD = 0.3;
      for (const s of unmatched) {
        const d = dist(s.palm, palm, aspect);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      const size = handSize(hand, aspect);
      if (best) {
        unmatched.delete(best);
        for (let i = 0; i < 21; i++) {
          best.pts[i].x = damp(best.pts[i].x, hand.landmarks[i].x, 30, dt);
          best.pts[i].y = damp(best.pts[i].y, hand.landmarks[i].y, 30, dt);
        }
        best.palm = palm;
        best.size = damp(best.size, size, 12, dt);
        best.target = 1;
      } else {
        this.slots.push({
          pts: hand.landmarks.map((l) => ({ x: l.x, y: l.y })),
          palm,
          size,
          alpha: 0,
          target: 1,
          emitAcc: 0,
        });
      }
    }
    for (const s of unmatched) s.target = 0;
    for (const s of this.slots) s.alpha = damp(s.alpha, s.target, s.target > s.alpha ? 14 : 7, dt);
    this.slots = this.slots.filter((s) => s.target > 0 || s.alpha > 0.02);
  }

  /** Emit drifting star dust over the whole hand; separate from draw() so it can run with the particle step. */
  emit(sparkles: SparkleSystem, w: number, h: number, dt: number, ratePerSecond: number): void {
    const k = h / 720;
    for (const s of this.slots) {
      s.emitAcc += ratePerSecond * s.alpha * dt;
      while (s.emitAcc >= 1) {
        s.emitAcc -= 1;
        // Pick a point on the hand (along a random bone, or a fingertip) and scatter dust around it.
        let px: number;
        let py: number;
        if (Math.random() < 0.35) {
          const p = s.pts[FINGERTIP_INDICES[(Math.random() * 5) | 0]];
          px = p.x;
          py = p.y;
        } else {
          const [i, j] = HAND_CONNECTIONS[(Math.random() * HAND_CONNECTIONS.length) | 0];
          const t = Math.random();
          px = s.pts[i].x + (s.pts[j].x - s.pts[i].x) * t;
          py = s.pts[i].y + (s.pts[j].y - s.pts[i].y) * t;
        }
        const spread = s.size * h * 0.55;
        const ang = Math.random() * Math.PI * 2;
        const speed = (4 + Math.random() * 20) * k;
        const tiny = Math.random() < 0.7;
        sparkles.emit(
          px * w + (Math.random() - 0.5) * spread,
          py * h + (Math.random() - 0.5) * spread,
          Math.cos(ang) * speed,
          Math.sin(ang) * speed - (4 + Math.random() * 14) * k,
          0.8 + Math.random() * 1.1,
          (tiny ? 2.5 + Math.random() * 3.5 : 6 + Math.random() * 7) * k,
          Math.random() < 0.3 ? 0 : Math.random() < 0.6 ? 2 : 3,
          !tiny && Math.random() < 0.6,
        );
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, opts: AuraDrawOptions): void {
    const k = h / 720;
    for (const s of this.slots) {
      const a = s.alpha * opts.glow;
      if (a < 0.01) continue;
      const palmPx = { x: s.palm.x * w, y: s.palm.y * h };
      const unit = s.size * h; // one palm in pixels

      // Soft palm bloom.
      drawGlow(ctx, 'deep', palmPx.x, palmPx.y, unit * 5.0, 0.28 * a);
      drawGlow(ctx, 'violet', palmPx.x, palmPx.y, unit * 2.6, 0.2 * a);

      // Fingertip accents.
      for (const i of FINGERTIP_INDICES) {
        const p = s.pts[i];
        const isActive = opts.activeTips.includes(i);
        const pulse = isActive ? 0.85 + 0.15 * Math.sin(opts.tSec * 7) : 1;
        drawGlow(ctx, 'violet', p.x * w, p.y * h, unit * (isActive ? 1.5 : 0.75) * pulse, (isActive ? 0.7 : 0.3) * a);
        drawGlow(ctx, isActive ? 'white' : 'lavender', p.x * w, p.y * h, unit * (isActive ? 0.62 : 0.34), (isActive ? 0.95 : 0.7) * a);
      }
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.slots = [];
  }
}
