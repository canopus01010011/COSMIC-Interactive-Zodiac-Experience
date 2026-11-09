import { CANOPUS_SCRIPT, CARINA_LINES, CARINA_STARS, carinaLayout, heartOutline, splinePoints } from './showData';
import { drawGlow, drawStar, type PaletteName } from './sprites';

export type ShowKind = 'canopus' | 'heart';

export interface ShowEnv {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Quality glow multiplier (reduced-flash mode lowers it). */
  glow: number;
  /** 0.4..1: scales particle counts in low-effects mode. */
  density: number;
  reducedFlash: boolean;
}

export interface Show {
  readonly kind: ShowKind;
  readonly duration: number;
  t: number;
  readonly done: boolean;
  /** Advance the animation and draw it (the overlay is in additive 'lighter' mode on entry). */
  step(dt: number, env: ShowEnv): void;
}

// ------------------------------------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ss = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (x: number) => 1 - (1 - clamp01(x)) ** 3;
const easeInOut = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const easeOutBack = (x: number) => {
  const t = clamp01(x) - 1;
  return 1 + 2.70158 * t * t * t + 1.70158 * t * t;
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

type Pt = [number, number];

const heartSprites = new Map<string, HTMLCanvasElement>();
function heartSprite(color: PaletteName, size = 96): HTMLCanvasElement {
  const key = `${color}:${size}`;
  let c = heartSprites.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const pts = heartOutline(60);
  const rgb = { white: '255,255,255', pink: '255,112,200', rose: '255,170,228', lavender: '198,178,255', violet: '150,104,255', cool: '224,234,255', deep: '112,64,232' }[color];
  const s = size * 0.5;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(size / 2 + x * s, size / 2 + y * s) : ctx.moveTo(size / 2 + x * s, size / 2 + y * s)));
  ctx.closePath();
  const g = ctx.createRadialGradient(size / 2, size * 0.42, 0, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, `rgba(${rgb},0.95)`);
  g.addColorStop(1, `rgba(${rgb},0.55)`);
  ctx.shadowColor = `rgba(${rgb},1)`;
  ctx.shadowBlur = size * 0.16;
  ctx.fillStyle = g;
  ctx.fill();
  heartSprites.set(key, c);
  return c;
}

function drawHeartSprite(ctx: CanvasRenderingContext2D, color: PaletteName, x: number, y: number, d: number, alpha: number, rot = 0): void {
  if (alpha <= 0.003 || d <= 0.5) return;
  ctx.globalAlpha = Math.min(1, alpha);
  const s = heartSprite(color);
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.drawImage(s, -d / 2, -d / 2, d, d);
  ctx.restore();
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: PaletteName;
  shape: 0 | 1 | 2; // dot, twinkle star, heart
  rot: number;
  spin: number;
  /** velocity damping per second (0 = none). */
  drag: number;
  /** horizontal sway amplitude (px/s). */
  sway: number;
  phase: number;
}

class MotePool {
  items: Mote[] = [];
  constructor(private cap: number) {}
  setCap(cap: number) {
    this.cap = cap;
  }
  emit(m: Partial<Mote> & { x: number; y: number; life: number }): void {
    if (this.items.length >= this.cap) return;
    this.items.push({ vx: 0, vy: 0, max: m.life, size: 6, color: 'white', shape: 0, rot: 0, spin: 0, drag: 0, sway: 0, phase: Math.random() * TAU, ...m });
  }
  update(dt: number): void {
    const a = this.items;
    for (let i = a.length - 1; i >= 0; i--) {
      const m = a[i];
      m.life -= dt;
      if (m.life <= 0) {
        a[i] = a[a.length - 1];
        a.pop();
        continue;
      }
      if (m.drag) {
        const f = Math.exp(-m.drag * dt);
        m.vx *= f;
        m.vy *= f;
      }
      m.x += (m.vx + (m.sway ? Math.sin((m.max - m.life) * 2.6 + m.phase) * m.sway : 0)) * dt;
      m.y += m.vy * dt;
      m.rot += m.spin * dt;
    }
  }
  draw(ctx: CanvasRenderingContext2D, mul: number, glow: number): void {
    for (const m of this.items) {
      const age = m.max - m.life;
      const alpha = clamp01(m.life / m.max) * Math.min(1, age / 0.1) * mul * glow;
      if (m.shape === 0) drawGlow(ctx, m.color, m.x, m.y, m.size, alpha);
      else if (m.shape === 1) drawStar(ctx, m.color, m.x, m.y, m.size, alpha, m.rot);
      else drawHeartSprite(ctx, m.color, m.x, m.y, m.size, alpha, m.rot);
    }
  }
  clear(): void {
    this.items.length = 0;
  }
}

function veil(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
  if (alpha <= 0.003) return;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const g = ctx.createRadialGradient(w / 2, h * 0.46, h * 0.1, w / 2, h * 0.46, Math.max(w, h) * 0.75);
  g.addColorStop(0, `rgba(14,6,48,${alpha * 0.55})`);
  g.addColorStop(1, `rgba(3,1,16,${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
}

interface LineStyle {
  wide: string;
  mid: string;
  core: string;
}
const PURPLE_LINE: LineStyle = { wide: '120,70,235', mid: '176,140,255', core: '248,242,255' };
const PINK_LINE: LineStyle = { wide: '255,60,170', mid: '255,140,215', core: '255,244,250' };

/** Glowing single line: wide soft pass + mid pass + bright thin core. */
function strokeGlow(ctx: CanvasRenderingContext2D, k: number, style: LineStyle, alpha: number, build: () => void, widthMul = 1): void {
  if (alpha <= 0.003) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const passes: Array<[number, string, number]> = [
    [16 * k * widthMul, style.wide, 0.16],
    [7 * k * widthMul, style.mid, 0.42],
    [2.8 * k * widthMul, style.core, 0.95],
  ];
  for (const [width, rgb, a] of passes) {
    ctx.beginPath();
    build();
    ctx.lineWidth = width;
    ctx.strokeStyle = `rgba(${rgb},${Math.min(1, a * alpha)})`;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function setFont(ctx: CanvasRenderingContext2D, px: number, weight: number | string, spacingEm: number): void {
  ctx.font = `${weight} ${px}px Inter, "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(spacingEm * px).toFixed(2)}px`;
}

function glowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, alpha: number, rgb: string, blur: number): void {
  if (alpha <= 0.003) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.shadowColor = `rgba(${rgb},1)`;
  ctx.shadowBlur = blur;
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------------------------------------
// Canopus: a single light line writes the name, dissolves into star dust, which flies off and forms
// the stars of Carina (the constellation that holds Canopus) joined by growing lines.
// ------------------------------------------------------------------------------------------------

const STAR_LAUNCH = [3.9, 4.6, 4.9, 5.2, 5.75, 5.5, 6.0, 4.75, 6.2, 6.35];
const COMET_TIME = 0.8;

export class CanopusShow implements Show {
  readonly kind = 'canopus' as const;
  readonly duration = 11.8;
  t = 0;
  private readonly name: string;
  private readonly customName: boolean;
  private readonly motes = new MotePool(1400);
  private key = '';
  private script: Pt[] = [];
  private cum: number[] = [];
  private total = 1;
  private nameStart = 0;
  private nameWidth = 0;
  private nameBaseline = 0;
  private nameFont = '';
  private stars: Array<{ x: number; y: number; size: number; origin: Pt; bend: number }> = [];
  private arrived: boolean[] = CARINA_STARS.map(() => false);
  private rings: Array<{ x: number; y: number; t0: number; r: number }> = [];
  private penAcc = 0;
  private dustAcc = 0;
  private lastPen: Pt | null = null;

  constructor(name = 'Canopus') {
    this.name = name.trim().slice(0, 24) || 'Canopus';
    this.customName = this.name.toLocaleLowerCase() !== 'canopus';
  }

  get done(): boolean {
    return this.t >= this.duration;
  }

  private layout(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const key = `${w}x${h}:${this.name}`;
    if (key === this.key) return;
    this.key = key;
    if (this.customName) {
      let fontSize = Math.min(0.13 * h, 0.09 * w);
      this.nameFont = `italic 300 ${fontSize}px "Segoe UI", Georgia, serif`;
      ctx.font = this.nameFont;
      this.nameWidth = ctx.measureText(this.name).width;
      if (this.nameWidth > 0.82 * w) {
        fontSize *= (0.82 * w) / this.nameWidth;
        this.nameFont = `italic 300 ${fontSize}px "Segoe UI", Georgia, serif`;
        ctx.font = this.nameFont;
        this.nameWidth = ctx.measureText(this.name).width;
      }
      this.nameStart = (w - this.nameWidth) / 2;
      this.nameBaseline = 0.47 * h;
      this.script = Array.from({ length: 100 }, (_, i) => [
        this.nameStart + (this.nameWidth * i) / 99,
        this.nameBaseline,
      ] as Pt);
    } else {
      const s = Math.min((0.62 * w) / 8.95, 0.118 * h);
      const x0 = w / 2 - (8.95 * s) / 2 + 0.25 * s;
      const base = 0.47 * h;
      this.script = splinePoints(CANOPUS_SCRIPT, 10).map(([x, y]) => [x0 + x * s, base - y * s] as Pt);
    }
    this.cum = [0];
    for (let i = 1; i < this.script.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(this.script[i][0] - this.script[i - 1][0], this.script[i][1] - this.script[i - 1][1]));
    }
    this.total = this.cum[this.cum.length - 1] || 1;

    const lay = carinaLayout();
    const S = Math.min(0.62 * w, 0.95 * h);
    this.stars = lay.map((p, i) => {
      const mag = CARINA_STARS[i].mag;
      const o = this.script[Math.floor(((i * 7 + 3) % 10) / 10 * (this.script.length - 1))];
      return {
        x: w / 2 + (p.x - 0.5) * S,
        y: 0.47 * h + (p.y - 0.5) * S,
        size: h * Math.min(0.105, Math.max(0.02, 0.058 - 0.0105 * mag)),
        origin: o,
        bend: i % 2 ? 1 : -1,
      };
    });
  }

  private pointAt(len: number): { i: number; p: Pt } {
    let lo = 0;
    let hi = this.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < len) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const a = this.script[i - 1];
    const b = this.script[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const u = clamp01((len - this.cum[i - 1]) / seg);
    return { i, p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u] };
  }

  step(dt: number, env: ShowEnv): void {
    const { ctx, w, h } = env;
    const k = h / 720;
    this.t += dt;
    const t = this.t;
    const D = this.duration;
    this.layout(ctx, w, h);
    this.motes.setCap(Math.round(1400 * env.density));
    const gl = env.glow;
    const master = ss(0, 0.5, t) * (1 - ss(D - 1.3, D, t));
    veil(ctx, w, h, 0.5 * ss(0, 0.9, t) * (1 - ss(D - 1.4, D, t)));
    if (master <= 0.002) return;

    // ---- 1. the single light line writes the name ----------------------------------------------
    const WRITE0 = 0.5;
    const WRITE1 = 3.9;
    const wp = easeInOut((t - WRITE0) / (WRITE1 - WRITE0));
    const textAlpha = master * (1 - ss(4.2, 5.7, t));
    if (t >= WRITE0 && textAlpha > 0.003) {
      const vis = this.pointAt(Math.max(0.001, wp * this.total));
      const script = this.script;
      if (this.customName) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(this.nameStart - 4 * k, this.nameBaseline - h * 0.16, this.nameWidth * wp + 8 * k, h * 0.3);
        ctx.clip();
        ctx.font = this.nameFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2.8 * k;
        ctx.strokeStyle = `rgba(176,140,255,${textAlpha * 0.9})`;
        ctx.shadowColor = 'rgba(176,140,255,0.95)';
        ctx.shadowBlur = 28 * k;
        ctx.strokeText(this.name, w / 2, this.nameBaseline);
        ctx.fillStyle = `rgba(255,255,255,${textAlpha})`;
        ctx.shadowColor = 'rgba(255,255,255,0.9)';
        ctx.shadowBlur = 16 * k;
        ctx.fillText(this.name, w / 2, this.nameBaseline);
        ctx.restore();
      } else {
        strokeGlow(ctx, k, PURPLE_LINE, textAlpha * gl, () => {
          ctx.moveTo(script[0][0], script[0][1]);
          for (let i = 1; i < vis.i; i++) ctx.lineTo(script[i][0], script[i][1]);
          ctx.lineTo(vis.p[0], vis.p[1]);
        });
      }
      if (wp < 1) {
        const px = this.customName ? this.nameStart + this.nameWidth * wp : vis.p[0];
        const py = this.customName ? this.nameBaseline : vis.p[1];
        drawGlow(ctx, 'violet', px, py, 150 * k, 0.55 * master * gl);
        drawGlow(ctx, 'white', px, py, 54 * k, 0.95 * master * gl);
        drawStar(ctx, 'white', px, py, 70 * k, 0.9 * master * gl, t * 3);
        // sparks fall off the pen tip
        this.penAcc += dt * 150 * env.density;
        while (this.penAcc >= 1) {
          this.penAcc -= 1;
          this.motes.emit({
            x: px + rnd(-4, 4) * k,
            y: py + rnd(-4, 4) * k,
            vx: rnd(-40, 40) * k,
            vy: rnd(-55, 15) * k,
            life: rnd(0.5, 1.1),
            size: rnd(5, 14) * k,
            color: Math.random() < 0.5 ? 'white' : 'lavender',
            shape: Math.random() < 0.35 ? 1 : 0,
            drag: 1.4,
          });
        }
        this.lastPen = [px, py];
      }
    }

    // ---- 2. the line dissolves into star dust ---------------------------------------------------
    if (t > 3.9 && t < 5.8) {
      this.dustAcc += dt * 520 * env.density * (t < 4.4 ? 0.5 : 1);
      while (this.dustAcc >= 1) {
        this.dustAcc -= 1;
        const q = this.script[(Math.random() * this.script.length) | 0];
        this.motes.emit({
          x: q[0] + rnd(-6, 6) * k,
          y: q[1] + rnd(-6, 6) * k,
          vx: rnd(-22, 22) * k,
          vy: rnd(-70, -10) * k,
          life: rnd(0.9, 1.9),
          size: rnd(6, 16) * k,
          color: Math.random() < 0.3 ? 'white' : Math.random() < 0.5 ? 'lavender' : 'violet',
          shape: Math.random() < 0.3 ? 1 : 0,
          spin: rnd(-1, 1),
          drag: 0.6,
          sway: 14 * k,
        });
      }
    }

    // ---- 3. comets carry the dust to the star positions ----------------------------------------
    for (let i = 0; i < this.stars.length; i++) {
      const st = this.stars[i];
      const launch = STAR_LAUNCH[i];
      const u = (t - launch) / COMET_TIME;
      if (u >= 0 && u < 1) {
        const pos = (uu: number): Pt => {
          const e = easeInOut(uu);
          const mx = (st.origin[0] + st.x) / 2;
          const my = (st.origin[1] + st.y) / 2;
          const dx = st.x - st.origin[0];
          const dy = st.y - st.origin[1];
          const bx = mx - dy * 0.28 * st.bend;
          const by = my + dx * 0.28 * st.bend - 0.08 * h;
          const a = (1 - e) * (1 - e);
          const b = 2 * (1 - e) * e;
          const c = e * e;
          return [a * st.origin[0] + b * bx + c * st.x, a * st.origin[1] + b * by + c * st.y];
        };
        for (let j = 7; j >= 0; j--) {
          const [cx, cy] = pos(Math.max(0, u - j * 0.028));
          const f = 1 - j / 8;
          drawGlow(ctx, j === 0 ? 'white' : 'lavender', cx, cy, (j === 0 ? 30 : 46 * f) * k, (j === 0 ? 0.95 : 0.5 * f) * master * gl);
        }
        const [hx, hy] = pos(u);
        drawGlow(ctx, 'violet', hx, hy, 90 * k, 0.4 * master * gl);
        if (Math.random() < 0.7 * env.density) {
          this.motes.emit({ x: hx, y: hy, vx: rnd(-25, 25) * k, vy: rnd(-25, 25) * k, life: rnd(0.4, 0.9), size: rnd(5, 11) * k, color: 'white', shape: Math.random() < 0.4 ? 1 : 0, drag: 2 });
        }
      }
      if (!this.arrived[i] && u >= 1) {
        this.arrived[i] = true;
        const big = i === 0;
        const n = Math.round((big ? 70 : 22) * env.density);
        for (let q = 0; q < n; q++) {
          const a = Math.random() * TAU;
          const sp = rnd(30, big ? 260 : 150) * k;
          this.motes.emit({
            x: st.x,
            y: st.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: rnd(0.6, big ? 1.8 : 1.2),
            size: rnd(5, big ? 16 : 11) * k,
            color: Math.random() < 0.4 ? 'white' : 'lavender',
            shape: Math.random() < 0.4 ? 1 : 0,
            drag: 2.2,
          });
        }
        this.rings.push({ x: st.x, y: st.y, t0: t, r: (big ? 0.34 : 0.15) * h });
        if (big) this.rings.push({ x: st.x, y: st.y, t0: t + 0.28, r: 0.5 * h });
      }
    }

    // ---- 4. constellation lines grow between the arrived stars ----------------------------------
    const arrive = STAR_LAUNCH.map((l) => l + COMET_TIME);
    const lineP: number[] = [];
    CARINA_LINES.forEach(([a, b], li) => {
      const first = arrive[a] <= arrive[b] ? a : b;
      const second = first === a ? b : a;
      const p = easeInOut((t - (Math.max(arrive[a], arrive[b]) + 0.12)) / 0.85);
      lineP[li] = p;
      if (p <= 0) return;
      const A = this.stars[first];
      const B = this.stars[second];
      const ex = A.x + (B.x - A.x) * p;
      const ey = A.y + (B.y - A.y) * p;
      strokeGlow(ctx, k, PURPLE_LINE, master * gl * 0.9, () => {
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(ex, ey);
      }, 0.7);
      if (p < 1) drawGlow(ctx, 'white', ex, ey, 26 * k, 0.8 * master * gl);
      else {
        // a slow shimmer travelling along the finished line
        const sh = ((t * 0.33 + li * 0.17) % 1);
        drawGlow(ctx, 'white', A.x + (B.x - A.x) * sh, A.y + (B.y - A.y) * sh, 16 * k, 0.5 * master * gl * ss(8.2, 9, t));
      }
    });

    // ---- 5. rings + stars -------------------------------------------------------------------------
    this.rings = this.rings.filter((r) => t - r.t0 < 1.5);
    for (const r of this.rings) {
      const u = (t - r.t0) / 1.4;
      if (u < 0) continue;
      ctx.lineWidth = 2.2 * k;
      ctx.strokeStyle = `rgba(214,196,255,${0.55 * (1 - u) * master * gl})`;
      ctx.beginPath();
      ctx.arc(r.x, r.y, easeOutCubic(u) * r.r, 0, TAU);
      ctx.stroke();
    }

    for (let i = 0; i < this.stars.length; i++) {
      const st = this.stars[i];
      const pf = easeOutBack((t - arrive[i]) / 0.6);
      if (pf <= 0) continue;
      const tw = 1 + 0.1 * Math.sin(t * 3.1 + i * 1.7);
      const d = st.size * pf * tw;
      if (i === 0) {
        const pulse = 1 + 0.06 * Math.sin(t * 2.2);
        drawGlow(ctx, 'deep', st.x, st.y, d * 7.5 * pulse, 0.5 * master * gl);
        drawGlow(ctx, 'violet', st.x, st.y, d * 3.6 * pulse, 0.6 * master * gl);
        drawStar(ctx, 'white', st.x, st.y, d * 5.2, 0.8 * master * gl, t * 0.12);
        drawStar(ctx, 'lavender', st.x, st.y, d * 3.6, 0.7 * master * gl, t * 0.12 + Math.PI / 4);
        drawStar(ctx, 'white', st.x, st.y, d * 1.7, 1 * master * gl, 0);
      } else {
        drawGlow(ctx, 'violet', st.x, st.y, d * 3.4, 0.5 * master * gl);
        drawStar(ctx, 'lavender', st.x, st.y, d * 2.6, 0.85 * master * gl, i * 0.5);
        drawStar(ctx, 'white', st.x, st.y, d * 1.3, 0.95 * master * gl, 0);
      }
    }

    // ---- 6. labels ----------------------------------------------------------------------------------
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const cs = this.stars[0];
    setFont(ctx, 0.04 * h, 300, 0.34);
    glowText(ctx, 'CANOPUS', cs.x, cs.y + cs.size * 2.5 + 0.018 * h, ss(arrive[0] + 0.3, arrive[0] + 1.4, t) * master, '170,130,255', 18 * k);
    ctx.textAlign = 'left';
    setFont(ctx, 0.022 * h, 300, 0.12);
    for (const i of [1, 2, 3]) {
      const st = this.stars[i];
      glowText(ctx, CARINA_STARS[i].name, st.x + st.size * 1.4 + 6 * k, st.y, ss(arrive[i] + 0.8, arrive[i] + 1.8, t) * master * 0.7, '170,130,255', 8 * k);
    }
    ctx.textAlign = 'center';
    setFont(ctx, 0.021 * h, 300, 0.28);
    glowText(ctx, 'ALPHA CARINAE  ·  SECOND-BRIGHTEST STAR IN THE NIGHT SKY', w / 2, 0.9 * h, ss(8.6, 9.8, t) * master * 0.85, '170,130,255', 10 * k);
    ctx.textAlign = 'start';
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';

    // ---- 7. ambient dust around the finished constellation ----------------------------------------
    if (t > 7.4 && t < D - 1.4 && Math.random() < 0.5 * env.density) {
      const st = this.stars[(Math.random() * this.stars.length) | 0];
      this.motes.emit({ x: st.x + rnd(-20, 20) * k, y: st.y + rnd(-20, 20) * k, vx: rnd(-10, 10) * k, vy: rnd(-24, -4) * k, life: rnd(1, 2), size: rnd(5, 11) * k, color: 'lavender', shape: Math.random() < 0.5 ? 1 : 0, sway: 8 * k });
    }

    this.motes.update(dt);
    this.motes.draw(ctx, master, gl);
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------------------------------------
// Heart: a light line draws the outline, a swarm of stardust flows in to fill it, it beats with a
// double pulse, sending out rings and a drift of little hearts, then bursts into dust.
// ------------------------------------------------------------------------------------------------

const BEATS = [3.1, 4.2, 5.3, 6.4, 7.5];

function insidePoly(poly: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface Dust {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  delay: number;
  dur: number;
  size: number;
  color: PaletteName;
  phase: number;
  swirl: number;
  twinkle: boolean;
}

export class HeartShow implements Show {
  readonly kind = 'heart' as const;
  readonly duration = 10.2;
  t = 0;
  private readonly motes = new MotePool(900);
  private readonly outline = heartOutline(180);
  private dust: Dust[] = [];
  private builtFor = '';
  private nextBeat = 0;
  private rings: Array<{ t0: number }> = [];
  private penAcc = 0;

  get done(): boolean {
    return this.t >= this.duration;
  }

  private build(w: number, h: number, density: number): void {
    const key = `${w}x${h}x${density}`;
    if (key === this.builtFor) return;
    this.builtFor = key;
    const n = Math.round(1000 * density);
    const colors: PaletteName[] = ['pink', 'rose', 'white', 'lavender', 'violet', 'pink', 'rose'];
    this.dust = [];
    for (let i = 0; i < n; i++) {
      let tx = 0;
      let ty = 0;
      if (Math.random() < 0.42) {
        const o = this.outline[(Math.random() * (this.outline.length - 1)) | 0];
        const pull = Math.random() * 0.045; // a little inside the edge
        tx = o[0] * (1 - pull * 2);
        ty = o[1] * (1 - pull * 2);
      } else {
        for (let tries = 0; tries < 60; tries++) {
          tx = rnd(-0.5, 0.5);
          ty = rnd(-0.5, 0.5);
          if (insidePoly(this.outline, tx, ty)) break;
        }
      }
      const a = Math.random() * TAU;
      const far = rnd(0.55, 1.15) * Math.max(w, h) * 0.6;
      this.dust.push({
        tx,
        ty,
        sx: w / 2 + Math.cos(a) * far,
        sy: h * 0.47 + Math.sin(a) * far * 0.7,
        delay: rnd(0, 1.7),
        dur: rnd(1.1, 1.9),
        size: rnd(4, 11),
        color: colors[(Math.random() * colors.length) | 0],
        phase: Math.random() * TAU,
        swirl: (Math.random() < 0.5 ? -1 : 1) * rnd(0.1, 0.35),
        twinkle: Math.random() < 0.25,
      });
    }
  }

  private beatScale(t: number): number {
    let s = 0;
    for (const b of BEATS) {
      const tau = t - b;
      if (tau < -0.2 || tau > 0.9) continue;
      s += Math.exp(-(((tau - 0.04) / 0.09) ** 2)) + 0.62 * Math.exp(-(((tau - 0.31) / 0.1) ** 2));
    }
    return 1 + 0.075 * s;
  }

  step(dt: number, env: ShowEnv): void {
    const { ctx, w, h } = env;
    const k = h / 720;
    this.t += dt;
    const t = this.t;
    const D = this.duration;
    this.build(w, h, env.density);
    this.motes.setCap(Math.round(900 * env.density));
    const gl = env.glow;
    const master = ss(0, 0.5, t) * (1 - ss(D - 1.2, D, t));
    veil(ctx, w, h, 0.5 * ss(0, 0.8, t) * (1 - ss(D - 1.3, D, t)));
    if (master <= 0.002) return;

    const cx = w / 2;
    const cy = 0.47 * h;
    const S = 0.58 * h;
    const pulse = this.beatScale(t);
    const burst = clamp01((t - 8.5) / 1.4);
    const sc = S * pulse * (1 + 0.25 * easeOutCubic(burst));
    const P = (x: number, y: number, s = sc): Pt => [cx + x * s, cy + y * s];

    // ---- 1. outline: one light line, drawn from the bottom tip ---------------------------------------
    const DRAW0 = 0.3;
    const DRAW1 = 2.9;
    const dp = easeInOut((t - DRAW0) / (DRAW1 - DRAW0));
    const outAlpha = master * (1 - burst);
    if (t >= DRAW0 && outAlpha > 0.003) {
      const count = Math.max(2, Math.floor(dp * (this.outline.length - 1)));
      const glowPulse = 0.75 + 0.25 * Math.sin(t * 5);
      strokeGlow(ctx, k, PINK_LINE, outAlpha * gl * (dp >= 1 ? 0.85 + 0.15 * glowPulse : 1), () => {
        const [sx, sy] = P(this.outline[0][0], this.outline[0][1]);
        ctx.moveTo(sx, sy);
        for (let i = 1; i <= count; i++) {
          const [x, y] = P(this.outline[i][0], this.outline[i][1]);
          ctx.lineTo(x, y);
        }
      });
      if (dp < 1) {
        const [px, py] = P(this.outline[count][0], this.outline[count][1]);
        drawGlow(ctx, 'pink', px, py, 150 * k, 0.6 * master * gl);
        drawGlow(ctx, 'white', px, py, 54 * k, 0.95 * master * gl);
        drawStar(ctx, 'white', px, py, 70 * k, 0.9 * master * gl, t * 3);
        this.penAcc += dt * 140 * env.density;
        while (this.penAcc >= 1) {
          this.penAcc -= 1;
          this.motes.emit({
            x: px + rnd(-4, 4) * k,
            y: py + rnd(-4, 4) * k,
            vx: rnd(-40, 40) * k,
            vy: rnd(-50, 20) * k,
            life: rnd(0.5, 1.1),
            size: rnd(5, 13) * k,
            color: Math.random() < 0.5 ? 'rose' : 'white',
            shape: Math.random() < 0.35 ? 1 : 0,
            drag: 1.4,
          });
        }
      }
    }

    // ---- 2. soft inner glow once the outline closes ------------------------------------------------------
    const fillIn = ss(2.6, 4.2, t) * (1 - burst);
    if (fillIn > 0.003) {
      const g = ctx.createRadialGradient(cx, cy - 0.05 * sc, 0, cx, cy, 0.62 * sc);
      g.addColorStop(0, `rgba(255,214,240,${0.4 * fillIn * master * gl})`);
      g.addColorStop(0.55, `rgba(255,96,190,${0.2 * fillIn * master * gl})`);
      g.addColorStop(1, 'rgba(255,60,170,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      this.outline.forEach(([x, y], i) => {
        const [px, py] = P(x, y);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      drawGlow(ctx, 'pink', cx, cy, sc * 1.9, 0.38 * fillIn * master * gl * (0.6 + 0.4 * (pulse - 1) / 0.075));
    }

    // ---- 3. dust flows in and settles inside the heart ----------------------------------------------------
    const FLOW0 = 1.5;
    for (const d of this.dust) {
      const u = (t - FLOW0 - d.delay) / d.dur;
      if (u <= 0) continue;
      const e = easeOutCubic(u);
      const [tx, ty] = P(d.tx, d.ty);
      let x: number;
      let y: number;
      if (u < 1) {
        const mx = d.sx + (tx - d.sx) * e;
        const my = d.sy + (ty - d.sy) * e;
        const sw = (1 - e) * e * 4 * d.swirl; // curved path
        x = mx - (ty - d.sy) * sw;
        y = my + (tx - d.sx) * sw;
      } else {
        x = tx + Math.sin(t * 1.8 + d.phase) * 0.004 * h;
        y = ty + Math.cos(t * 1.5 + d.phase) * 0.004 * h;
      }
      if (burst > 0) {
        const dx = tx - cx;
        const dy = ty - cy;
        const len = Math.hypot(dx, dy) || 1;
        const out = easeOutCubic(burst) * 0.55 * h * (0.4 + (d.phase / TAU));
        x += (dx / len) * out;
        y += (dy / len) * out + burst * burst * 60 * k;
      }
      const tw = d.twinkle ? 0.6 + 0.4 * Math.sin(t * 6 + d.phase) : 1;
      const arrivedGlow = u >= 1 ? 1 : 0.7;
      const a = Math.min(1, u * 2.5) * (1 - burst) * master * gl * arrivedGlow * tw;
      if (d.twinkle) drawStar(ctx, d.color, x, y, d.size * 2.2 * k * tw, a, d.phase);
      else drawGlow(ctx, d.color, x, y, d.size * 2.1 * k, a * 0.85);
    }

    // ---- 4. heartbeat: rings + little hearts -----------------------------------------------------------------
    while (this.nextBeat < BEATS.length && t >= BEATS[this.nextBeat]) {
      this.rings.push({ t0: BEATS[this.nextBeat] });
      const n = Math.round(6 * env.density);
      for (let i = 0; i < n; i++) {
        const [hx, hy] = (() => {
          for (let tries = 0; tries < 40; tries++) {
            const x = rnd(-0.5, 0.5);
            const y = rnd(-0.5, 0.45);
            if (insidePoly(this.outline, x, y)) return P(x, y, S);
          }
          return [cx, cy] as Pt;
        })();
        this.motes.emit({
          x: hx,
          y: hy,
          vx: rnd(-18, 18) * k,
          vy: rnd(-120, -55) * k,
          life: rnd(2.2, 3.6),
          size: rnd(16, 38) * k,
          color: Math.random() < 0.55 ? 'pink' : Math.random() < 0.5 ? 'rose' : 'white',
          shape: 2,
          rot: rnd(-0.5, 0.5),
          spin: rnd(-0.4, 0.4),
          sway: rnd(14, 34) * k,
          drag: 0.15,
        });
      }
      this.nextBeat++;
    }
    this.rings = this.rings.filter((r) => t - r.t0 < 1.6);
    for (const r of this.rings) {
      const u = (t - r.t0) / 1.5;
      const s = S * (1.02 + 0.85 * easeOutCubic(u));
      ctx.lineWidth = 2.4 * k;
      ctx.strokeStyle = `rgba(255,150,220,${0.5 * (1 - u) * master * gl})`;
      ctx.beginPath();
      this.outline.forEach(([x, y], i) => {
        const [px, py] = P(x, y, s);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.stroke();
    }

    // ambient sparkle drifting off the heart while it beats, and the final burst of hearts
    if (t > 3.2 && t < 8.5 && Math.random() < 0.8 * env.density) {
      const o = this.outline[(Math.random() * (this.outline.length - 1)) | 0];
      const [px, py] = P(o[0], o[1]);
      this.motes.emit({ x: px, y: py, vx: rnd(-30, 30) * k, vy: rnd(-45, -5) * k, life: rnd(0.8, 1.7), size: rnd(6, 14) * k, color: Math.random() < 0.5 ? 'rose' : 'white', shape: Math.random() < 0.5 ? 1 : 0, drag: 0.8 });
    }
    if (t >= 8.5 && !this.burstDone) {
      this.burstDone = true;
      const n = Math.round(40 * env.density);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const sp = rnd(90, 420) * k;
        this.motes.emit({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40 * k, life: rnd(1.1, 2.2), size: rnd(14, 34) * k, color: Math.random() < 0.6 ? 'pink' : 'rose', shape: 2, rot: rnd(-0.6, 0.6), spin: rnd(-1, 1), drag: 1.5 });
      }
    }

    this.motes.update(dt);
    this.motes.draw(ctx, master, gl);
    ctx.globalAlpha = 1;
  }

  private burstDone = false;
}

export function createShow(kind: ShowKind, displayName = 'Canopus'): Show {
  return kind === 'canopus' ? new CanopusShow(displayName) : new HeartShow();
}
