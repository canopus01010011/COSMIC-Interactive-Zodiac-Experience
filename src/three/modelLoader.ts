import * as THREE from 'three';
import type { ZodiacSign } from '../data/zodiacSigns';
import { assetUrl } from '../utils/assetProbe';
import { SHARED_GEOMETRIES, buildCreature } from './zodiacModels';

export interface CreatureModel {
  /** Normalised: centred at the origin and fitted into a unit-radius sphere. */
  root: THREE.Group;
  initialYaw: number;
  source: 'procedural' | 'glb';
  update(tSec: number, dt: number): void;
  dispose(): void;
}

/** Centre the object and scale it so its bounding sphere has radius 1. */
function fitToUnitSphere(object: THREE.Object3D): THREE.Group {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1;
  object.position.sub(center);
  const holder = new THREE.Group();
  holder.add(object);
  holder.scale.setScalar(1 / radius);
  return holder;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry && !SHARED_GEOMETRIES.has(mesh.geometry)) mesh.geometry.dispose();
  });
}

async function loadGlb(url: string, material: THREE.Material): Promise<CreatureModel> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = gltf.scene;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.material = material; // re-skin with the celestial material
  });
  const mixer = gltf.animations.length > 0 ? new THREE.AnimationMixer(scene) : null;
  if (mixer) for (const clip of gltf.animations) mixer.clipAction(clip).play();
  const root = fitToUnitSphere(scene);
  return {
    root,
    initialYaw: 0,
    source: 'glb',
    update: (_t, dt) => mixer?.update(dt),
    dispose: () => {
      mixer?.stopAllAction();
      disposeObject(root);
    },
  };
}

/**
 * Load the creature for a sign. A `public/models/<sign>.glb` file wins when present (it keeps its
 * animation clips and is re-skinned with the celestial material) *if it is listed in public/models/manifest.json*; otherwise the built-in procedural
 * creature is used, so the experience always works.
 */
let manifestPromise: Promise<Set<string>> | null = null;

/** Names of the GLB files listed in public/models/manifest.json (an empty set if there is none). */
function availableGlbs(): Promise<Set<string>> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        const res = await fetch(assetUrl('models/manifest.json'), { cache: 'no-cache' });
        if (!res.ok) return new Set<string>();
        const json = (await res.json()) as { models?: unknown };
        return new Set(Array.isArray(json.models) ? json.models.filter((m): m is string => typeof m === 'string') : []);
      } catch {
        return new Set<string>(); // missing manifest (or the dev server's HTML fallback)
      }
    })();
  }
  return manifestPromise;
}

export async function loadCreature(sign: ZodiacSign, material: THREE.Material): Promise<CreatureModel> {
  const url = assetUrl(`models/${sign.glbFile}`);
  if ((await availableGlbs()).has(sign.glbFile)) {
    try {
      return await loadGlb(url, material);
    } catch (err) {
      console.warn(`[COSMIC] Could not load ${sign.glbFile}; using the built-in ${sign.name} model.`, err);
    }
  }
  const built = buildCreature(sign.id, material);
  const root = fitToUnitSphere(built.group);
  return {
    root,
    initialYaw: built.initialYaw,
    source: 'procedural',
    update: (t, dt) => built.update?.(t, dt),
    dispose: () => disposeObject(root),
  };
}

/** Uniformly sample `count` points on the surface of every mesh under `root`, in root-local space. */
export function sampleSurface(root: THREE.Object3D, count: number, rng: () => number = Math.random): Float32Array {
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const tris: Array<{ a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3 }> = [];
  const areas: number[] = [];
  let total = 0;
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    if (!pos) return;
    m.multiplyMatrices(inverse, mesh.matrixWorld);
    const idx = geo.getIndex();
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const a = new THREE.Vector3().fromBufferAttribute(pos, i0).applyMatrix4(m);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i1).applyMatrix4(m);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i2).applyMatrix4(m);
      const area = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2;
      if (area <= 1e-9) continue;
      tris.push({ a, b, c });
      total += area;
      areas.push(total);
    }
  });

  const out = new Float32Array(count * 3);
  if (tris.length === 0) return out;
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // Binary search in the cumulative area table.
    const r = rng() * total;
    let lo = 0;
    let hi = areas.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (areas[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    const { a, b, c } = tris[lo];
    let u = rng();
    let w = rng();
    if (u + w > 1) {
      u = 1 - u;
      w = 1 - w;
    }
    p.copy(a).addScaledVector(b.clone().sub(a), u).addScaledVector(c.clone().sub(a), w);
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  }
  return out;
}
