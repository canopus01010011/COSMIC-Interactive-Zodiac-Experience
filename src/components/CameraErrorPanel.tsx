interface Props {
  problem: { title: string; message: string; steps: string[] };
  onRetry?: () => void;
}

export function CameraErrorPanel({ problem, onRetry }: Props) {
  return (
    <div className="start" role="alertdialog" aria-labelledby="err-title" aria-describedby="err-msg">
      <div className="starfield" aria-hidden="true" />
      <div className="start-card error">
        <h2 id="err-title">{problem.title}</h2>
        <p id="err-msg" className="lead">{problem.message}</p>
        <ul className="steps">
          {problem.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        {onRetry ? (
          <button className="btn primary" onClick={onRetry}>Try again</button>
        ) : (
          <button className="btn primary" onClick={() => window.location.reload()}>Reload page</button>
        )}
      </div>
    </div>
  );
}
