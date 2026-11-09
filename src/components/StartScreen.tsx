interface Props {
  onStart: () => void;
  loading: string | null;
  disabled: boolean;
  mock: boolean;
}

export function StartScreen({ onStart, loading, disabled, mock }: Props) {
  const busy = loading !== null;
  return (
    <div className="start" role="dialog" aria-labelledby="start-title">
      <div className="starfield" aria-hidden="true" />
      <div className="start-card">
        <div className="logo-mark" aria-hidden="true">
          <svg viewBox="0 0 64 64" width="56" height="56">
            <path d="M32 4 L36 28 L60 32 L36 36 L32 60 L28 36 L4 32 L28 28 Z" fill="currentColor" />
          </svg>
        </div>
        <h1 id="start-title">COSMIC</h1>
        <p className="tagline">Constellations in Motion</p>
        <p className="lead">
          Draw a constellation in the air with your hands and awaken the creature of your zodiac sign.
        </p>

        <ol className="how">
          <li><b>One finger</b> held still summons a star.</li>
          <li><b>Two close fingers</b> draw a line of light.</li>
          <li><b>Raise both hands, open your palms, and hold them apart</b> to transform the constellation.</li>
          <li><b>Make a C</b> with one hand or trace a C in the air, then pause, to write your chosen name; make a <b>heart with both hands</b> for the heart animation.</li>
        </ol>

        <button className="btn primary" onClick={onStart} disabled={busy || disabled}>
          {busy ? loading : 'Enable webcam'}
        </button>

        <p className="privacy">
          <span aria-hidden="true">&#128274;</span> COSMIC needs your camera to see your hands and face. Video is processed
          entirely in your browser - it is never recorded, stored or uploaded. Your browser will ask for permission.
        </p>
        {mock && <p className="mock-note">Mock tracker active: use the mouse, keys 1 / 2 (gestures), B (second hand), K (finish).</p>}
      </div>
    </div>
  );
}
