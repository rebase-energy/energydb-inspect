// Shared API shapes. Both the server-backed client (client.ts) and the
// in-browser mock (wasm/mock/api.ts) satisfy these exact types, so every
// dashboard component is identical between the two modes.

export interface Series {
  series_id: number;
  data_type: string;
  name: string;
  canonical_unit: string;
  timeseries_type: string;
  retention: string;
  has_data: boolean;
  last_change: number; // max change_time in micros; 0 = no data
}

export interface TreeNode {
  uuid: string;
  node_type: string;
  name: string;
  parent_uuid: string | null;
  path: string;
  data: Record<string, unknown>;
  series: Series[];
  children: TreeNode[];
}

export interface Edge {
  uuid: string;
  edge_type: string;
  name: string | null;
  from_uuid: string;
  to_uuid: string;
  from_path: string;
  to_path: string;
  data: Record<string, unknown>;
  series: Series[];
}

export interface Counts {
  nodes: number;
  edges: number;
  series: number;
  values: number;
}

export interface ConnectionStatus {
  pg_ok: boolean;
  ch_ok: boolean;
  pg_target: string | null;
  ch_target: string | null;
  schema: string;
  schema_has_tables: boolean | null;
  pg_error: string | null;
  ch_error: string | null;
  env_file: string | null;
}

export interface StateVersion {
  version: string;
  counts: Counts;
  // Server only: whether the backend allows writes (the Reset button). The web
  // build has no server, so it is absent there and treated as false.
  writable?: boolean;
  // Server only, same reason: pg/ch reachability, targets and last errors.
  connection?: ConnectionStatus;
}

export interface SeriesValues {
  mode: string;
  columns: string[];
  rows: unknown[][];
  sql: string;
  query_ms?: number;
  stats: {
    count: number;
    min_valid?: string;
    max_valid?: string;
    min_value?: number;
    max_value?: number;
  };
}

export interface RawTable {
  columns: string[];
  rows: unknown[][];
  sql: string;
}

// The 9-function surface the dashboard consumes. Implemented by the HTTP client
// and the in-browser WASM layer alike.
export interface InspectorApi {
  stateVersion: () => Promise<StateVersion>;
  tree: () => Promise<{ portfolios: TreeNode[] }>;
  edges: () => Promise<{ edges: Edge[] }>;
  values: (id: number, mode: "latest" | "overlapping") => Promise<SeriesValues>;
  rawCh: (id: number) => Promise<RawTable>;
  node: (path: string) => Promise<RawTable>;
  edgeRow: (fromPath: string, toPath: string) => Promise<RawTable>;
  reset: () => Promise<{ ok: boolean }>;
}
