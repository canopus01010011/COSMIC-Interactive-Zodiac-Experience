import * as THREE from 'three';

/**
 * Explosion physics + a soft shockwave ring.
 * Each particle gets an outward direction, its own speed, drag and (in ParticleMorph) lifetime fade,
 * so the burst has varied speeds, sizes and fading opacity rather than a uniform expanding ball.
 */
export function initExplosionVelocities(
  pos: Float32Array,
  vel: Float32Array,
  count: number,
  center: THREE.Vector3,
  worldScale: number,
  rng: () => number = Math.random,
): void {
  const d = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    d.set(pos[i * 3] - center.x, pos[i * 3 + 1] - center.y, pos[i * 3 + 2] - center.z);
    if (d.lengthSq() < 1e-6) d.set(rng() - 0.5, rng() - 0.5, rng() - 0.5);
    d.normalize();
    d.x += (rng() - 0.5) * 0.5;
    d.y += (rng() - 0.5) * 0.5;
    d.z += (rng() - 0.5) * 0.5;
    d.normalize();
    // Mostly flung sideways across the view; z is damped so nothing flies into the camera.
    const speed = (0.9 + 3.4 * Math.pow(rng(), 1.6)) * worldScale;
    vel[i * 3] = d.x * speed;
    vel[i * 3 + 1] = d.y * speed;
    vel[i * 3 + 2] = d.z * speed * 0.35;
  }
}

export function stepExplosion(pos: Float32Array, vel: Float32Array, count: number, dt: number, drag = 1.05): void {
  const k = Math.exp(-drag * dt);
  for (let i = 0; i < count; i++) {
    const j = i * 3;
    vel[j] *= k;
    vel[j + 1] *= k;
    vel[j + 2] *= k;
    pos[j] += vel[j] * dt;
    pos[j + 1] += vel[j + 1] * dt;
    pos[j + 2] += vel[j + 2] * dt;
  }
}

/** An expanding, fading ring that accompanies the burst (kept gentle - no bright flash). */
export class ExplosionShockwave {
  readonly object: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private t = 0;
  private duration = 1.1;
  private maxRadius = 3;
  private strength = 0.4;
  private active = false;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      color: 0xb9a4ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.object = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.0, 96), this.material);
    this.object.visible = false;
  }

  trigger(center: THREE.Vector3, maxRadius: number, strength: number): void {
    this.object.position.copy(center);
    this.maxRadius = maxRadius;
    this.strength = strength;
    this.t = 0;
    this.active = true;
    this.object.visible = true;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const u = Math.min(1, this.t / this.duration);
    const e = 1 - Math.pow(1 - u, 3);
    this.object.scale.setScalar(Math.max(0.01, e * this.maxRadius));
    this.material.opacity = this.strength * (1 - u) * (1 - u);
    if (u >= 1) this.stop();
  }

  stop(): void {
    this.active = false;
    this.object.visible = false;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
