import * as THREE from 'three';
import type { ZodiacSign } from '../data/zodiacSigns';

const GLYPH_FONTS = '"Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols", "Noto Sans Symbols 2", "DejaVu Sans", "Arial Unicode MS", sans-serif';

function radialTexture(stops: Array<[number, string]>, size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glyphTexture(glyph: string, size = 512): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${size * 0.62}px ${GLYPH_FONTS}`;
  // Wide soft glow, then a crisp white core.
  ctx.shadowColor = 'rgba(170,130,255,1)';
  ctx.shadowBlur = size * 0.09;
  ctx.fillStyle = 'rgba(200,180,255,0.9)';
  ctx.fillText(glyph, size / 2, size / 2 + size * 0.03);
  ctx.shadowBlur = size * 0.03;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(glyph, size / 2, size / 2 + size * 0.03);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The glowing energy sphere: a luminous halo, three slowly turning rings (the "lines") and the zodiac
 * glyph visible inside. The particle shell itself is rendered by ParticleMorph; this adds the glow.
 */
export class EnergySphere {
  readonly group = new THREE.Group();
  private readonly halo: THREE.Sprite;
  private readonly core: THREE.Sprite;
  private readonly glyph: THREE.Sprite;
  private readonly rings: THREE.LineLoop[] = [];
  private readonly glyphCache = new Map<string, THREE.CanvasTexture>();
  private radius = 1;
  private intensity = 0;
  private glyphAlpha = 0;
  private time = 0;
  glowScale = 1;

  constructor() {
    const haloTex = radialTexture([
      [0, 'rgba(255,255,255,0.9)'],
      [0.25, 'rgba(190,160,255,0.55)'],
      [0.6, 'rgba(120,70,235,0.18)'],
      [1, 'rgba(80,40,200,0)'],
    ]);
    const coreTex = radialTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.4, 'rgba(225,215,255,0.55)'],
      [1, 'rgba(200,180,255,0)'],
    ]);
    const mat = (map: THREE.Texture) =>
      new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.halo = new THREE.Sprite(mat(haloTex));
    this.core = new THREE.Sprite(mat(coreTex));
    this.glyph = new THREE.Sprite(mat(glyphTexture('♈︎')));
    this.group.add(this.halo, this.core, this.glyph);

    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(pts);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.LineLoop(
        ringGeo,
        new THREE.LineBasicMaterial({ color: 0xcdbbff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      ring.rotation.set(i * 1.05, i * 0.7, i * 0.4);
      this.rings.push(ring);
      this.group.add(ring);
    }
    this.group.visible = false;
  }

  setSign(sign: ZodiacSign): void {
    let tex = this.glyphCache.get(sign.id);
    if (!tex) {
      tex = glyphTexture(sign.glyph);
      this.glyphCache.set(sign.id, tex);
    }
    (this.glyph.material as THREE.SpriteMaterial).map = tex;
    (this.glyph.material as THREE.SpriteMaterial).needsUpdate = true;
  }

  setCenter(p: THREE.Vector3): void {
    this.group.position.copy(p);
  }

  setRadius(r: number): void {
    this.radius = r;
  }

  /** intensity: overall glow 0..1; glyph: glyph opacity 0..1. */
  setState(intensity: number, glyph: number): void {
    this.intensity = Math.max(0, intensity);
    this.glyphAlpha = Math.max(0, glyph);
    this.group.visible = this.intensity > 0.002 || this.glyphAlpha > 0.002;
  }

  update(dt: number): void {
    this.time += dt;
    if (!this.group.visible) return;
    const pulse = 1 + Math.sin(this.time * 2.4) * 0.035;
    const R = this.radius * pulse;
    const gs = this.glowScale;
    this.halo.scale.setScalar(R * 3.6);
    this.core.scale.setScalar(R * 1.7);
    this.glyph.scale.setScalar(R * 1.45);
    (this.halo.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.5 * this.intensity * gs);
    (this.core.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.22 * this.intensity * gs);
    (this.glyph.material as THREE.SpriteMaterial).opacity = Math.min(1, this.glyphAlpha);
    this.rings.forEach((ring, i) => {
      ring.scale.setScalar(R * (1.02 + 0.03 * i));
      ring.rotation.x += dt * (0.35 + i * 0.12);
      ring.rotation.y += dt * (0.5 - i * 0.1);
      (ring.material as THREE.LineBasicMaterial).opacity = 0.42 * this.intensity * gs;
    });
  }

  dispose(): void {
    for (const t of this.glyphCache.values()) t.dispose();
    this.halo.material.map?.dispose();
    this.core.material.map?.dispose();
    this.halo.material.dispose();
    this.core.material.dispose();
    this.glyph.material.dispose();
    this.rings[0]?.geometry.dispose();
    for (const r of this.rings) (r.material as THREE.Material).dispose();
  }
}
