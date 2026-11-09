import { HAND_LM as L, type Landmark, type TrackedFace, type TrackedHand } from './landmarkTypes';

/**
 * Synthetic hand landmarks with realistic proportions. Used by the unit tests and by the
 * "mock tracker" (`?mock=1`) that lets you drive the whole experience with a mouse and keyboard.
 *
 * Local hand space: unit = wrist -> middle knuckle ("one palm"), x right, y DOWN, wrist at (0,0).
 */
export type MockPose = 'one' | 'two' | 'peace' | 'open' | 'fist';

export interface MockHandSpec {
  pose: MockPose;
  /** Position of the pose anchor (index tip for `one`, index/middle midpoint for `two`, palm otherwise), display-normalised. */
  x: number;
  y: number;
  /** Palm size in stage-height units (wrist -> middle knuckle). ~0.12-0.2 is typical. */
  size?: number;
  /** Rotation in radians (0 = fingers up). */
  rotation?: number;
  aspect?: number;
  score?: number;
  handedness?: 'Left' | 'Right';
}

type V = [number, number];

const MCP: Record<string, V> = {
  index: [-0.3, -0.95],
  middle: [0, -1.0],
  ring: [0.28, -0.93],
  pinky: [0.52, -0.78],
};
const SEG: Record<string, [number, number, number]> = {
  index: [0.42, 0.25, 0.22],
  middle: [0.48, 0.28, 0.23],
  ring: [0.44, 0.26, 0.22],
  pinky: [0.34, 0.2, 0.18],
};

function finger(name: string, mode: 'extended' | 'folded', lean = 0): V[] {
  const [mx, my] = MCP[name];
  const [s1, s2, s3] = SEG[name];
  const dir: V = [Math.sin(lean), -Math.cos(lean)];
  if (mode === 'extended') {
    const pip: V = [mx + dir[0] * s1, my + dir[1] * s1];
    const dip: V = [pip[0] + dir[0] * s2, pip[1] + dir[1] * s2];
    const tip: V = [dip[0] + dir[0] * s3, dip[1] + dir[1] * s3];
    return [[mx, my], pip, dip, tip];
  }
  // Folded: proximal phalanx rises a little, the rest curls back over the palm.
  const pip: V = [mx, my - s1 * 0.7];
  const dip: V = [mx, pip[1] + s2 * 0.7];
  const tip: V = [mx, dip[1] + s3 * 0.65];
  return [[mx, my], pip, dip, tip];
}

function localHand(pose: MockPose): { pts: V[]; anchor: V } {
  const thumbOpen: V[] = [[-0.2, -0.2], [-0.42, -0.42], [-0.62, -0.62], [-0.78, -0.8]];
  const thumbTucked: V[] = [[-0.2, -0.2], [-0.38, -0.4], [-0.35, -0.6], [-0.25, -0.72]];

  const fingers: Record<string, V[]> = {
    index: finger('index', 'extended'),
    middle: finger('middle', 'extended'),
    ring: finger('ring', 'extended'),
    pinky: finger('pinky', 'extended'),
  };
  let thumb = thumbOpen;

  switch (pose) {
    case 'one':
      fingers.middle = finger('middle', 'folded');
      fingers.ring = finger('ring', 'folded');
      fingers.pinky = finger('pinky', 'folded');
      thumb = thumbTucked;
      break;
    case 'two':
      fingers.index = finger('index', 'extended', 0.18);
      fingers.ring = finger('ring', 'folded');
      fingers.pinky = finger('pinky', 'folded');
      thumb = thumbTucked;
      break;
    case 'peace':
      fingers.index = finger('index', 'extended', -0.2);
      fingers.middle = finger('middle', 'extended', 0.2);
      fingers.ring = finger('ring', 'folded');
      fingers.pinky = finger('pinky', 'folded');
      thumb = thumbTucked;
      break;
    case 'fist':
      for (const n of ['index', 'middle', 'ring', 'pinky']) fingers[n] = finger(n, 'folded');
      thumb = thumbTucked;
      break;
    case 'open':
      fingers.index = finger('index', 'extended', -0.1);
      fingers.ring = finger('ring', 'extended', 0.08);
      fingers.pinky = finger('pinky', 'extended', 0.18);
      break;
  }

  const pts: V[] = [[0, 0], ...thumb, ...fingers.index, ...fingers.middle, ...fingers.ring, ...fingers.pinky];

  let anchor: V;
  if (pose === 'one') anchor = pts[L.INDEX_TIP];
  else if (pose === 'two') anchor = [(pts[L.INDEX_TIP][0] + pts[L.MIDDLE_TIP][0]) / 2, (pts[L.INDEX_TIP][1] + pts[L.MIDDLE_TIP][1]) / 2];
  else {
    const ids: number[] = [L.WRIST, L.INDEX_MCP, L.MIDDLE_MCP, L.RING_MCP, L.PINKY_MCP];
    anchor = [ids.reduce((a, i) => a + pts[i][0], 0) / ids.length, ids.reduce((a, i) => a + pts[i][1], 0) / ids.length];
  }
  return { pts, anchor };
}

export function buildMockHand(spec: MockHandSpec): TrackedHand {
  const size = spec.size ?? 0.16;
  const aspect = spec.aspect ?? 16 / 9;
  const rot = spec.rotation ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const { pts, anchor } = localHand(spec.pose);

  const landmarks: Landmark[] = pts.map(([px, py]) => {
    const rx = px - anchor[0];
    const ry = py - anchor[1];
    const x = (rx * cos - ry * sin) * size;
    const y = (rx * sin + ry * cos) * size;
    return { x: spec.x + x / aspect, y: spec.y + y, z: 0 };
  });
  return { landmarks, handedness: spec.handedness ?? 'Right', score: spec.score ?? 0.95 };
}

/** A fixed, gently swaying face for the mock tracker. */
export function buildMockFace(tSec: number): TrackedFace {
  const sway = Math.sin(tSec * 0.8) * 0.006;
  const roll = Math.sin(tSec * 0.5) * 0.04;
  return {
    leftEye: { x: 0.432 + sway, y: 0.33 + sway * 0.4, radius: 0.017 },
    rightEye: { x: 0.568 + sway, y: 0.33 - sway * 0.4, radius: 0.017 },
    roll,
    hasIris: true,
    head: { x: 0.5 + sway, y: 0.24, width: 0.46, roll, yaw: Math.sin(tSec * 0.6) * 0.25 },
  };
}
