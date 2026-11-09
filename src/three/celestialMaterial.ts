import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vWorld;
  varying vec3 vViewDir;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec4 mv = viewMatrix * world;
    vWorld = world.xyz;
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform mat4 uRootInverse;
  uniform vec3 uBase;
  uniform vec3 uMid;
  uniform vec3 uRim;
  uniform vec3 uStar;

  varying vec3 vNormalView;
  varying vec3 vWorld;
  varying vec3 vViewDir;

  float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    vec3 n = normalize(vNormalView) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 v = normalize(vViewDir);
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.4);

    // A broad key and a tight highlight give the procedural forms a more sculpted surface.
    vec3 lightDir = normalize(vec3(0.35, 0.75, 0.55));
    float ndl = max(dot(n, lightDir), 0.0);
    float diff = 0.22 + 0.78 * ndl;
    vec3 halfDir = normalize(lightDir + v);
    float specular = pow(max(dot(n, halfDir), 0.0), 42.0);
    vec3 col = mix(uBase, uMid, diff * diff);
    col += vec3(1.0, 0.92, 0.82) * specular * 0.42;

    // Tiny stars "inside" the body. They are anchored in the creature's own space (via the
    // inverse root matrix) so they stay put on the body while it rotates, moves and scales.
    vec3 localPosition = (uRootInverse * vec4(vWorld, 1.0)).xyz;
    float surfaceVariation = sin(localPosition.x * 17.0 + sin(localPosition.y * 13.0 + localPosition.z * 8.0))
                           * sin(localPosition.z * 15.0 - localPosition.y * 11.0);
    col *= 0.96 + 0.04 * surfaceVariation;
    vec3 p = localPosition * 10.0;
    vec3 cell = floor(p);
    vec3 f = fract(p) - 0.5;
    float h = hash13(cell);
    float star = 0.0;
    if (h > 0.9) {
      float d = length(f);
      float tw = 0.55 + 0.45 * sin(uTime * (1.4 + h * 2.6) + h * 40.0);
      star = smoothstep(0.24, 0.0, d) * tw;
    }
    col += uStar * star * 1.15;

    // Lavender rim light: the "celestial glow".
    col += uRim * fres * 1.15;

    float alpha = uOpacity * (0.8 + 0.2 * fres + star * 0.2);
    gl_FragColor = vec4(col, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface CelestialMaterial extends THREE.ShaderMaterial {
  uniforms: {
    uTime: { value: number };
    uOpacity: { value: number };
    uRootInverse: { value: THREE.Matrix4 };
    uBase: { value: THREE.Color };
    uMid: { value: THREE.Color };
    uRim: { value: THREE.Color };
    uStar: { value: THREE.Color };
  };
}

/** Glowing celestial material: deep indigo body, violet mid-tones, lavender rim light, twinkling inner stars. */
export function createCelestialMaterial(): CelestialMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uRootInverse: { value: new THREE.Matrix4() },
      uBase: { value: new THREE.Color('#2b1670') },
      uMid: { value: new THREE.Color('#7a4be0') },
      uRim: { value: new THREE.Color('#cdbbff') },
      uStar: { value: new THREE.Color('#ffffff') },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  }) as CelestialMaterial;
}
