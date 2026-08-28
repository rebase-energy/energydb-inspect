import { useCallback, useEffect, useState } from "react";
import { api, HttpError, type ConnectionStatus, type Counts, type Edge, type TreeNode } from "../api/client";

const EMPTY_COUNTS: Counts = { nodes: 0, edges: 0, series: 0, values: 0 };

// Whether the /api/* backend itself answered, distinct from whether the
// database it talks to is up (that's `connection`, from state-version's
// payload). "unauthorized" only happens session-aware (embedded): the
// backend is up but rejected our X-EDB-Session/X-EDB-Token.
export type Reachability = "connecting" | "ok" | "unreachable" | "unauthorized";

/**
 * Polls the cheap /state-version endpoint (~1s) and refetches the tree + edges
 * whenever the database fingerprint changes. `refresh()` forces an immediate refetch.
 */
export function useInspector(autoRefresh: boolean) {
  const [version, setVersion] = useState("");
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [writable, setWritable] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [reachability, setReachability] = useState<Reachability>("connecting");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [nonce, setNonce] = useState(0);

  const onFetchFailed = useCallback((err: unknown) => {
    setReachability(err instanceof HttpError && err.status === 401 ? "unauthorized" : "unreachable");
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const sv = await api.stateVersion();
        if (alive) {
          setVersion(sv.version);
          setCounts(sv.counts);
          setWritable(!!sv.writable);
          setConnection(sv.connection ?? null);
          setReachability("ok");
        }
      } catch (err) {
        if (alive) onFetchFailed(err);
      }
    };
    void tick();
    if (!autoRefresh) return () => { alive = false; };
    const t = setInterval(() => void tick(), 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [autoRefresh, nonce, onFetchFailed]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [t, e] = await Promise.all([api.tree(), api.edges()]);
        if (alive) {
          setTree(t.portfolios);
          setEdges(e.edges);
        }
      } catch (err) {
        if (alive) onFetchFailed(err);
      }
    })();
    return () => { alive = false; };
  }, [version, nonce, onFetchFailed]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { version, counts, writable, connection, reachability, tree, edges, refresh };
}
