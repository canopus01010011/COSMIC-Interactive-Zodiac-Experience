import { assetUrl, probeAsset } from '../utils/assetProbe';

declare const __MEDIAPIPE_VERSION__: string;

export type MediapipeModel = 'hand_landmarker' | 'face_landmarker';

const REMOTE_MODELS: Record<MediapipeModel, string> = {
  hand_landmarker:
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  face_landmarker:
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
};

let wasmBasePromise: Promise<string> | null = null;
const modelPromises = new Map<MediapipeModel, Promise<string>>();

/** Prefer the WASM runtime copied by `npm run setup:mediapipe`; fall back to the jsDelivr CDN. */
export function resolveWasmBase(): Promise<string> {
  if (!wasmBasePromise) {
    wasmBasePromise = (async () => {
      const local = assetUrl('mediapipe/wasm');
      if (await probeAsset(`${local}/vision_wasm_internal.wasm`)) return local;
      const version = typeof __MEDIAPIPE_VERSION__ === 'string' ? __MEDIAPIPE_VERSION__ : 'latest';
      return `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/wasm`;
    })();
  }
  return wasmBasePromise;
}

/** Prefer a locally bundled model file; fall back to Google's public model bucket. */
export function resolveModelUrl(model: MediapipeModel): Promise<string> {
  let p = modelPromises.get(model);
  if (!p) {
    p = (async () => {
      const local = assetUrl(`models/mediapipe/${model}.task`);
      if (await probeAsset(local)) return local;
      return REMOTE_MODELS[model];
    })();
    modelPromises.set(model, p);
  }
  return p;
}

/** Forget cached resolutions (used by "Try again"). */
export function resetAssetResolution(): void {
  wasmBasePromise = null;
  modelPromises.clear();
}
