import { useCallback, useEffect, useState } from "react";
import { api, type Counts, type Edge, type TreeNode } from "../api/client";

const EMPTY_COUNTS: Counts = { nodes: 0, edges: 0, series: 0, values: 0 };

/**
 * Polls the cheap /state-version endpoint (~1s) and refetches the tree + edges
 * whenever the database fingerprint changes. `refresh()` forces an immediate refetch.
 */
export function useInspector(autoRefresh: boolean) {
  const [version, setVersion] = useState("");
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [writable, setWritable] = useState(false);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const sv = await api.stateVersion();
        if (alive) {
          setVersion(sv.version);
          setCounts(sv.counts);
          setWritable(!!sv.writable);
        }
      } catch {
        /* backend not up yet, keep trying */
      }
    };
    void tick();
    if (!autoRefresh) return () => { alive = false; };
    const t = setInterval(() => void tick(), 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [autoRefresh, nonce]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [t, e] = await Promise.all([api.tree(), api.edges()]);
        if (alive) {
          setTree(t.portfolios);
          setEdges(e.edges);
        }
      } catch {
        /* ignore transient errors */
      }
    })();
    return () => { alive = false; };
  }, [version, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { version, counts, writable, tree, edges, refresh };
}
