// The Run / Back / Run all / Restart controls. Rendered at the bottom of the
// story column on desktop, and pinned to the bottom of the page on mobile.
import type { PlaygroundCtrl } from "../app/usePlayground";

export function RunBar({ ctrl }: { ctrl: PlaygroundCtrl }) {
  const { steps, status, busy, cursor, canBack, run, runAll, back, restart } = ctrl;
  const allDone = cursor < 0;
  const runNext = () => {
    if (!busy && cursor >= 0) void run(cursor).catch(() => {});
  };

  return (
    <div className="pg-run-bar">
      <div className="pg-run-primary">
        <button className="btn pg-back" disabled={!canBack} onClick={back} title="Undo the last step">
          <span className="pg-chevron">‹</span>
          Back
        </button>
        {allDone ? (
          <span className="pg-run-done">✓ Done</span>
        ) : (
          <button className="btn primary pg-run-next" disabled={busy} onClick={runNext}>
            {status[cursor] === "running" ? (
              <>
                <span className="story-spinner" />
                Running…
              </>
            ) : status[cursor] === "error" ? (
              <>
                <span className="pg-ico-retry">↻</span>
                Retry
              </>
            ) : (
              <>
                <span className="pg-ico-play" />
                Run
              </>
            )}
          </button>
        )}
      </div>
      <div className="pg-run-secondary">
        {!allDone && (
          <button className="btn subtle" disabled={busy} onClick={() => void runAll()} title="Run all remaining steps">
            Run all
          </button>
        )}
        <button className="btn subtle" disabled={busy} onClick={() => void restart()} title="Start over from an empty portfolio">
          <span className="pg-ico-retry">↻</span>
          Restart
        </button>
      </div>
      {!allDone && (
        <span className="pg-run-meta">
          <b>{cursor + 1}</b>/{steps.length}
        </span>
      )}
    </div>
  );
}
