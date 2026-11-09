import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/** Installed MediaPipe version; used to pick a matching WASM CDN fallback at runtime. */
function mediapipeVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    return pkg.version;
  } catch {
    return 'latest';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __MEDIAPIPE_VERSION__: JSON.stringify(mediapipeVersion()),
  },
  server: {
    host: 'localhost',
    port: 5173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
