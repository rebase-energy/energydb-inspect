// Types live in ./types so the in-browser WASM api can share them verbatim.
export type {
  Counts,
  Edge,
  InspectorApi,
  RawTable,
  Series,
  SeriesValues,
  StateVersion,
  TreeNode,
} from "./types";

import type { InspectorApi, RawTable, SeriesValues, StateVersion, TreeNode, Edge } from "./types";

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch("/api" + path);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

// The default (server-backed) implementation, used by the Docker/Codespaces tool.
const httpApi: InspectorApi = {
  stateVersion: () => getJSON<StateVersion>("/state-version"),
  tree: () => getJSON<{ portfolios: TreeNode[] }>("/tree"),
  edges: () => getJSON<{ edges: Edge[] }>("/edges"),
  values: (id: number, mode: "latest" | "overlapping") =>
    getJSON<SeriesValues>(`/series/${id}/values?mode=${mode}`),
  rawCh: (id: number) => getJSON<RawTable>(`/raw/ch/${id}`),
  node: (path: string) => getJSON<RawTable>(`/node?path=${encodeURIComponent(path)}`),
  edgeRow: (fromPath: string, toPath: string) =>
    getJSON<RawTable>(`/edge?from_path=${encodeURIComponent(fromPath)}&to_path=${encodeURIComponent(toPath)}`),
  reset: async (): Promise<{ ok: boolean }> => {
    const r = await fetch("/api/reset", { method: "POST" });
    if (!r.ok) throw new Error(`reset failed: ${r.status}`);
    return (await r.json()) as { ok: boolean };
  },
};

// Active implementation, swappable at startup. The WASM build calls setApi() with
// an in-browser implementation; everything else (components, panels) imports the
// stable `api` object below and never knows the difference.
let active: InspectorApi = httpApi;
export function setApi(impl: InspectorApi): void {
  active = impl;
}

export const api: InspectorApi = {
  stateVersion: () => active.stateVersion(),
  tree: () => active.tree(),
  edges: () => active.edges(),
  values: (id, mode) => active.values(id, mode),
  rawCh: (id) => active.rawCh(id),
  node: (path) => active.node(path),
  edgeRow: (fromPath, toPath) => active.edgeRow(fromPath, toPath),
  reset: () => active.reset(),
};
