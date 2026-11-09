import { useState } from 'react';
import type { CosmicEngine, EngineSnapshot } from '../app/CosmicEngine';
import { getSign } from '../data/zodiacSigns';
import { SettingsPanel } from './SettingsPanel';
import { SignSelector } from './SignSelector';

interface Props {
  engine: CosmicEngine;
  snap: EngineSnapshot;
}

const PHASE_LABEL: Record<string, string> = {
  convergence: 'The stars gather...',
  sphere: 'An energy sphere forms',
  explosion: 'The sphere bursts',
  reassembly: 'Light takes shape...',
  awakening: 'Awakening',
};

function hint(snap: EngineSnapshot): string {
  if (snap.show) return snap.show === 'canopus' ? 'Canopus - press Esc to skip' : 'Love - press Esc to skip';
  switch (snap.appState) {
    case 'CAMERA_READY':
      return 'Loading tracking...';
    case 'IDLE':
      return snap.hands === 0
        ? 'Show your hand to the camera'
        : 'One finger = star - two fingers = draw - raise both open palms apart to finish - make a C to write your name; make a heart with both hands';
    case 'STAR_MODE':
      return 'Hold your fingertip still for a second to place a star';
    case 'DRAW_MODE':
      return 'Move your hand to draw. Release, then raise both open palms apart to finish';
    case 'TRANSFORMING':
      return PHASE_LABEL[snap.phase] ?? 'Transforming...';
    case 'CREATURE_MODE':
      return 'Move one hand to drag the creature - spread two hands to resize - twist two hands to rotate';
    default:
      return '';
  }
}

const GESTURE_LABEL = { none: 'No gesture', star: 'Star: one finger', draw: 'Draw: two fingers' } as const;

export function Hud({ engine, snap }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const sign = getSign(snap.sign);
  const drawing = snap.appState === 'IDLE' || snap.appState === 'STAR_MODE' || snap.appState === 'DRAW_MODE';
  const hasContent = snap.starCount + snap.strokeCount > 0;

  return (
    <div className="hud">
      <header className="hud-top">
        <div className="cam-indicator" role="status" aria-live="polite">
          <span className="rec" aria-hidden="true" />
          Camera on
          <button className="link" onClick={() => engine.stopCamera()}>Turn off</button>
        </div>

        <div className="status-pills" aria-label="Tracking status">
          <span className={`pill ${snap.hands > 0 ? 'ok' : ''}`}>Hands {snap.hands}</span>
          <span className={`pill ${snap.face ? 'ok' : ''}`}>Face {snap.face ? 'tracked' : '-'}</span>
          {snap.settings.showDebug && (
            <span className="pill mono">
              {snap.fps} fps - vision {snap.visionFps} fps / {snap.inferenceMs} ms
            </span>
          )}
        </div>

        <button
          className={`icon-btn ${showSettings ? 'on' : ''}`}
          aria-expanded={showSettings}
          aria-label="Settings"
          onClick={() => setShowSettings((s) => !s)}
        >
          &#9881;
        </button>
      </header>

      {showSettings && (
        <div className="settings-wrap">
          <SettingsPanel settings={snap.settings} onChange={(p) => engine.updateSettings(p)} />
        </div>
      )}

      {drawing && (
        <div className={`gesture-badge g-${snap.gesture}`} role="status" aria-live="polite" data-testid="gesture">
          <span className="dot" aria-hidden="true" />
          {GESTURE_LABEL[snap.gesture]}
          {snap.gesture === 'none' && snap.gestureConfidence < 1 && snap.gestureConfidence > 0 && (
            <i className="conf" style={{ width: `${Math.round(snap.gestureConfidence * 100)}%` }} />
          )}
        </div>
      )}

      {snap.toast && (
        <div className="toast" role="status" key={snap.toast.id}>{snap.toast.text}</div>
      )}

      <footer className="hud-bottom">
        <p className="hint" aria-live="polite">{hint(snap)}</p>

        <div className="controls">
          <div className="sign-block">
            <span className="sign-name">
              <span className="glyph" aria-hidden="true">{sign.glyph}</span> {sign.name}
              <small>{sign.creature}</small>
            </span>
            <SignSelector
              value={snap.sign}
              disabled={snap.appState === 'TRANSFORMING'}
              onChange={(id) => engine.setSign(id)}
            />
          </div>

          <div className="actions">
            {drawing && (
              <>
                <button className="btn" onClick={() => engine.startShow('canopus')} disabled={snap.show !== null} title="Write the name from Settings in light">
                  Write name
                </button>
                <button className="btn" onClick={() => engine.startShow('heart')} disabled={snap.show !== null}>
                  Heart
                </button>
                <button className="btn" onClick={() => engine.undo()} disabled={!hasContent}>Undo</button>
                <button className="btn" onClick={() => engine.clearConstellation()} disabled={!hasContent}>Clear</button>
                <button className="btn primary" onClick={() => engine.finishDrawing()} disabled={!hasContent} title="Same as holding both open palms apart">
                  Finish &#10022;
                </button>
              </>
            )}
            {snap.show && (
              <button className="btn" onClick={() => engine.cancelShow()}>Skip (Esc)</button>
            )}
            {snap.appState === 'TRANSFORMING' && (
              <button className="btn" onClick={() => engine.cancelTransform()}>Cancel (Esc)</button>
            )}
            {snap.appState === 'CREATURE_MODE' && (
              <>
                <button className="btn" onClick={() => engine.resetCreature()} title="Shortcut: R">Reset view</button>
                <button className="btn primary" onClick={() => engine.restart()}>New constellation</button>
              </>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
