import * as THREE from 'three';
import type { ZodiacId } from '../data/zodiacSigns';

/**
 * Procedural "celestial" creatures for all twelve signs, built from primitives so the app works with
 * zero binary assets. They are drop-in replaceable: put `public/models/<sign>.glb` in place and the
 * loader uses that instead (see modelLoader.ts / public/models/README.md).
 *
 * All creatures are modelled upright (+Y up), roughly 2-3 units across, standing on y = 0. Quadrupeds
 * face +X; figures that should face the viewer face +Z. The loader re-centres and normalises the size.
 */

type V3 = readonly [number, number, number];

export interface BuiltCreature {
  group: THREE.Group;
  /** Yaw (radians) that presents the creature nicely to the camera. */
  initialYaw: number;
  /** Optional per-frame animation of sub-parts (tail sway, scale beam...). */
  update?: (tSec: number, dt: number) => void;
}

const UP = new THREE.Vector3(0, 1, 0);
const SPHERE = new THREE.SphereGeometry(1, 48, 32);
const GOLD = new THREE.MeshPhysicalMaterial({ color: '#f0b968', metalness: 0.58, roughness: 0.3, clearcoat: 0.3 });
const IVORY = new THREE.MeshPhysicalMaterial({ color: '#f5e5c7', roughness: 0.48 });
const AQUA = new THREE.MeshPhysicalMaterial({ color: '#67d9e8', metalness: 0.22, roughness: 0.24, clearcoat: 0.8 });

/** Geometries shared between meshes: never disposed per-model. */
export const SHARED_GEOMETRIES: ReadonlySet<THREE.BufferGeometry> = new Set([SPHERE]);

const v = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mirrorZ = (p: V3): V3 => [p[0], p[1], -p[2]];

/** Tapered tube along a smooth curve with a radius function (0..1 along the curve). */
function taperedTubeGeometry(points: V3[], radius: (t: number) => number, tubular = 96, radial = 16): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(v), false, 'centripetal');
  const frames = curve.computeFrenetFrames(tubular, false);
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const p = curve.getPointAt(t);
    const n = frames.normals[i];
    const b = frames.binormals[i];
    const r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      positions.push(p.x + r * (c * n.x + s * b.x), p.y + r * (c * n.y + s * b.y), p.z + r * (c * n.z + s * b.z));
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

class Kit {
  readonly group = new THREE.Group();
  constructor(private readonly mat: THREE.Material) {}

  private mesh(geo: THREE.BufferGeometry, parent: THREE.Object3D, material = this.mat): THREE.Mesh {
    const m = new THREE.Mesh(geo, material);
    parent.add(m);
    return m;
  }

  sub(pos: V3, rot: V3 = [0, 0, 0], parent: THREE.Object3D = this.group): THREE.Group {
    const g = new THREE.Group();
    g.position.set(...pos);
    g.rotation.set(...rot);
    parent.add(g);
    return g;
  }

  /** Ellipsoid with radii (rx, ry, rz). */
  ell(radii: V3, pos: V3, rot: V3 = [0, 0, 0], parent: THREE.Object3D = this.group, material = this.mat): THREE.Mesh {
    const m = this.mesh(SPHERE, parent, material);
    m.scale.set(...radii);
    m.position.set(...pos);
    m.rotation.set(...rot);
    return m;
  }

  cyl(rTop: number, rBot: number, h: number, pos: V3, rot: V3 = [0, 0, 0], parent: THREE.Object3D = this.group, seg = 16): THREE.Mesh {
    const m = this.mesh(new THREE.CylinderGeometry(rTop, rBot, h, Math.max(seg, 24)), parent);
    m.position.set(...pos);
    m.rotation.set(...rot);
    return m;
  }

  /** Tapered limb from `a` (radius r0) to `b` (radius r1) with rounded joints. */
  limb(a: V3, b: V3, r0: number, r1: number, parent: THREE.Object3D = this.group, joints = true, material = this.mat): void {
    const A = v(a);
    const B = v(b);
    const dir = B.clone().sub(A);
    const len = dir.length();
    if (len < 1e-5) return;
    const m = this.mesh(new THREE.CylinderGeometry(r1, r0, len, 20, 2, true), parent, material);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    if (joints) {
      this.ell([r0, r0, r0], a, [0, 0, 0], parent, material);
      this.ell([r1, r1, r1], b, [0, 0, 0], parent, material);
    }
  }

  /** Cone from `base` to `tip`. */
  spike(base: V3, tip: V3, r: number, parent: THREE.Object3D = this.group, seg = 12, material = this.mat): void {
    const A = v(base);
    const B = v(tip);
    const dir = B.clone().sub(A);
    const len = dir.length();
    if (len < 1e-5) return;
    const m = this.mesh(new THREE.ConeGeometry(r, len, Math.max(seg, 24), 2), parent, material);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
  }

  /** Smooth tapered tube through points; radius goes r0 -> r1 (or a custom function). */
  tube(points: V3[], r0: number | ((t: number) => number), r1 = 0.02, parent: THREE.Object3D = this.group, capEnds = true, material = this.mat): void {
    const radius = typeof r0 === 'function' ? r0 : (t: number) => r0 + (r1 - r0) * t;
    this.mesh(taperedTubeGeometry(points, radius), parent, material);
    if (capEnds) {
      const s = radius(0);
      const e = radius(1);
      this.ell([s, s, s], points[0], [0, 0, 0], parent, material);
      this.ell([e, e, e], points[points.length - 1], [0, 0, 0], parent, material);
    }
  }

  /** Surface of revolution; profile = [radius, y] pairs (bottom to top). */
  lathe(profile: Array<[number, number]>, pos: V3, rot: V3 = [0, 0, 0], parent: THREE.Object3D = this.group, seg = 32): THREE.Mesh {
    const m = this.mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), Math.max(seg, 64)), parent);
    m.position.set(...pos);
    m.rotation.set(...rot);
    return m;
  }

  /** Arc (torus segment) in the XY plane. */
  arc(R: number, r: number, arc: number, pos: V3, rot: V3 = [0, 0, 0], parent: THREE.Object3D = this.group): THREE.Mesh {
    const m = this.mesh(new THREE.TorusGeometry(R, r, 14, 64, arc), parent);
    m.position.set(...pos);
    m.rotation.set(...rot);
    return m;
  }

  octa(r: number, pos: V3, parent: THREE.Object3D = this.group): THREE.Mesh {
    const m = this.mesh(new THREE.OctahedronGeometry(r, 0), parent);
    m.position.set(...pos);
    return m;
  }
}

function maneTufts(k: Kit, center: V3, radii: V3, count: number, faceDirection = 0.35, tuftRadius = 0.07): void {
  const [rx, ry, rz] = radii;
  k.ell(radii, center);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const angle = goldenAngle * i;
    const d = new THREE.Vector3(Math.cos(angle) * ring, y, Math.sin(angle) * ring);
    if (d.x > faceDirection) continue;
    const base = new THREE.Vector3(center[0] + d.x * rx * 0.82, center[1] + d.y * ry * 0.82, center[2] + d.z * rz * 0.82);
    const length = 0.22 + 0.06 * ((i * 7) % 5);
    const tip = base.clone().add(new THREE.Vector3(d.x * length, d.y * length, d.z * length));
    k.spike([base.x, base.y, base.z], [tip.x, tip.y, tip.z], tuftRadius, k.group, 24, GOLD);
  }
}

/** Four legs (two bend backwards, two forwards slightly) for the quadrupeds. */
function legs(k: Kit, o: { bodyY: number; legR: number; frontX: number; backX: number; z: number; hipDrop: number; hoof?: number }): void {
  const hoof = o.hoof ?? o.legR * 1.1;
  for (const sz of [-1, 1]) {
    for (const [x, bend] of [
      [o.frontX, 0.05],
      [o.backX, -0.14],
    ] as const) {
      const hip: V3 = [x, o.bodyY - o.hipDrop, sz * o.z];
      const foot: V3 = [x + 0.04, 0.06, sz * o.z];
      const mid = lerp3(hip, foot, 0.5);
      const knee: V3 = [mid[0] + bend, mid[1], mid[2]];
      k.limb(hip, knee, o.legR, o.legR * 0.78, k.group);
      k.limb(knee, foot, o.legR * 0.78, o.legR * 0.55, k.group);
      k.ell([hoof * 1.1, hoof * 0.6, hoof], [foot[0] + 0.03, 0.05, foot[2]]);
    }
  }
}

/* ------------------------------------------------------------------------------------------ */

function buildLeo(k: Kit): Partial<BuiltCreature> {
  const bodyY = 1.2;
  k.ell([1.0, 0.5, 0.42], [0, bodyY, 0]);
  k.ell([0.6, 0.56, 0.46], [0.55, bodyY + 0.05, 0]); // chest
  k.ell([0.55, 0.46, 0.4], [-0.7, bodyY - 0.02, 0]); // haunch
  legs(k, { bodyY, legR: 0.14, frontX: 0.65, backX: -0.78, z: 0.27, hipDrop: 0.15 });
  k.limb([0.85, 1.3, 0], [1.2, 1.62, 0], 0.32, 0.28); // neck

  const head: V3 = [1.38, 1.7, 0];
  k.ell([0.36, 0.33, 0.33], head);
  k.ell([0.3, 0.17, 0.2], [1.7, 1.58, 0]); // muzzle
  for (const sz of [-1, 1]) k.ell([0.09, 0.1, 0.05], [1.3, 2.0, sz * 0.2]); // ears

  maneTufts(k, [1.22, 1.68, 0], [0.46, 0.52, 0.5], 54);

  // Tail with a tuft.
  k.tube([[-1.4, 1.25, 0], [-1.85, 1.1, 0.03], [-2.05, 0.7, 0.08], [-1.9, 0.35, 0.1]], 0.07, 0.04);
  k.ell([0.1, 0.22, 0.1], [-1.9, 0.2, 0.1]);
  return { initialYaw: -0.6 };
}

function buildAries(k: Kit): Partial<BuiltCreature> {
  const bodyY = 1.15;
  k.ell([0.95, 0.56, 0.5], [0, bodyY, 0]);
  k.ell([0.6, 0.5, 0.48], [0.45, bodyY + 0.05, 0]);
  k.ell([0.6, 0.5, 0.46], [-0.5, bodyY, 0]);
  legs(k, { bodyY, legR: 0.09, frontX: 0.6, backX: -0.65, z: 0.24, hipDrop: 0.2 });
  k.limb([0.8, 1.35, 0], [1.1, 1.68, 0], 0.26, 0.2);
  const head: V3 = [1.25, 1.75, 0];
  k.ell([0.3, 0.27, 0.22], head);
  k.ell([0.27, 0.13, 0.14], [1.55, 1.6, 0]);
  for (const sz of [-1, 1]) k.ell([0.15, 0.05, 0.08], [1.18, 1.76, sz * 0.3], [0, 0, 0.5]);
  maneTufts(k, [1.08, 1.74, 0], [0.3, 0.35, 0.36], 28, 0.25, 0.05);
  // Curling ram horns.
  const hornBase: V3 = [1.18, 1.92, 0.13];
  const rel: V3[] = [[0, 0, 0], [-0.12, 0.18, 0.06], [-0.34, 0.26, 0.2], [-0.52, 0.12, 0.3], [-0.5, -0.1, 0.34], [-0.33, -0.2, 0.3], [-0.2, -0.1, 0.24]];
  const pts: V3[] = rel.map((p) => [hornBase[0] + p[0], hornBase[1] + p[1], hornBase[2] + p[2] - 0.0]);
  k.tube(pts, 0.1, 0.025, k.group, true, IVORY);
  k.tube(pts.map(mirrorZ), 0.1, 0.025, k.group, true, IVORY);
  k.ell([0.12, 0.13, 0.11], [-1.1, 1.3, 0]); // tail
  return { initialYaw: -0.6 };
}

function buildTaurus(k: Kit): Partial<BuiltCreature> {
  const bodyY = 1.3;
  k.ell([1.05, 0.64, 0.56], [0, bodyY, 0]);
  k.ell([0.58, 0.55, 0.52], [0.6, bodyY + 0.12, 0]); // shoulder hump
  k.ell([0.6, 0.5, 0.48], [-0.65, bodyY - 0.05, 0]);
  legs(k, { bodyY, legR: 0.15, frontX: 0.72, backX: -0.8, z: 0.32, hipDrop: 0.2 });
  k.limb([0.9, 1.45, 0], [1.35, 1.5, 0], 0.4, 0.34);
  k.ell([0.3, 0.3, 0.3], [1.0, 1.0, 0]); // dewlap
  const head: V3 = [1.5, 1.5, 0];
  k.ell([0.42, 0.37, 0.34], head, [0, 0, -0.25]);
  k.ell([0.3, 0.21, 0.27], [1.85, 1.32, 0], [0, 0, -0.25]);
  k.arc(0.1, 0.022, Math.PI * 1.7, [2.05, 1.18, 0], [0, Math.PI / 2, 0]); // nose ring
  for (const sz of [-1, 1]) k.ell([0.16, 0.06, 0.1], [1.38, 1.62, sz * 0.4], [0, 0, 0.4]);
  maneTufts(k, [1.2, 1.52, 0], [0.3, 0.35, 0.35], 28, 0.25, 0.05);
  const horn: V3[] = [[1.4, 1.78, 0.24], [1.4, 1.84, 0.46], [1.5, 1.98, 0.6], [1.68, 2.2, 0.66], [1.82, 2.42, 0.58]];
  k.tube(horn, 0.11, 0.02, k.group, true, IVORY);
  k.tube(horn.map(mirrorZ), 0.11, 0.02, k.group, true, IVORY);
  k.tube([[-1.55, 1.4, 0], [-1.9, 1.2, 0], [-2.0, 0.8, 0], [-1.95, 0.45, 0]], 0.06, 0.035);
  k.ell([0.1, 0.2, 0.1], [-1.95, 0.32, 0]);
  return { initialYaw: -0.6 };
}

/** Standing robed figure facing +Z centred at (cx, cz). */
function figure(k: Kit, cx: number, cz = 0, parent: THREE.Object3D = k.group, scale = 1): { shoulderL: V3; shoulderR: V3 } {
  const s = (n: number) => n * scale;
  k.lathe(
    [[0.001, 0.02], [s(0.42), 0.02], [s(0.44), s(0.1)], [s(0.3), s(0.6)], [s(0.2), s(1.0)], [s(0.19), s(1.25)], [0.001, s(1.3)]],
    [cx, 0, cz], [0, 0, 0], parent,
  );
  k.ell([s(0.26), s(0.32), s(0.17)], [cx, s(1.52), cz], [0, 0, 0], parent); // torso
  k.ell([s(0.29), s(0.075), s(0.19)], [cx, s(1.7), cz], [0, 0, 0], parent, GOLD); // sculpted shoulder mantle
  k.cyl(s(0.07), s(0.08), s(0.16), [cx, s(1.82), cz], [0, 0, 0], parent); // neck
  k.ell([s(0.17), s(0.2), s(0.17)], [cx, s(2.0), cz], [0, 0, 0], parent); // head
  return { shoulderL: [cx - s(0.27), s(1.64), cz], shoulderR: [cx + s(0.27), s(1.64), cz] };
}

function buildGemini(k: Kit): Partial<BuiltCreature> {
  const dx = 0.62;
  const a = figure(k, -dx);
  const b = figure(k, dx);
  // Inner arms reach out and meet in the middle; outer arms hang down.
  k.limb(a.shoulderR, [-0.28, 1.5, 0.08], 0.075, 0.06);
  k.limb([-0.28, 1.5, 0.08], [-0.03, 1.34, 0.12], 0.06, 0.05);
  k.limb(b.shoulderL, [0.28, 1.5, 0.08], 0.075, 0.06);
  k.limb([0.28, 1.5, 0.08], [0.03, 1.34, 0.12], 0.06, 0.05);
  k.ell([0.07, 0.07, 0.07], [0, 1.34, 0.12]);
  k.limb(a.shoulderL, [-dx - 0.36, 1.35, 0.05], 0.075, 0.06);
  k.limb([-dx - 0.36, 1.35, 0.05], [-dx - 0.4, 1.05, 0.1], 0.06, 0.045);
  k.limb(b.shoulderR, [dx + 0.36, 1.35, 0.05], 0.075, 0.06);
  k.limb([dx + 0.36, 1.35, 0.05], [dx + 0.4, 1.05, 0.1], 0.06, 0.045);
  // A star shared by the twins, floating above.
  const star = k.octa(0.2, [0, 2.55, 0]);
  star.scale.set(1, 1.5, 1);
  return {
    initialYaw: -0.25,
    update: (t) => {
      star.rotation.y = t * 0.9;
      star.position.y = 2.55 + Math.sin(t * 1.6) * 0.05;
    },
  };
}

function buildCancer(k: Kit): Partial<BuiltCreature> {
  const root = k.sub([0, 0, 0], [0.4, 0, 0]); // tilt so we look slightly down onto the shell
  k.ell([0.95, 0.36, 0.72], [0, 0.62, 0], [0, 0, 0], root);
  k.ell([0.72, 0.32, 0.56], [0, 0.86, -0.02], [0, 0, 0], root);
  k.arc(0.86, 0.04, Math.PI * 2, [0, 0.7, 0], [Math.PI / 2, 0, 0], root).scale.set(1, 0.78, 1);
  // Overlapping shell plates add sculpted structure without facial features.
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.27;
    k.ell([0.19, 0.045, 0.16], [x, 1.16 + Math.abs(i - 2) * 0.015, -0.12], [0, 0, (i - 2) * 0.08], root, i % 2 ? IVORY : GOLD);
  }
  // Six walking legs (three per side).
  for (const sx of [-1, 1]) {
    for (const zi of [-0.38, -0.05, 0.28]) {
      k.limb([sx * 0.7, 0.62, zi], [sx * 1.25, 0.95, zi + 0.04], 0.07, 0.05, root);
      k.limb([sx * 1.25, 0.95, zi + 0.04], [sx * 1.65, 0.02, zi + 0.16], 0.05, 0.03, root);
    }
  }
  // Claws.
  const clawL = k.sub([0, 0, 0], [0, 0, 0], root);
  const clawR = k.sub([0, 0, 0], [0, 0, 0], root);
  for (const [sx, claw] of [[-1, clawL], [1, clawR]] as const) {
    k.limb([sx * 0.55, 0.66, 0.55], [sx * 0.98, 0.85, 0.98], 0.09, 0.075, claw);
    k.limb([sx * 0.98, 0.85, 0.98], [sx * 0.6, 0.9, 1.35], 0.075, 0.07, claw);
    k.ell([0.24, 0.17, 0.28], [sx * 0.55, 0.92, 1.5], [0, sx * 0.3, 0], claw);
    k.spike([sx * 0.62, 0.94, 1.62], [sx * 0.22, 0.96, 2.0], 0.11, claw);
    k.spike([sx * 0.42, 0.9, 1.6], [sx * 0.18, 0.92, 1.95], 0.07, claw);
  }
  return {
    initialYaw: 0,
    update: (t) => {
      clawL.rotation.y = Math.sin(t * 1.4) * 0.12;
      clawR.rotation.y = -Math.sin(t * 1.4 + 0.6) * 0.12;
    },
  };
}

function buildVirgo(k: Kit): Partial<BuiltCreature> {
  const f = figure(k, 0, 0, k.group, 1.0);
  // Layered feather forms give the wings a more sculpted silhouette.
  // Wings.
  for (const sx of [-1, 1]) {
    k.ell([0.1, 0.78, 0.34], [sx * 0.32, 1.6, -0.24], [0, sx * 0.45, sx * -0.45]);
    k.ell([0.08, 0.55, 0.26], [sx * 0.5, 1.35, -0.2], [0, sx * 0.5, sx * -0.6]);
    for (let i = 0; i < 5; i++) {
      k.ell([0.045, 0.23, 0.055], [sx * (0.32 + i * 0.055), 1.43 + i * 0.09, -0.2], [0, sx * 0.48, sx * -0.5], k.group, i % 2 ? IVORY : GOLD);
    }
  }
  // Left arm raised, holding a stalk of wheat; right arm lowered.
  k.limb(f.shoulderL, [-0.42, 1.38, 0.14], 0.075, 0.06);
  k.limb([-0.42, 1.38, 0.14], [-0.33, 1.24, 0.4], 0.06, 0.05);
  k.limb(f.shoulderR, [0.4, 1.34, 0.06], 0.075, 0.06);
  k.limb([0.4, 1.34, 0.06], [0.36, 1.05, 0.14], 0.06, 0.05);
  k.tube([[-0.33, 1.0, 0.4], [-0.31, 1.6, 0.4], [-0.27, 2.2, 0.38]], 0.022, 0.012);
  for (let i = 0; i < 6; i++) {
    const y = 1.85 + i * 0.1;
    for (const sz of [-1, 1]) {
      k.ell([0.035, 0.1, 0.03], [-0.28 + sz * 0.05, y, 0.38 + sz * 0.02], [0, 0, sz * -0.5]);
    }
  }
  k.ell([0.04, 0.12, 0.04], [-0.26, 2.3, 0.38]);
  return { initialYaw: -0.2 };
}

function buildLibra(k: Kit): Partial<BuiltCreature> {
  // Base and column.
  k.lathe([[0.001, 0], [0.7, 0], [0.7, 0.06], [0.45, 0.14], [0.14, 0.3], [0.1, 0.6], [0.1, 1.6], [0.17, 1.75], [0.001, 1.8]], [0, 0, 0]);
  k.arc(0.52, 0.035, Math.PI * 2, [0, 0.1, 0], [Math.PI / 2, 0, 0], k.group).material = GOLD;
  k.arc(0.13, 0.025, Math.PI * 2, [0, 1.62, 0], [Math.PI / 2, 0, 0], k.group).material = GOLD;
  k.ell([0.19, 0.19, 0.19], [0, 2.0, 0]);
  k.spike([0, 2.15, 0], [0, 2.5, 0], 0.07);
  // Beam + hanging pans on a pivot that tilts gently.
  const beam = k.sub([0, 1.8, 0]);
  const beamMesh = k.cyl(0.05, 0.05, 2.5, [0, 0, 0], [0, 0, Math.PI / 2], beam, 12);
  beamMesh.material = GOLD;
  k.ell([0.1, 0.1, 0.1], [-1.25, 0, 0], [0, 0, 0], beam);
  k.ell([0.1, 0.1, 0.1], [1.25, 0, 0], [0, 0, 0], beam);
  const pans: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const pan = k.sub([sx * 1.25, 0, 0], [0, 0, 0], beam);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      k.limb([0, 0, 0], [Math.cos(a) * 0.5, -1.0, Math.sin(a) * 0.5], 0.014, 0.014, pan, false);
    }
    const bowl = k.ell([0.55, 0.16, 0.55], [0, -1.02, 0], [0, 0, 0], pan);
    bowl.scale.set(0.55, 0.16, 0.55);
    k.arc(0.5, 0.025, Math.PI * 2, [0, -0.96, 0], [Math.PI / 2, 0, 0], pan);
    pans.push(pan);
  }
  return {
    initialYaw: -0.2,
    update: (t) => {
      const tilt = Math.sin(t * 0.7) * 0.07;
      beam.rotation.z = tilt;
      for (const p of pans) p.rotation.z = -tilt; // pans keep hanging straight down
    },
  };
}

function buildScorpio(k: Kit): Partial<BuiltCreature> {
  k.ell([0.55, 0.26, 0.42], [0.8, 0.36, 0]); // head / thorax
  for (let i = 0; i < 5; i++) {
    k.ell([0.4 - i * 0.03, 0.24 - i * 0.01, 0.34 - i * 0.04], [0.2 - i * 0.36, 0.35, 0]);
    k.ell([0.16 - i * 0.01, 0.035, 0.035], [0.2 - i * 0.36, 0.55, 0.27], [0, 0, 0], k.group, GOLD);
  }
  // Curling tail with a pivot at its base so it can sway.
  const tail = k.sub([-1.55, 0.4, 0]);
  const tp: V3[] = [[0, 0, 0], [-0.4, 0.3, 0], [-0.55, 0.95, 0], [-0.3, 1.55, 0], [0.3, 1.8, 0], [0.9, 1.65, 0], [1.1, 1.3, 0]];
  k.tube(tp, (t) => 0.18 - 0.1 * t + 0.03 * Math.sin(t * 18), 0.07, tail);
  k.spike([1.1, 1.3, 0], [1.22, 0.95, 0], 0.09, tail);
  // Pincers.
  for (const sz of [-1, 1]) {
    k.limb([1.1, 0.38, sz * 0.3], [1.55, 0.48, sz * 0.7], 0.085, 0.075);
    k.limb([1.55, 0.48, sz * 0.7], [2.0, 0.42, sz * 0.58], 0.075, 0.07);
    k.ell([0.3, 0.14, 0.2], [2.2, 0.4, sz * 0.52], [0, sz * 0.3, 0]);
    k.spike([2.3, 0.4, sz * 0.62], [2.7, 0.4, sz * 0.36], 0.1);
    k.spike([2.3, 0.4, sz * 0.4], [2.68, 0.4, sz * 0.3], 0.06);
  }
  // Eight legs.
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const x = 0.55 - i * 0.38;
      k.limb([x, 0.3, sz * 0.3], [x - 0.05, 0.55, sz * 0.78], 0.05, 0.04);
      k.limb([x - 0.05, 0.55, sz * 0.78], [x - 0.18, 0.02, sz * 1.1], 0.04, 0.025);
    }
  }
  return {
    initialYaw: -0.55,
    update: (t) => {
      tail.rotation.z = Math.sin(t * 1.1) * 0.05;
    },
  };
}

function buildSagittarius(k: Kit): Partial<BuiltCreature> {
  const bodyY = 1.25;
  k.ell([1.0, 0.5, 0.4], [0, bodyY, 0]);
  k.ell([0.55, 0.52, 0.42], [0.7, bodyY + 0.1, 0]);
  k.ell([0.55, 0.46, 0.4], [-0.7, bodyY - 0.03, 0]);
  maneTufts(k, [0.9, 1.46, 0], [0.26, 0.32, 0.32], 24, 0.3, 0.045);
  legs(k, { bodyY, legR: 0.1, frontX: 0.78, backX: -0.82, z: 0.22, hipDrop: 0.2 });
  k.tube([[-1.4, 1.3, 0], [-1.85, 1.15, 0.02], [-2.05, 0.75, 0.05], [-1.95, 0.35, 0.08]], 0.09, 0.03); // tail
  // Human torso rising from the horse's chest.
  k.ell([0.24, 0.42, 0.22], [1.0, 2.0, 0], [0, 0, -0.12]);
  k.ell([0.15, 0.12, 0.15], [1.0, 1.62, 0]);
  k.ell([0.17, 0.2, 0.16], [1.08, 2.62, 0]); // head
  k.ell([0.25, 0.08, 0.2], [1.0, 2.28, 0], [0, 0, -0.12], k.group, GOLD);
  k.cyl(0.07, 0.08, 0.18, [1.05, 2.42, 0], [0, 0, -0.1], k.group);
  // Bow arm (towards the viewer, +Z) and draw arm.
  k.limb([1.1, 2.3, 0.22], [1.5, 2.3, 0.34], 0.07, 0.06);
  k.limb([1.5, 2.3, 0.34], [1.92, 2.34, 0.36], 0.06, 0.05);
  k.limb([1.0, 2.3, -0.2], [0.8, 2.25, -0.05], 0.07, 0.055);
  k.limb([0.8, 2.25, -0.05], [1.0, 2.32, 0.3], 0.055, 0.045);
  // Bow, string and arrow.
  k.arc(0.85, 0.032, Math.PI, [1.1, 2.34, 0.36], [0, 0, -Math.PI / 2]);
  k.limb([1.1, 3.19, 0.36], [1.1, 1.49, 0.36], 0.008, 0.008, k.group, false);
  k.limb([0.95, 2.34, 0.34], [2.35, 2.34, 0.36], 0.018, 0.018, k.group, false);
  k.spike([2.28, 2.34, 0.36], [2.55, 2.34, 0.36], 0.05);
  return { initialYaw: -0.6 };
}

function buildCapricorn(k: Kit): Partial<BuiltCreature> {
  // Goat front half.
  k.ell([0.6, 0.52, 0.42], [0.55, 1.3, 0]);
  k.limb([0.85, 1.5, 0], [1.2, 1.98, 0], 0.3, 0.2);
  k.ell([0.3, 0.23, 0.2], [1.34, 2.08, 0]);
  k.ell([0.24, 0.12, 0.13], [1.62, 1.97, 0]);
  for (const sz of [-1, 1]) k.ell([0.13, 0.05, 0.08], [1.25, 2.2, sz * 0.22], [0, 0, 0.5]);
  const horn: V3[] = [[1.22, 2.26, 0.1], [1.07, 2.52, 0.14], [0.82, 2.74, 0.18], [0.52, 2.8, 0.2], [0.25, 2.7, 0.2]];
  k.tube(horn, 0.08, 0.02, k.group, true, IVORY);
  k.tube(horn.map(mirrorZ), 0.08, 0.02, k.group, true, IVORY);
  // Folded forelegs.
  for (const sz of [-1, 1]) {
    k.limb([0.9, 1.0, sz * 0.22], [1.3, 0.78, sz * 0.24], 0.1, 0.08);
    k.limb([1.3, 0.78, sz * 0.24], [1.5, 0.35, sz * 0.24], 0.08, 0.05);
    k.ell([0.07, 0.04, 0.06], [1.53, 0.05, sz * 0.24]);
  }
  // Fish tail: a long S-curve that tapers away, ending in a fluke.
  const body: V3[] = [[0.3, 1.25, 0], [-0.4, 1.0, 0], [-1.0, 0.65, 0], [-1.5, 0.35, 0], [-1.9, 0.55, 0], [-2.05, 1.0, 0], [-1.85, 1.4, 0]];
  k.tube(body, (t) => 0.48 * Math.pow(1 - t, 0.8) + 0.08, 0.08);
  k.ell([0.05, 0.4, 0.2], [-1.78, 1.55, 0], [0, 0, 0.6]);
  k.ell([0.05, 0.4, 0.2], [-1.62, 1.5, 0], [0, 0, -0.25]);
  // Dorsal fin spikes.
  for (let i = 0; i < 5; i++) {
    const x = 0.1 - i * 0.38;
    k.spike([x, 1.6 - i * 0.18, 0], [x - 0.2, 1.95 - i * 0.2, 0], 0.06);
  }
  return { initialYaw: -0.55 };
}

function buildAquarius(k: Kit): Partial<BuiltCreature> {
  const f = figure(k, -0.3, 0);
  // Right arm holds the vessel on the shoulder; left arm hangs.
  k.limb(f.shoulderR, [0.12, 1.6, 0.14], 0.075, 0.06);
  k.limb([0.12, 1.6, 0.14], [0.32, 1.42, 0.26], 0.06, 0.05);
  k.limb(f.shoulderL, [-0.72, 1.4, 0.05], 0.075, 0.06);
  k.limb([-0.72, 1.4, 0.05], [-0.76, 1.1, 0.1], 0.06, 0.045);
  // Amphora tipped towards +X so water pours out.
  const vase = k.sub([0.55, 1.5, 0.26], [0, 0, -1.9]);
  k.lathe([[0.001, 0], [0.16, 0.02], [0.3, 0.26], [0.32, 0.46], [0.22, 0.72], [0.13, 0.88], [0.17, 1.0], [0.001, 1.0]], [0, -0.35, 0], [0, 0, 0], vase);
  for (const sz of [-1, 1]) k.arc(0.16, 0.025, Math.PI, [0, 0.72, sz * 0.2], [0, 0, Math.PI / 2], vase).position.set(0.0, 0.55, sz * 0.22);
  // Stream of water.
  const stream: V3[] = [[1.17, 1.18, 0.26], [1.4, 1.0, 0.26], [1.52, 0.55, 0.26], [1.55, 0.04, 0.26]];
  k.tube(stream, 0.05, 0.1);
  k.arc(0.48, 0.03, Math.PI * 2, [1.55, 0.03, 0.26], [Math.PI / 2, 0, 0]);
  const curve = new THREE.CatmullRomCurve3(stream.map(v), false, 'centripetal');
  const drops: THREE.Mesh[] = [];
  for (let i = 0; i < 9; i++) drops.push(k.ell([0.06, 0.09, 0.06], [0, 0, 0]));
  return {
    initialYaw: -0.25,
    update: (t) => {
      drops.forEach((d, i) => {
        const s = (t * 0.45 + i / drops.length) % 1;
        const p = curve.getPoint(s);
        d.position.set(p.x + Math.sin(t * 3 + i) * 0.05, p.y, p.z + Math.cos(t * 2.4 + i) * 0.05);
        const sc = 0.5 + 0.7 * Math.sin(Math.PI * s);
        d.scale.set(0.06 * sc, 0.09 * sc, 0.06 * sc);
      });
    },
  };
}

function fish(k: Kit, parent: THREE.Object3D): void {
  k.ell([0.75, 0.33, 0.17], [0, 0, 0], [0, 0, 0], parent);
  k.ell([0.3, 0.25, 0.14], [0.55, 0.02, 0], [0, 0, 0], parent); // head
  for (let i = 0; i < 4; i++) {
    const x = 0.25 - i * 0.12;
    k.tube([[x, -0.11, 0.15], [x - 0.04, 0.02, 0.17], [x, 0.15, 0.15]], 0.018, 0.01, parent, true, GOLD);
  }
  k.spike([-0.6, 0.02, 0], [-1.15, 0.38, 0], 0.13, parent, 12, AQUA); // forked tail
  k.spike([-0.6, 0.02, 0], [-1.15, -0.34, 0], 0.13, parent, 12, AQUA);
  k.spike([0.15, 0.3, 0], [-0.3, 0.72, 0], 0.12, parent, 12, AQUA); // dorsal fin
  k.spike([0.1, -0.28, 0], [-0.2, -0.6, 0], 0.09, parent, 12, AQUA); // belly fin
  k.ell([0.2, 0.07, 0.15], [0.25, -0.05, 0.2], [0.5, 0, -0.4], parent); // side fin
}

function buildPisces(k: Kit): Partial<BuiltCreature> {
  const a = k.sub([0.3, 0.85, 0], [0, 0, 0.3]);
  const b = k.sub([-0.3, -0.85, 0], [0, Math.PI, 0.3]);
  fish(k, a);
  fish(k, b);
  // The cord that joins the two fish at the tail.
  k.tube([[-0.8, 1.05, 0], [-1.5, 0.45, 0.05], [-0.8, 0.0, 0.1], [0, 0, 0], [0.8, 0.0, 0.1], [1.5, -0.45, 0.05], [0.8, -1.05, 0]], 0.035, 0.035);
  k.ell([0.1, 0.1, 0.1], [0, 0, 0.02]);
  return {
    initialYaw: -0.35,
    update: (t) => {
      a.position.y = 0.85 + Math.sin(t * 1.3) * 0.05;
      b.position.y = -0.85 - Math.sin(t * 1.3) * 0.05;
      a.rotation.z = 0.3 + Math.sin(t * 1.7) * 0.04;
      b.rotation.z = 0.3 + Math.sin(t * 1.7 + 1) * 0.04;
    },
  };
}

const BUILDERS: Record<ZodiacId, (k: Kit) => Partial<BuiltCreature>> = {
  aries: buildAries,
  taurus: buildTaurus,
  gemini: buildGemini,
  cancer: buildCancer,
  leo: buildLeo,
  virgo: buildVirgo,
  libra: buildLibra,
  scorpio: buildScorpio,
  sagittarius: buildSagittarius,
  capricorn: buildCapricorn,
  aquarius: buildAquarius,
  pisces: buildPisces,
};

/** Build the procedural creature for a sign, using `material` for every mesh. */
export function buildCreature(id: ZodiacId, material: THREE.Material): BuiltCreature {
  const kit = new Kit(material);
  const extra = BUILDERS[id](kit);
  return { group: kit.group, initialYaw: extra.initialYaw ?? 0, update: extra.update };
}
