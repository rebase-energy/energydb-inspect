// The dashboard's `api` surface, served from the in-memory MockStore. Only the
// read endpoints the web build actually uses are meaningful (tree / edges /
// stateVersion / values); the under-the-hood raw-row endpoints are gone from
// the web UI, so they return empty.
import type { InspectorApi, RawTable } from "../../api/types";
import type { MockStore } from "./store";

const EMPTY: RawTable = { columns: [], rows: [], sql: "" };

export function makeMockApi(store: MockStore): InspectorApi {
  return {
    stateVersion: async () => store.stateVersion(),
    tree: async () => ({ portfolios: store.toTree() }),
    edges: async () => ({ edges: store.toEdges() }),
    values: async (id, mode) => store.values(id, mode),
    rawCh: async () => EMPTY,
    node: async () => EMPTY,
    edgeRow: async () => EMPTY,
    reset: async () => {
      store.clear();
      return { ok: true };
    },
  };
}
