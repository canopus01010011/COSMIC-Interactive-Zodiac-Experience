import * as THREE from 'three';

/**
 * Owns the WebGL renderer, scene and camera. The camera looks at the z = 0 plane, and `toWorld`
 * maps normalised stage coordinates (0..1, y down) onto that plane, so 2D gesture positions and
 * 3D objects share one coordinate system.
 */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  static readonly FOV = 40;
  static readonly CAMERA_Z = 6;

  /** Size of the visible z = 0 plane in world units. */
  worldH = 2 * SceneManager.CAMERA_Z * Math.tan(THREE.MathUtils.degToRad(SceneManager.FOV / 2));
  worldW = this.worldH * (16 / 9);
  /** Drawing-buffer height in px (for point-size scaling). */
  pixelHeight = 720;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(SceneManager.FOV, 16 / 9, 0.1, 50);
    this.camera.position.set(0, 0, SceneManager.CAMERA_Z);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xb9a8ff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 4, 5);
    this.scene.add(key);
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    this.camera.aspect = cssW / cssH;
    this.camera.updateProjectionMatrix();
    this.worldH = 2 * SceneManager.CAMERA_Z * Math.tan(THREE.MathUtils.degToRad(SceneManager.FOV / 2));
    this.worldW = this.worldH * this.camera.aspect;
    this.pixelHeight = cssH * dpr;
  }

  /** Normalised stage position (x right, y down) -> world position on the z = 0 plane. */
  toWorld(nx: number, ny: number, target = new THREE.Vector3()): THREE.Vector3 {
    return target.set((nx - 0.5) * this.worldW, (0.5 - ny) * this.worldH, 0);
  }

  /** World-to-pixel factor used by point sprites: pointSize(px) = size(world) * scale / distance. */
  get pointScale(): number {
    return (this.pixelHeight * 0.5) / Math.tan(THREE.MathUtils.degToRad(SceneManager.FOV / 2));
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    // No forceContextLoss(): React StrictMode re-mounts onto the same canvas and needs a live context.
    this.renderer.dispose();
  }
}
