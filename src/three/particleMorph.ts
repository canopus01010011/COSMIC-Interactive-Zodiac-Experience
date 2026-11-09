import * as THREE from 'three';
import type { Constellation } from '../constellation/constellationTypes';
import { initExplosionVelocities, stepExplosion } from '../effects/particleExplosion';
import { clamp, easeInOutCubic, easeOutCubic, lerp } from '../gestures/smoothing';

export type MorphPhase = 'idle' | 'convergence' | 'sphere' | 'explosion' | 'reassembly' | 'awakening' | 'done';

/** Phase durations in seconds (before the quality time scale). */
export const BASE_TIMINGS = {
  convergence: 1.7,
  sphere: 3.2,
  explosion: 1.9,
  reassembly: 3.0,
  awakening: 1.7,
} as const;

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 1.0, 96.0);
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float soft = smoothstep(0.5, 0.0, d);
    float a = soft * soft;
    float core = soft * soft * soft * soft;
    vec3 col = vColor * (0.55 + 1.6 * core);
    gl_FragColor = vec4(col, a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface MorphViewInfo {
  worldW: number;
  worldH: number;
  pointScale: number;
}

export interface MorphBeginOptions {
  count: number;
  timeScale: number;
  reducedFlash: boolean;
}

const rand = Math.random;

/**
 * GPU-friendly particle sequence (one draw call, additive point sprites):
 *   convergence -> energy sphere -> explosion -> reassembly onto the creature surface -> awakening.
 * Every particle starts on the frozen constellation (stars and line geometry), so the hand-off from the
 * 2D overlay is seamless. Positions are stepped on the CPU (a few thousand points is trivial) which keeps
 * phase boundaries continuous and the code easy to reason about.
 */
export class ParticleMorph {
  readonly points: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;

  private readonly capacity: number;
  private n = 0;
  private pos: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private color: Float32Array;

  private start: Float32Array;
  private clusterOff: Float32Array;
  private shellOff: Float32Array;
  private vel: Float32Array;
  private from: Float32Array;
  private tgtLocal: Float32Array;
  private tgtWorld: Float32Array;
  private baseSize: Float32Array;
  private seedA: Float32Array;
  private seedB: Float32Array;
  private curl: Float32Array;
  private aura: Uint8Array;

  phase: MorphPhase = 'idle';
  private phaseTime = 0;
  private timeScale = 1;
  private reduced = false;
  private center = new THREE.Vector3();
  private radius = 1;
  private view: MorphViewInfo = { worldW: 7.8, worldH: 4.37, pointScale: 1000 };
  private hasTargets = false;
  private targetRoot: THREE.Object3D | null = null;
  private scene: THREE.Object3D | null = null;
  private time = 0;

  onPhase: ((phase: MorphPhase) => void) | null = null;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
    this.start = new Float32Array(capacity * 3);
    this.clusterOff = new Float32Array(capacity * 3);
    this.shellOff = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.from = new Float32Array(capacity * 3);
    this.tgtLocal = new Float32Array(capacity * 3);
    this.tgtWorld = new Float32Array(capacity * 3);
    this.baseSize = new Float32Array(capacity);
    this.seedA = new Float32Array(capacity);
    this.seedB = new Float32Array(capacity);
    this.curl = new Float32Array(capacity * 3);
    this.aura = new Uint8Array(capacity);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1000 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  get progress(): number {
    return clamp(this.phaseTime / this.duration(this.phase), 0, 1);
  }

  /** World-space centre of the sphere / convergence point. */
  get sphereCenter(): THREE.Vector3 {
    return this.center;
  }

  get sphereRadius(): number {
    return this.radius;
  }

  get isRunning(): boolean {
    return this.phase !== 'idle';
  }

  /** Called once the creature exists: where particles should land (root-local points on its surface). */
  setTargets(local: Float32Array, root: THREE.Object3D): void {
    const count = Math.min(this.n, local.length / 3);
    this.tgtLocal.set(local.subarray(0, count * 3));
    // If the creature is smaller than the particle set (shouldn't happen), recycle points.
    for (let i = count; i < this.n; i++) {
      const j = ((rand() * count) | 0) * 3;
      this.tgtLocal[i * 3] = local[j];
      this.tgtLocal[i * 3 + 1] = local[j + 1];
      this.tgtLocal[i * 3 + 2] = local[j + 2];
    }
    this.targetRoot = root;
    this.hasTargets = true;
  }

  /** Freeze `snapshot` into particles and start the sequence. Particles live under `scene`. */
  begin(snapshot: Constellation, view: MorphViewInfo, scene: THREE.Object3D, opts: MorphBeginOptions): void {
    this.cancel();
    this.view = view;
    this.scene = scene;
    this.timeScale = opts.timeScale;
    this.reduced = opts.reducedFlash;
    this.hasTargets = false;
    this.targetRoot = null;
    this.n = Math.min(opts.count, this.capacity);
    this.center.set(0, 0, 0);
    this.radius = 0.2 * view.worldH;
    const S = view.worldH / 4.37;

    // --- source points: stars (dense clumps) and stroke geometry (thin lines) ---------------------
    const aspect = view.worldW / view.worldH;
    const toWorldX = (x: number) => (x - 0.5) * view.worldW;
    const toWorldY = (y: number) => (0.5 - y) * view.worldH;

    const segs: Array<{ ax: number; ay: number; bx: number; by: number; len: number }> = [];
    let totalLen = 0;
    for (const s of snapshot.strokes) {
      for (let i = 1; i < s.points.length; i++) {
        const a = s.points[i - 1];
        const b = s.points[i];
        const len = Math.hypot((b.x - a.x) * aspect, b.y - a.y);
        if (len <= 0) continue;
        segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, len });
        totalLen += len;
      }
    }
    const hasStars = snapshot.stars.length > 0;
    const hasLines = segs.length > 0 && totalLen > 0;
    const starShare = hasStars && hasLines ? 0.35 : hasStars ? 1 : 0;

    for (let i = 0; i < this.n; i++) {
      let x: number;
      let y: number;
      let isStar = false;
      if (rand() < starShare) {
        const s = snapshot.stars[(rand() * snapshot.stars.length) | 0];
        const r = Math.pow(rand(), 0.7) * 0.011 * s.size;
        const a = rand() * Math.PI * 2;
        x = s.x + (Math.cos(a) * r) / aspect;
        y = s.y + Math.sin(a) * r;
        isStar = true;
      } else if (hasLines) {
        let u = rand() * totalLen;
        let seg = segs[0];
        for (const sg of segs) {
          seg = sg;
          if (u <= sg.len) break;
          u -= sg.len;
        }
        const t = clamp(u / seg.len, 0, 1);
        x = lerp(seg.ax, seg.bx, t) + ((rand() - 0.5) * 0.004) / aspect;
        y = lerp(seg.ay, seg.by, t) + (rand() - 0.5) * 0.004;
      } else {
        x = 0.5 + (rand() - 0.5) * 0.2;
        y = 0.5 + (rand() - 0.5) * 0.2;
      }
      const j = i * 3;
      this.start[j] = toWorldX(x);
      this.start[j + 1] = toWorldY(y);
      this.start[j + 2] = (rand() - 0.5) * 0.04;
      this.pos.set(this.start.subarray(j, j + 3), j);

      // Cluster (collapsed core) and shell/volume offsets for the sphere.
      const cr = this.radius * 0.1;
      this.clusterOff[j] = (rand() - 0.5) * 2 * cr;
      this.clusterOff[j + 1] = (rand() - 0.5) * 2 * cr;
      this.clusterOff[j + 2] = (rand() - 0.5) * 2 * cr;
      const dir = randomUnit();
      // Mostly a bright shell; the rest forms a thin halo of volume, kept off the very centre so the glyph reads.
      const onShell = rand() < 0.8;
      const rr = onShell ? this.radius * (0.94 + rand() * 0.06) : this.radius * (0.5 + 0.4 * rand());
      this.shellOff[j] = dir[0] * rr;
      this.shellOff[j + 1] = dir[1] * rr;
      this.shellOff[j + 2] = dir[2] * rr;

      this.seedA[i] = rand();
      this.seedB[i] = rand();
      const c = randomUnit();
      this.curl[j] = c[0];
      this.curl[j + 1] = c[1];
      this.curl[j + 2] = c[2];
      this.aura[i] = rand() < 0.26 ? 1 : 0;

      this.baseSize[i] = (isStar ? 0.034 + rand() * 0.02 : 0.018 + rand() * 0.016) * S;
      this.size[i] = this.baseSize[i];
      this.alpha[i] = 1;
      const tint = rand();
      // White / cool-white with restrained lavender.
      const col = tint < 0.5 ? [1, 1, 1] : tint < 0.8 ? [0.86, 0.9, 1] : [0.78, 0.68, 1];
      this.color[j] = col[0];
      this.color[j + 1] = col[1];
      this.color[j + 2] = col[2];
    }

    this.geometry.setDrawRange(0, this.n);
    (this.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    this.points.visible = true;
    this.scene.add(this.points);
    this.enter('convergence');
    this.upload();
  }

  private duration(phase: MorphPhase): number {
    switch (phase) {
      case 'convergence':
      case 'sphere':
      case 'explosion':
      case 'reassembly':
      case 'awakening':
        return BASE_TIMINGS[phase] * this.timeScale;
      default:
        return 1;
    }
  }

  private enter(phase: MorphPhase): void {
    this.phase = phase;
    this.phaseTime = 0;
    const n = this.n;

    if (phase === 'explosion') {
      initExplosionVelocities(this.pos, this.vel, n, this.center, this.view.worldH / 4.37);
    } else if (phase === 'reassembly') {
      this.from.set(this.pos.subarray(0, n * 3));
      const root = this.targetRoot;
      if (root) {
        root.updateMatrixWorld(true);
        const v = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
          v.set(this.tgtLocal[i * 3], this.tgtLocal[i * 3 + 1], this.tgtLocal[i * 3 + 2]).applyMatrix4(root.matrixWorld);
          this.tgtWorld[i * 3] = v.x;
          this.tgtWorld[i * 3 + 1] = v.y;
          this.tgtWorld[i * 3 + 2] = v.z;
        }
      }
    } else if (phase === 'awakening') {
      // Hand the particles over to the creature: from now on they live in its local space and follow
      // every move / rotate / scale. Positions switch from world to local targets.
      if (this.targetRoot) {
        this.scene?.remove(this.points);
        this.targetRoot.add(this.points);
      }
      for (let i = 0; i < n; i++) {
        this.pos[i * 3] = this.tgtLocal[i * 3];
        this.pos[i * 3 + 1] = this.tgtLocal[i * 3 + 1];
        this.pos[i * 3 + 2] = this.tgtLocal[i * 3 + 2];
      }
    }
    this.onPhase?.(phase);
  }

  update(dt: number): void {
    if (this.phase === 'idle') return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.phaseTime += dt;
    this.material.uniforms.uScale.value = this.view.pointScale;
    const n = this.n;
    const dur = this.duration(this.phase);
    const u = clamp(this.phaseTime / dur, 0, 1);

    switch (this.phase) {
      case 'convergence': {
        const stagger = 0.28;
        for (let i = 0; i < n; i++) {
          const j = i * 3;
          const ui = clamp((u - this.seedA[i] * stagger) / (1 - stagger), 0, 1);
          const e = easeInOutCubic(ui);
          const ang = e * (0.6 + this.seedB[i] * 0.9) * Math.PI;
          const c = Math.cos(ang);
          const s = Math.sin(ang);
          const rx = (this.start[j] - this.center.x) * (1 - e);
          const ry = (this.start[j + 1] - this.center.y) * (1 - e);
          this.pos[j] = this.center.x + rx * c - ry * s + this.clusterOff[j] * e;
          this.pos[j + 1] = this.center.y + rx * s + ry * c + this.clusterOff[j + 1] * e;
          this.pos[j + 2] = this.start[j + 2] * (1 - e) + this.clusterOff[j + 2] * e;
          this.alpha[i] = 1;
          this.size[i] = this.baseSize[i] * (1 + 0.5 * e);
        }
        break;
      }
      case 'sphere': {
        const expand = easeOutCubic(clamp(u / 0.5, 0, 1));
        const spin = this.phaseTime * 0.9;
        const cs = Math.cos(spin);
        const sn = Math.sin(spin);
        const pulse = 1 + Math.sin(this.time * 2.4) * 0.03;
        for (let i = 0; i < n; i++) {
          const j = i * 3;
          const ox = lerp(this.clusterOff[j], this.shellOff[j] * pulse, expand);
          const oy = lerp(this.clusterOff[j + 1], this.shellOff[j + 1] * pulse, expand);
          const oz = lerp(this.clusterOff[j + 2], this.shellOff[j + 2] * pulse, expand);
          this.pos[j] = this.center.x + ox * cs + oz * sn;
          this.pos[j + 1] = this.center.y + oy;
          this.pos[j + 2] = this.center.z - ox * sn + oz * cs;
          // Dimmer + smaller than the other phases: thousands of additive points would otherwise blow out to a white disc.
          this.alpha[i] = (0.3 + 0.1 * Math.sin(this.time * 3 + this.seedA[i] * 20)) * (this.reduced ? 0.8 : 1);
          this.size[i] = this.baseSize[i] * lerp(1.2, 0.85, expand);
        }
        break;
      }
      case 'explosion': {
        stepExplosion(this.pos, this.vel, n, dt);
        const fade = 1 - 0.45 * easeOutCubic(u);
        for (let i = 0; i < n; i++) {
          this.alpha[i] = fade * (0.7 + 0.3 * this.seedA[i]);
          this.size[i] = this.baseSize[i] * (1.5 - 0.4 * u * (0.5 + this.seedB[i]));
        }
        break;
      }
      case 'reassembly': {
        const delayFrac = 0.35;
        const S = this.view.worldH / 4.37;
        for (let i = 0; i < n; i++) {
          const j = i * 3;
          const ui = clamp((u - this.seedA[i] * delayFrac) / (1 - delayFrac), 0, 1);
          const e = easeInOutCubic(ui);
          const wob = Math.sin(Math.PI * e) * (0.5 + this.seedB[i]) * S;
          this.pos[j] = lerp(this.from[j], this.tgtWorld[j], e) + this.curl[j] * wob;
          this.pos[j + 1] = lerp(this.from[j + 1], this.tgtWorld[j + 1], e) + this.curl[j + 1] * wob;
          this.pos[j + 2] = lerp(this.from[j + 2], this.tgtWorld[j + 2], e) + this.curl[j + 2] * wob * 0.5;
          this.alpha[i] = lerp(0.55, 1, e);
          this.size[i] = this.baseSize[i] * lerp(1.1, 0.9, e);
        }
        break;
      }
      case 'awakening':
      case 'done': {
        const fade = this.phase === 'done' ? 1 : easeInOutCubic(u);
        for (let i = 0; i < n; i++) {
          const j = i * 3;
          if (this.aura[i]) {
            // A sparse shimmer of stars that keeps living on the creature's surface.
            const tw = 0.5 + 0.5 * Math.sin(this.time * (1.2 + this.seedB[i] * 2) + this.seedA[i] * 30);
            this.alpha[i] = lerp(1, 0.18 + 0.5 * tw, fade);
            this.size[i] = this.baseSize[i] * lerp(0.9, 0.7 + 0.4 * tw, fade);
          } else {
            this.alpha[i] = 1 - fade;
            this.size[i] = this.baseSize[i] * lerp(0.9, 0.4, fade);
          }
          // Slight outward breathing so the shimmer does not look glued to the mesh.
          const k = 1 + 0.02 * Math.sin(this.time * 1.5 + this.seedA[i] * 9);
          this.pos[j] = this.tgtLocal[j] * k;
          this.pos[j + 1] = this.tgtLocal[j + 1] * k;
          this.pos[j + 2] = this.tgtLocal[j + 2] * k;
        }
        break;
      }
      default:
        break;
    }

    this.upload();
    this.advance();
  }

  private advance(): void {
    const dur = this.duration(this.phase);
    if (this.phaseTime < dur) return;
    switch (this.phase) {
      case 'convergence':
        this.enter('sphere');
        break;
      case 'sphere':
        this.enter('explosion');
        break;
      case 'explosion':
        // Particles drift on until the creature has been created and its target points are known.
        if (this.hasTargets) this.enter('reassembly');
        break;
      case 'reassembly':
        this.enter('awakening');
        break;
      case 'awakening':
        this.enter('done');
        break;
      default:
        break;
    }
  }

  private upload(): void {
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Abort everything and hide the particles. */
  cancel(): void {
    if (this.points.parent) this.points.parent.remove(this.points);
    this.points.position.set(0, 0, 0);
    this.points.visible = false;
    this.phase = 'idle';
    this.phaseTime = 0;
    this.hasTargets = false;
    this.targetRoot = null;
    this.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.cancel();
    this.geometry.dispose();
    this.material.dispose();
  }
}

function randomUnit(): [number, number, number] {
  const z = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), r * Math.sin(a), z];
}
