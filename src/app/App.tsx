import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CameraError } from '../camera/cameraErrors';
import { CameraErrorPanel } from '../components/CameraErrorPanel';
import { Hud } from '../components/Hud';
import { StartScreen } from '../components/StartScreen';
import { CosmicEngine, type EngineSnapshot } from './CosmicEngine';

const MOCK = new URLSearchParams(window.location.search).has('mock');

/** Used until the engine exists / if it fails to construct (e.g. no WebGL). */
const EMPTY: EngineSnapshot | null = null;

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const threeRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<CosmicEngine | null>(null);
  const [fatal, setFatal] = useState<CameraError | null>(null);

  // Create the engine once the DOM nodes exist; dispose (and stop the camera) on unmount.
  useEffect(() => {
    const stage = stageRef.current;
    const video = videoRef.current;
    const threeCanvas = threeRef.current;
    const overlayCanvas = overlayRef.current;
    const frame = frameRef.current;
    if (!stage || !video || !threeCanvas || !overlayCanvas || !frame) return;
    let created: CosmicEngine;
    try {
      created = new CosmicEngine({ stage, video, threeCanvas, overlayCanvas }, { mock: MOCK });
    } catch (err) {
      setFatal(err instanceof CameraError ? err : new CameraError('unknown', String(err)));
      return;
    }
    const fit = () => created.layout(frame.clientWidth, frame.clientHeight);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    setEngine(created);
    return () => {
      ro.disconnect();
      created.dispose();
      setEngine(null);
    };
  }, []);

  const snap = useSyncExternalStore<EngineSnapshot | null>(
    engine ? engine.subscribe : subscribeNothing,
    engine ? engine.getSnapshot : getNothing,
  );

  // Keyboard shortcuts.
  useEffect(() => {
    if (!engine) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        engine.cancelShow();
        engine.cancelTransform();
      }
      else if (k === 'r') engine.resetCreature();
      else if (k === 'x') engine.clearConstellation();
      else if (k === 'u') engine.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  const onStart = useCallback(() => void engine?.start(), [engine]);

  const state = snap?.appState ?? 'START';
  const showStart = state === 'START' || fatal !== null;
  const live = snap !== EMPTY && state !== 'START' && state !== 'CAMERA_ERROR';

  return (
    <div className="app" data-state={state}>
      <div className="stage-frame" ref={frameRef}>
        <div className={`stage ${live ? 'is-live' : ''}`} ref={stageRef}>
          <video ref={videoRef} className="video" playsInline muted />
          <div className="grade" />
          <canvas ref={threeRef} className="layer" />
          <canvas ref={overlayRef} className="layer" />
        </div>
      </div>

      {snap && live && engine && <Hud engine={engine} snap={snap} />}

      {fatal && <CameraErrorPanel problem={{ title: fatal.title, message: fatal.message, steps: fatal.steps }} />}
      {!fatal && snap && state === 'CAMERA_ERROR' && snap.problem && (
        <CameraErrorPanel problem={snap.problem} onRetry={() => engine?.retry()} />
      )}
      {showStart && !fatal && state === 'START' && (
        <StartScreen onStart={onStart} loading={snap?.loading ?? null} disabled={!engine} mock={MOCK} />
      )}
    </div>
  );
}

const subscribeNothing = () => () => {};
const getNothing = (): EngineSnapshot | null => null;
