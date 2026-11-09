import * as THREE from 'three';
import type { ZodiacId } from '../data/zodiacSigns';
import { clamp, damp } from '../gestures/smoothing';
import { dist, palmCenter } from '../gestures/handGeometry';
import type { Point2, TrackedHand } from '../vision/landmarkTypes';
import { createCelestialMaterial, type CelestialMaterial } from './celestialMaterial';
import type { CreatureModel } from './modelLoader';

interface DetailMaterialState {
  material: THREE.Material;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
}

const originalDetailMaterialStates = new WeakMap<THREE.Material, Omit<DetailMaterialState, 'material'>>();

/** The CreatureState data object from the specification. */
export interface CreatureState {
  modelId: ZodiacId | null;
  /** Offset as a fraction of the visible width / height (0 = centred). */
  position: { x: number; y: number };
  /** Radians. */
  rotation: { yaw: number; pitch: number };
  /** Multiplier relative to the default size. */
  scale: number;
  animationState: 'hidden' | 'forming' | 'idle' | 'interacting';
}

export const CREATURE_LIMITS = {
  minScale: 0.45,
  maxScale: 2.2,
  maxOffsetX: 0.42,
  maxOffsetY: 0.4,
  /** Hand movement (stage units) below which jitter is ignored while dragging. */
  dragJitter: 0.004,
  /** Scale-ratio dead zone for two-hand scaling. */
  deadZoneScale: 0.04,
  /** Yaw radians per radian of twist between two hands. */
  twistGain: 1.6,
  deadZoneTwist: 0.05,
  baseRadiusFraction: 0.31,
} as const;

/**
 * Owns the 3D creature and maps hand movement to rotate / move / scale:
 *  - one hand moving anywhere      -> the creature follows it (move left / right / up / down)
 *  - two hands apart / together    -> scale (clamped)
 *  - two hands twisting (steering) -> rotate around the vertical axis
 *  - hands held steady             -> model stays put (dead zones + smoothing)
 */
export class CreatureController {
  readonly root = new THREE.Group();
  readonly material: CelestialMaterial = createCelestialMaterial();
  readonly state: CreatureState = {
    modelId: null,
    position: { x: 0, y: 0 },
    rotation: { yaw: 0, pitch: 0 },
    scale: 1,
    animationState: 'hidden',
  };

  private model: CreatureModel | null = null;
  private detailMaterialStates: DetailMaterialState[] = [];
  private baseScale = 1;
  private initialYaw = 0;
  private time = 0;
  private opacity = 0;
  private opacityTarget = 0;
  private interactive = false;

  // Smoothed values actually applied to the object.
  private yaw = 0;
  private offsetX = 0;
  private offsetY = 0;
  private scale = 1;
  private aspect = 16 / 9;
  // Targets driven by the hands.
  private yawTarget = 0;
  private offsetXTarget = 0;
  private offsetYTarget = 0;
  private scaleTarget = 1;

  // Hand-tracking memory.
  private lastHandCount = 0;
  private lastCenter: Point2 | null = null;
  private dragAnchor: { hand: Point2; eff: Point2; ox: number; oy: number } | null = null;
  private twoHandAnchor: { dist: number; scale: number; angle: number; yaw: number } | null = null;
  private smoothedCenter: Point2 | null = null;

  constructor(private readonly view: { worldH: number }) {
    this.root.visible = false;
  }

  get hasModel(): boolean {
    return this.model !== null;
  }

  get isInteractive(): boolean {
    return this.interactive;
  }

  /** Install a (new) model, replacing the previous one. */
  setModel(model: CreatureModel, id: ZodiacId): void {
    if (this.model) {
      this.restoreDetailMaterials();
      this.root.remove(this.model.root);
      this.model.dispose();
    }
    this.model = model;
    this.root.add(model.root);
    const detailMaterials = new Set<THREE.Material>();
    model.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material !== this.material) detailMaterials.add(material);
      }
    });
    this.detailMaterialStates = [...detailMaterials].map((material) => {
      let original = originalDetailMaterialStates.get(material);
      if (!original) {
        original = { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite };
        originalDetailMaterialStates.set(material, original);
      }
      return { material, ...original };
    });
    this.state.modelId = id;
    this.initialYaw = model.initialYaw;
    this.resetTransform(true);
    this.applyDetailOpacity();
    this.applyTransform();
  }

  setViewHeight(worldH: number): void {
    this.view.worldH = worldH;
    this.applyTransform();
  }

  /** Fade the creature in (1) or out (0). */
  fadeTo(target: number): void {
    this.opacityTarget = target;
    if (target > 0) this.root.visible = true;
  }

  setOpacityImmediate(value: number): void {
    this.opacity = this.opacityTarget = value;
    this.material.uniforms.uOpacity.value = value;
    this.applyDetailOpacity();
    this.root.visible = value > 0.001;
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    this.state.animationState = on ? 'idle' : this.state.animationState;
    this.lastHandCount = 0;
    this.twoHandAnchor = null;
    this.lastCenter = null;
    this.dragAnchor = null;
  }

  hide(): void {
    this.setInteractive(false);
    this.setOpacityImmediate(0);
    this.state.animationState = 'hidden';
  }

  /** Back to the default pose. */
  resetTransform(immediate = false): void {
    this.yawTarget = this.initialYaw;
    this.offsetXTarget = 0;
    this.offsetYTarget = 0;
    this.scaleTarget = 1;
    if (immediate) {
      this.yaw = this.initialYaw;
      this.offsetX = 0;
      this.offsetY = 0;
      this.scale = 1;
    }
    this.twoHandAnchor = null;
    this.dragAnchor = null;
    this.syncState();
  }

  /**
   * @param hands tracked hands this frame (display space)
   * @param aspect stage aspect ratio
   */
  update(dt: number, tSec: number, hands: readonly TrackedHand[], aspect: number): void {
    this.time = tSec;
    this.aspect = aspect;
    this.opacity = damp(this.opacity, this.opacityTarget, 4.5, dt);
    if (Math.abs(this.opacity - this.opacityTarget) < 0.003) this.opacity = this.opacityTarget;
    this.material.uniforms.uOpacity.value = this.opacity;
    this.applyDetailOpacity();
    this.material.uniforms.uTime.value = tSec;
    if (this.opacity <= 0.001 && this.opacityTarget === 0) this.root.visible = false;

    this.model?.update(tSec, dt);
    if (this.interactive) this.readHands(dt, hands, aspect);

    this.yaw = damp(this.yaw, this.yawTarget, 9, dt);
    this.offsetX = damp(this.offsetX, this.offsetXTarget, 12, dt);
    this.offsetY = damp(this.offsetY, this.offsetYTarget, 12, dt);
    this.scale = damp(this.scale, this.scaleTarget, 9, dt);
    this.applyTransform();
    this.syncState();

    this.root.updateMatrixWorld(true);
    this.material.uniforms.uRootInverse.value.copy(this.root.matrixWorld).invert();
  }

  private readHands(dt: number, hands: readonly TrackedHand[], aspect: number): void {
    const L = CREATURE_LIMITS;
    const count = Math.min(2, hands.length);
    if (count !== this.lastHandCount) {
      // Changing the number of hands re-anchors the interaction so the model never jumps.
      this.lastHandCount = count;
      this.lastCenter = null;
      this.dragAnchor = null;
      this.smoothedCenter = null;
      this.twoHandAnchor = null;
    }

    this.state.animationState = count > 0 ? 'interacting' : 'idle';

    if (count === 1) {
      const raw = palmCenter(hands[0]);
      const c = (this.smoothedCenter = this.smoothedCenter
        ? { x: damp(this.smoothedCenter.x, raw.x, 18, dt), y: damp(this.smoothedCenter.y, raw.y, 18, dt) }
        : raw);
      // Position-based drag (independent of frame timing): the creature keeps the offset it had when the
      // hand appeared, plus how far the hand has moved since. Sub-threshold jitter is ignored.
      if (!this.dragAnchor) {
        this.dragAnchor = { hand: c, eff: c, ox: this.offsetXTarget, oy: this.offsetYTarget };
      }
      const A = this.dragAnchor;
      if (Math.hypot((c.x - A.eff.x) * aspect, c.y - A.eff.y) > L.dragJitter) A.eff = c;
      this.offsetXTarget = clamp(A.ox + (A.eff.x - A.hand.x), -L.maxOffsetX, L.maxOffsetX);
      this.offsetYTarget = clamp(A.oy - (A.eff.y - A.hand.y), -L.maxOffsetY, L.maxOffsetY);
    } else if (count === 2) {
      let a = palmCenter(hands[0]);
      let b = palmCenter(hands[1]);
      if (a.x > b.x) [a, b] = [b, a]; // stable order so the twist angle never flips
      const d = dist(a, b, aspect);
      const angle = Math.atan2(b.y - a.y, (b.x - a.x) * aspect);
      if (!this.twoHandAnchor) {
        this.twoHandAnchor = { dist: Math.max(d, 0.05), scale: this.scaleTarget, angle, yaw: this.yawTarget };
      }
      let twist = angle - this.twoHandAnchor.angle;
      twist = Math.atan2(Math.sin(twist), Math.cos(twist));
      const effTwist = Math.abs(twist) < L.deadZoneTwist ? 0 : twist - Math.sign(twist) * L.deadZoneTwist;
      this.yawTarget = this.twoHandAnchor.yaw + effTwist * L.twistGain;
      const ratio = d / this.twoHandAnchor.dist;
      const eff = ratio > 1 + L.deadZoneScale ? ratio - L.deadZoneScale : ratio < 1 - L.deadZoneScale ? ratio + L.deadZoneScale : 1;
      this.scaleTarget = clamp(this.twoHandAnchor.scale * eff, L.minScale, L.maxScale);
    } else {
      this.lastCenter = null;
      this.dragAnchor = null;
      this.smoothedCenter = null;
    }
  }

  private applyDetailOpacity(): void {
    for (const state of this.detailMaterialStates) {
      const transparent = state.transparent || this.opacity < 1;
      state.material.opacity = state.opacity * this.opacity;
      state.material.depthWrite = this.opacity < 1 ? false : state.depthWrite;
      if (state.material.transparent !== transparent) {
        state.material.transparent = transparent;
        state.material.needsUpdate = true;
      }
    }
  }

  private restoreDetailMaterials(): void {
    for (const state of this.detailMaterialStates) {
      state.material.opacity = state.opacity;
      state.material.depthWrite = state.depthWrite;
      if (state.material.transparent !== state.transparent) {
        state.material.transparent = state.transparent;
        state.material.needsUpdate = true;
      }
    }
    this.detailMaterialStates = [];
  }

  private applyTransform(): void {
    const breathe = 1 + Math.sin(this.time * 1.6) * 0.012;
    const bob = Math.sin(this.time * 1.1) * 0.025 * this.view.worldH * 0.2;
    this.root.scale.setScalar(this.baseRadius() * this.scale * breathe);
    this.root.position.set(this.offsetX * this.view.worldH * this.aspect, this.offsetY * this.view.worldH + bob, 0);
    this.root.rotation.set(0, this.yaw, 0);
  }

  private baseRadius(): number {
    return CREATURE_LIMITS.baseRadiusFraction * this.view.worldH;
  }

  private syncState(): void {
    this.state.rotation.yaw = this.yaw;
    this.state.position.x = this.offsetX;
    this.state.position.y = this.offsetY;
    this.state.scale = this.scale;
  }

  dispose(): void {
    this.restoreDetailMaterials();
    this.model?.dispose();
    this.material.dispose();
  }
}
