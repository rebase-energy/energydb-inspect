// The left pane as an agent-style story: the current step is shown with its ask
// and code; Run (or Space) works it, the tree/map update, then it collapses to a
// one-line ask as the next becomes active. Three layouts to compare via the
// toggle (floating cards / aligned column / chat transcript) — same markup,
// CSS keyed on data-layout.
import { useEffect, useRef, useState } from "react";
import type { PlaygroundCtrl } from "../app/usePlayground";
import { CodeBlock } from "./CodeBlock";
import { Result } from "./Result";
import { RunBar } from "./RunBar";

export function Playground({ ctrl, mobile }: { ctrl: PlaygroundCtrl; mobile?: boolean }) {
  const { steps, status, outputs, busy, cursor, canBack, run, back } = ctrl;
  const allDone = cursor < 0;
  const runningIndex = status.findIndex((s) => s === "running");
  const lastDone = (allDone ? steps.length : cursor) - 1;
  // The expanded card: the one running, else the most-recently-completed (so its
  // result stays on screen), else the first step before anything has run.
  const activeIndex = runningIndex >= 0 ? runningIndex : lastDone >= 0 ? lastDone : 0;

  // Completed steps collapse to one line; click one to re-expand it for review.
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  const runNext = () => {
    if (!busy && cursor >= 0) void run(cursor).catch(() => {});
  };

  // Keep the active card in view as the story advances — align its TOP so the
  // prompt + start of the code are visible and you scroll down for the rest.
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeIndex, busy]);

  // Space / Enter = next, ArrowLeft = back (unless typing or on a button).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
      if (e.code === "Space" || e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        runNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (canBack) back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const visible = steps.filter((_, i) => i <= activeIndex);

  return (
    <div className="story">
      {!mobile && (
        <div className="pg-intro">Build an energy portfolio step by step. Press Run (or Space) to advance.</div>
      )}
      <div className="story-scroll">
        <ol className="story-list" data-layout="floating">
          {visible.map((step, i) => {
            const state = status[i];
            const expanded = i === activeIndex || open.has(i);
            const out = outputs[i];
            return (
              <li
                key={step.id}
                ref={i === activeIndex ? activeRef : undefined}
                className="story-step"
                data-state={state}
                data-active={i === activeIndex}
              >
                <button className="story-ask" onClick={() => toggle(i)}>
                  <span className="story-ask-icon">
                    {state === "done" ? "✓" : state === "running" ? <span className="story-spinner" /> : "›"}
                  </span>
                  <span className="story-ask-text">{step.prompt}</span>
                  {state === "running" && <span className="story-working">working…</span>}
                </button>
                {expanded && (
                  <div className="story-body">
                    <p className="pg-blurb">{step.blurb}</p>
                    <CodeBlock code={step.python} />
                    {typeof out === "string" && out !== "" ? (
                      <pre className="pg-out" data-error={state === "error"}>
                        {out}
                      </pre>
                    ) : out && typeof out === "object" ? (
                      <Result result={out} />
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {!mobile && <RunBar ctrl={ctrl} />}
    </div>
  );
}
