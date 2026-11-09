import * as THREE from 'three';
import { damp } from '../gestures/smoothing';
import { glowSprite, starSprite } from '../effects/sprites';
import type { HeadPose } from '../vision/landmarkTypes';

/**
 * Two floating, sparkling orbital rings around a pulsing star-light above the hairline. The whole
 * effect tracks the head pose and fades out when no face is visible.
 */
export class CrystalCrown {
  readonly group = new THREE.Group();
  private readonly orbitRig = new THREE.Group();
  private readonly lightCore = new THREE.Group();
  private readonly orbitMaterial = new THREE.MeshStandardMaterial({
    color: 0xe9ddff,
    emissive: 0x9a63ff,
    emissiveIntensity: 1.8,
    metalness: 0.72,
    roughness: 0.2,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private readonly coreMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uGlow: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vPosition = normalize(position);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      uniform float uGlow;
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec3 vView;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 v = normalize(vView);
        float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.0);
        float flowA = sin(vPosition.y * 19.0 + sin(vPosition.x * 11.0 + uTime * 2.0) + uTime * 2.8);
        float flowB = sin(vPosition.z * 15.0 - vPosition.x * 9.0 - uTime * 2.2);
        float currents = smoothstep(-0.15, 0.85, flowA * 0.55 + flowB * 0.45);
        vec3 hot = vec3(1.0, 0.99, 0.9);
        vec3 warm = vec3(1.0, 0.72, 0.28);
        vec3 col = mix(hot, warm, currents * 0.7);
        col += vec3(0.45, 0.62, 1.0) * fresnel * uGlow;
        float pulse = 0.9 + 0.1 * sin(uTime * 3.2);
        gl_FragColor = vec4(col * (1.0 + currents * 0.4) * pulse, uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly starTexture: THREE.CanvasTexture;
  private readonly glowTexture: THREE.CanvasTexture;
  private readonly orbitSparkles: Array<{ sprite: THREE.Sprite; phase: number }> = [];
  private readonly lightSprites: THREE.Sprite[] = [];
  private alpha = 0;
  private cur = { x: 0.5, y: 0.2, width: 0.4, roll: 0, yaw: 0 };
  private seen = false;

  constructor() {
    this.starTexture = new THREE.CanvasTexture(starSprite('white'));
    this.glowTexture = new THREE.CanvasTexture(glowSprite('violet'));
    this.starTexture.colorSpace = this.glowTexture.colorSpace = THREE.SRGBColorSpace;

    const makeSprite = (map: THREE.Texture) =>
      new THREE.Sprite(new THREE.SpriteMaterial({
        map,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      }));

    this.group.add(this.orbitRig, this.lightCore);
    for (const [offset, phase] of [[-0.18, 0], [0.18, Math.PI / 2]] as const) {
      const orbitGeometry = new THREE.TorusGeometry(1.2, 0.018, 12, 112);
      orbitGeometry.rotateX(Math.PI / 2);
      const orbit = new THREE.Mesh(orbitGeometry, this.orbitMaterial);
      orbit.position.x = offset;
      this.orbitRig.add(orbit);

      for (let i = 0; i < 10; i++) {
        const sprite = makeSprite(this.starTexture);
        const angle = (i / 10) * Math.PI * 2;
        sprite.position.set(1.2 * Math.cos(angle), 0.025, 1.2 * Math.sin(angle));
        sprite.scale.setScalar(0.1);
        orbit.add(sprite);
        this.orbitSparkles.push({ sprite, phase: angle + phase });
      }
    }

    this.lightCore.add(new THREE.Mesh(new THREE.SphereGeometry(0.18, 32, 24), this.coreMaterial));
    const outerGlow = makeSprite(this.glowTexture);
    const coreGlow = makeSprite(this.glowTexture);
    outerGlow.material.color.set('#8b77ff');
    outerGlow.position.z = -0.08;
    coreGlow.position.z = -0.04;
    this.lightCore.add(outerGlow, coreGlow);
    this.lightSprites.push(outerGlow, coreGlow);

    this.group.visible = false;
    this.group.renderOrder = 20;
  }

  /**
   * @param head tracked head pose (null = no face: the effect fades out)
   * @param view world-space mapping of the stage
   */
  update(
    dt: number,
    tSec: number,
    head: HeadPose | null,
    view: { toWorld(nx: number, ny: number, t?: THREE.Vector3): THREE.Vector3; worldH: number },
    glow: number,
  ): void {
    if (head) {
      if (!this.seen) {
        this.cur = { x: head.x, y: head.y, width: head.width, roll: head.roll, yaw: head.yaw };
        this.seen = true;
      } else {
        this.cur.x = damp(this.cur.x, head.x, 20, dt);
        this.cur.y = damp(this.cur.y, head.y, 20, dt);
        this.cur.width = damp(this.cur.width, head.width, 12, dt);
        this.cur.roll = damp(this.cur.roll, head.roll, 14, dt);
        this.cur.yaw = damp(this.cur.yaw, head.yaw, 10, dt);
      }
    } else {
      this.seen = false;
    }

    this.alpha = damp(this.alpha, head ? 1 : 0, head ? 7 : 5, dt);
    this.group.visible = this.alpha > 0.01;
    if (!this.group.visible) return;

    view.toWorld(this.cur.x, this.cur.y, this.group.position);
    this.group.position.y += this.cur.width * view.worldH * 0.42;
    this.group.scale.setScalar(0.4 * this.cur.width * view.worldH);
    this.orbitRig.position.set(0, 0.16, 0.05);
    this.orbitRig.rotation.set(0, tSec * 0.18, 0);
    this.lightCore.position.set(0, 0.16, 0.2);
    this.lightCore.scale.setScalar(1 + 0.08 * Math.sin(tSec * 2.8));

    this.orbitMaterial.opacity = 0.75 * this.alpha;
    this.orbitMaterial.emissiveIntensity = 1.4 + 0.6 * (0.5 + 0.5 * Math.sin(tSec * 2));
    this.coreMaterial.uniforms.uTime.value = tSec;
    this.coreMaterial.uniforms.uOpacity.value = this.alpha;
    this.coreMaterial.uniforms.uGlow.value = glow;
    for (const [i, sprite] of this.lightSprites.entries()) {
      const twinkle = 0.72 + 0.28 * Math.sin(tSec * (i === 0 ? 2 : 3.2));
      (sprite.material as THREE.SpriteMaterial).opacity = this.alpha * glow * twinkle;
      sprite.scale.setScalar((i === 0 ? 1.45 : 0.72) * (1 + 0.12 * Math.sin(tSec * 2.4)));
    }
    for (const sparkle of this.orbitSparkles) {
      const twinkle = 0.5 + 0.5 * Math.sin(tSec * 3.4 + sparkle.phase);
      (sparkle.sprite.material as THREE.SpriteMaterial).opacity = this.alpha * glow * (0.25 + 0.75 * twinkle);
      sparkle.sprite.scale.setScalar(0.05 + 0.1 * twinkle);
    }
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      if (object instanceof THREE.Sprite) object.material.dispose();
    });
    this.orbitMaterial.dispose();
    this.coreMaterial.dispose();
    this.starTexture.dispose();
    this.glowTexture.dispose();
  }
}
