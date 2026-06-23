import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildSteps, type Step, type StepFocus, type StepResult } from "../demo/steps";
import type { MockClient } from "../mock/client";
import type { MockStore, StoreSnapshot } from "../mock/store";

export type StepState = "pending" | "running" | "done" | "error";
export type StepOutput = string | StepResult | null;

/** Lets the playground snapshot + restore the map camera alongside each step. */
export interface CameraAdapter {
  capture: () => unknown;
  restore: (v: unknown) => void;
}

export interface PlaygroundCtrl {
  steps: Step[];
  status: StepState[];
  outputs: StepOutput[]; // sample output shown inline under each step
  busy: boolean;
  cursor: number; // index of the next step to run; -1 when all done
  canBack: boolean;
  activeFocus: StepFocus | null; // series the active step wants the dashboard to show
  activeView: "tree" | "map" | "plot" | null; // dashboard tab the active step prefers (mobile)
  run: (i: number) => Promise<void>;
  runAll: () => Promise<void>;
  back: () => void;
  restart: () => Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Owns the guided run over the mock client + store: which steps have run, their
 * inline output, Back (restore a per-step snapshot of the store), and Restart.
 * `ctx` (refresh + pause) is handed to each step so multi-node adds animate one
 * at a time. refresh() re-renders the dashboard; the store version is
 * content-derived so the panels update too.
 */
export function usePlayground(
  client: MockClient,
  store: MockStore,
  refresh: () => void,
  camera?: CameraAdapter,
): PlaygroundCtrl {
  // Bumping `gen` rebuilds the steps (fresh closure handles) after a Restart.
  const [gen, setGen] = useState(0);
  const steps = useMemo(() => buildSteps(client), [client, gen]);
  const [status, setStatus] = useState<StepState[]>(() => steps.map(() => "pending"));
  const [outputs, setOutputs] = useState<StepOutput[]>(() => steps.map(() => null));
  const [busy, setBusy] = useState(false);
  // snaps[i] = store state captured just before step i first ran (for Back); cams[i]
  // = the map camera at that same moment, so Back restores the view too.
  const snaps = useRef<(StoreSnapshot | undefined)[]>([]);
  const cams = useRef<unknown[]>([]);

  useEffect(() => {
    setStatus(steps.map(() => "pending"));
    setOutputs(steps.map(() => null));
    snaps.current = [];
    cams.current = [];
  }, [steps]);

  const cursor = status.findIndex((s) => s !== "done");
  const lastDone = cursor < 0 ? steps.length - 1 : cursor - 1;
  const canBack = lastDone >= 0 && !busy;
  const activeFocus = cursor >= 0 ? steps[cursor]?.focus ?? null : null;
  const activeView = cursor >= 0 ? steps[cursor]?.view ?? null : null;

  const ctx = useMemo(() => ({ refresh, pause: (ms = 520) => sleep(ms) }), [refresh]);

  const run = useCallback(
    async (i: number) => {
      if (snaps.current[i] === undefined) {
        snaps.current[i] = store.snapshotState();
        cams.current[i] = camera?.capture();
      }
      setBusy(true);
      setStatus((st) => st.map((s, j) => (j === i ? "running" : s)));
      try {
        const note = await steps[i].run(ctx);
        setStatus((st) => st.map((s, j) => (j === i ? "done" : s)));
        setOutputs((o) => o.map((v, j) => (j === i ? note ?? "" : v)));
      } catch (e) {
        setStatus((st) => st.map((s, j) => (j === i ? "error" : s)));
        setOutputs((o) => o.map((v, j) => (j === i ? `error: ${String(e)}` : v)));
        throw e;
      } finally {
        refresh();
        setBusy(false);
      }
    },
    [steps, store, ctx, refresh, camera],
  );

  const runAll = useCallback(async () => {
    let i = status.findIndex((s) => s !== "done");
    if (i < 0) return;
    for (; i < steps.length; i++) {
      try {
        await run(i);
      } catch {
        break;
      }
      await sleep(240);
    }
  }, [status, steps, run]);

  const back = useCallback(() => {
    const next = status.findIndex((s) => s !== "done");
    const target = (next < 0 ? steps.length : next) - 1;
    if (target < 0) return;
    const snap = snaps.current[target];
    if (snap) store.restoreState(snap);
    snaps.current[target] = undefined;
    // Return the map to the framing it had before `target` ran (before refresh so
    // the redraw that follows leaves the restored camera in place).
    camera?.restore(cams.current[target]);
    cams.current[target] = undefined;
    setStatus((st) => st.map((s, j) => (j === target ? "pending" : s)));
    setOutputs((o) => o.map((v, j) => (j === target ? null : v)));
    refresh();
  }, [status, steps, store, refresh, camera]);

  const restart = useCallback(async () => {
    setBusy(true);
    try {
      store.clear();
      setGen((g) => g + 1);
    } finally {
      refresh();
      setBusy(false);
    }
  }, [store, refresh]);

  return { steps, status, outputs, busy, cursor, canBack, activeFocus, activeView, run, runAll, back, restart };
}
