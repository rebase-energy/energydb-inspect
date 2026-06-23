import { useCallback, useEffect, useState } from "react";
import { api, type Counts, type Edge, type TreeNode } from "../../api/client";

const EMPTY_COUNTS: Counts = { nodes: 0, edges: 0, series: 0, values: 0 };

/**
 * In-browser replacement for useInspector: no polling (there is no server to
 * poll). Fetches the tree + edges once the engines are ready, and again whenever
 * `refresh()` is called (after a playground step writes, or a Reset). The
 * dashboard's panels re-fetch off the changing `version`, exactly as before.
 */
export function useWasmInspector(ready: boolean) {
  const [version, setVersion] = useState("");
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void (async () => {
      try {
        const sv = await api.stateVersion();
        const [t, e] = await Promise.all([api.tree(), api.edges()]);
        if (alive) {
          setVersion(sv.version);
          setCounts(sv.counts);
          setTree(t.portfolios);
          setEdges(e.edges);
        }
      } catch {
        /* engines not ready yet */
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { version, counts, tree, edges, refresh };
}
