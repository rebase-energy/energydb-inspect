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
import { getSessionCreds } from "../session";

// Session headers (X-EDB-Session/X-EDB-Token), added to every /api/* call when
// this dashboard is running session-aware (embedded, playground deployment);
// absent entirely in standalone use (getSessionCreds() is null), unchanged.
function sessionHeaders(): HeadersInit | undefined {
  const creds = getSessionCreds();
  if (!creds) return undefined;
  return { "X-EDB-Session": creds.sessionId, "X-EDB-Token": creds.token };
}

// Deliberately RELATIVE (no leading slash): resolves against the current
// document's own URL, so this dashboard works whether served at the origin
// root (CLI / local dev) or under a sub-path like /inspect/ (the playground's
// Caddy edge, which strips /inspect before forwarding to this backend --
// relative "api/..." resolves to "/inspect/api/..." from the browser's side,
// matching what Caddy expects on the way back in).
async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch("api" + path, { headers: sessionHeaders() });
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
    const r = await fetch("api/reset", { method: "POST", headers: sessionHeaders() });
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
