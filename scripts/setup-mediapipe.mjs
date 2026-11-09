#!/usr/bin/env node
/**
 * COSMIC - MediaPipe asset setup (runs automatically after `npm install`).
 *
 *  1. Copies the MediaPipe WASM runtime out of node_modules into public/mediapipe/wasm
 *     so the app can serve it locally (no CDN needed at runtime).
 *  2. Downloads the two model files (hand + face landmarker) into public/models/mediapipe.
 *
 * Nothing here is allowed to fail the install: if a download fails (offline, proxy...),
 * the app falls back to loading the models from Google's public bucket at runtime.
 * Re-run any time with:  npm run setup:mediapipe
 * Skip model download with:  COSMIC_SKIP_MODELS=1 npm install
 */
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const log = (msg) => console.log(`[cosmic:setup] ${msg}`);
const warn = (msg) => console.warn(`[cosmic:setup] ${msg}`);

// 1. WASM runtime ------------------------------------------------------------
try {
  const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  const dst = join(root, 'public', 'mediapipe', 'wasm');
  if (existsSync(src)) {
    mkdirSync(dst, { recursive: true });
    cpSync(src, dst, { recursive: true });
    log('Copied MediaPipe WASM runtime to public/mediapipe/wasm');
  } else {
    warn('@mediapipe/tasks-vision is not installed yet; skipping WASM copy (the app will use a CDN fallback).');
  }
} catch (err) {
  warn(`WASM copy failed (${err instanceof Error ? err.message : err}); the app will use a CDN fallback.`);
}

// 2. Model files -------------------------------------------------------------
const MODELS = [
  {
    file: 'hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },
  {
    file: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  },
];

if (process.env.COSMIC_SKIP_MODELS) {
  log('COSMIC_SKIP_MODELS set; not downloading models.');
} else {
  const dir = join(root, 'public', 'models', 'mediapipe');
  mkdirSync(dir, { recursive: true });
  for (const { file, url } of MODELS) {
    const target = join(dir, file);
    if (existsSync(target) && statSync(target).size > 100_000) {
      log(`${file} already present.`);
      continue;
    }
    try {
      log(`Downloading ${file} ...`);
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100_000) throw new Error('downloaded file is suspiciously small');
      writeFileSync(target, buf);
      log(`Saved ${file} (${(buf.length / 1e6).toFixed(1)} MB).`);
    } catch (err) {
      warn(`Could not download ${file}: ${err instanceof Error ? err.message : err}`);
      warn('The app will fetch it from Google storage at runtime instead. To fetch it later: npm run setup:mediapipe');
    }
  }
}

process.exit(0);
