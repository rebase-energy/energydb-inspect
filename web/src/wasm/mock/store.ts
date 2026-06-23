// In-memory model for the web-only demo: NO real database. The playground
// mutates this store and the dashboard renders from it. It produces the same
// shapes the components already expect (TreeNode/Edge/Series/SeriesValues), and
// computes read frames / latest / as-of straight from the in-memory points, so
// the steps can show real sample output with zero server and zero wasm.
import type { Counts, Edge, Series, SeriesValues, StateVersion, TreeNode } from "../../api/types";
import type { Point } from "../demo/demoData";
import type { NodeSnapshot } from "../edb/diff";
import { factor } from "../edb/units";

export interface SNode {
  uuid: string;
  node_type: string;
  name: string;
  parent_uuid: string | null;
  path: string;
  data: Record<string, unknown>;
}

export interface SEdge {
  uuid: string;
  edge_type: string;
  name: string | null;
  from_id: string;
  to_id: string;
  data: Record<string, unknown>;
}

export interface SSeries {
  series_id: number;
  owner_kind: "node" | "edge";
  owner_uuid: string;
  data_type: string;
  name: string;
  canonical_unit: string;
  timeseries_type: "FLAT" | "OVERLAPPING";
  retention: string;
  points: Point[]; // FLAT: the values; OVERLAPPING ignores this
  revisions: { kt: string; points: Point[] }[]; // OVERLAPPING: one per knowledge_time
  last_write: number; // store version at the last value write (drives the badge pulse)
}

export interface SeriesMeta {
  series_id: number;
  path: string;
  data_type: string;
  name: string;
  canonical_unit: string;
}

export interface ReadFrame {
  columns: string[];
  rows: unknown[][];
}

export interface ReadOpts {
  unit?: string;
  include_knowledge_time?: boolean;
  end_known?: string;
}

export interface StoreSnapshot {
  nodes: Map<string, SNode>;
  edges: SEdge[];
  series: SSeries[];
  nextSid: number;
  ver: number;
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export class MockStore {
  nodes = new Map<string, SNode>();
  edges: SEdge[] = [];
  series: SSeries[] = [];
  ver = 0;
  private nextSid = 1;

  clear(): void {
    this.nodes.clear();
    this.edges = [];
    this.series = [];
    this.nextSid = 1;
    this.ver++;
  }

  /** Deep snapshot of the whole model, for the playground's Back button. */
  snapshotState(): StoreSnapshot {
    return structuredClone({
      nodes: this.nodes,
      edges: this.edges,
      series: this.series,
      nextSid: this.nextSid,
      ver: this.ver,
    });
  }

  restoreState(s: StoreSnapshot): void {
    const c = structuredClone(s);
    this.nodes = c.nodes;
    this.edges = c.edges;
    this.series = c.series;
    this.nextSid = c.nextSid;
    this.ver = this.ver + 1; // bump so the dashboard refetches
  }

  private touch(): void {
    this.ver++;
  }

  // --- resolve ---------------------------------------------------------------
  resolvePath(path: string): string {
    for (const n of this.nodes.values()) if (n.path === path) return n.uuid;
    throw new Error(`no node at path "${path}"`);
  }

  resolveEdge(fromPath: string, toPath: string, edgeType: string): string {
    const fu = this.resolvePath(fromPath);
    const tu = this.resolvePath(toPath);
    const e = this.edges.find((x) => x.from_id === fu && x.to_id === tu && x.edge_type === edgeType);
    if (!e) throw new Error(`no ${edgeType} edge ${fromPath} -> ${toPath}`);
    return e.uuid;
  }

  // --- mutate ----------------------------------------------------------------
  addNode(uuid: string, node_type: string, name: string, parent_uuid: string | null, path: string, data: Record<string, unknown>): void {
    this.nodes.set(uuid, { uuid, node_type, name, parent_uuid, path, data });
    this.touch();
  }

  addEdge(e: SEdge): void {
    this.edges.push(e);
    this.touch();
  }

  registerSeries(
    owner_kind: "node" | "edge",
    owner_uuid: string,
    s: { data_type: string; name: string; canonical_unit: string; timeseries_type: "FLAT" | "OVERLAPPING" },
  ): number {
    const ex = this.series.find(
      (x) => x.owner_kind === owner_kind && x.owner_uuid === owner_uuid && x.data_type === s.data_type && x.name === s.name,
    );
    if (ex) return ex.series_id; // idempotent
    const sid = this.nextSid++;
    this.series.push({
      series_id: sid,
      owner_kind,
      owner_uuid,
      data_type: s.data_type,
      name: s.name,
      canonical_unit: s.canonical_unit,
      timeseries_type: s.timeseries_type,
      retention: s.timeseries_type === "OVERLAPPING" ? "medium" : "forever",
      points: [],
      revisions: [],
      last_write: 0,
    });
    this.touch();
    return sid;
  }

  findSeries(owner_kind: "node" | "edge", owner_uuid: string, data_type: string, name: string): SSeries {
    const s = this.series.find(
      (x) => x.owner_kind === owner_kind && x.owner_uuid === owner_uuid && x.data_type === data_type && x.name === name,
    );
    if (!s) throw new Error(`no series "${data_type}/${name}" declared on this ${owner_kind}`);
    return s;
  }

  writeSeries(series_id: number, points: Point[], kt: string): void {
    const s = this.series.find((x) => x.series_id === series_id);
    if (!s) return;
    if (s.timeseries_type === "OVERLAPPING") s.revisions.push({ kt, points });
    else s.points = points;
    this.touch();
    s.last_write = this.ver; // only a real write bumps the pulse, not structural edits
  }

  // --- structural edits ------------------------------------------------------
  snapshot(uuid: string): NodeSnapshot | null {
    const n = this.nodes.get(uuid);
    return n ? { uuid: n.uuid, node_type: n.node_type, name: n.name, parent_uuid: n.parent_uuid, path: n.path, data: { ...n.data } } : null;
  }

  move(uuid: string, newParentPath: string): void {
    const node = this.nodes.get(uuid);
    if (!node) return;
    const newParentUuid = this.resolvePath(newParentPath);
    const oldPath = node.path;
    const newPath = `${newParentPath}/${node.name}`;
    for (const n of this.nodes.values()) {
      if (n.path === oldPath) {
        n.parent_uuid = newParentUuid;
        n.path = newPath;
      } else if (n.path.startsWith(oldPath + "/")) {
        n.path = newPath + n.path.slice(oldPath.length);
      }
    }
    this.touch();
  }

  update(uuid: string, patch: Record<string, unknown>): void {
    const n = this.nodes.get(uuid);
    if (n) {
      n.data = { ...n.data, ...patch };
      this.touch();
    }
  }

  del(uuid: string): void {
    const node = this.nodes.get(uuid);
    if (!node) return;
    const prefix = node.path + "/";
    const rm = new Set(
      [...this.nodes.values()].filter((n) => n.path === node.path || n.path.startsWith(prefix)).map((n) => n.uuid),
    );
    for (const u of rm) this.nodes.delete(u);
    this.series = this.series.filter((s) => !(s.owner_kind === "node" && rm.has(s.owner_uuid)));
    this.edges = this.edges.filter((e) => !rm.has(e.from_id) && !rm.has(e.to_id));
    this.touch();
  }

  // --- dashboard accessors ---------------------------------------------------
  private seriesDict(s: SSeries): Series {
    const count =
      s.timeseries_type === "OVERLAPPING" ? s.revisions.reduce((a, r) => a + r.points.length, 0) : s.points.length;
    return {
      series_id: s.series_id,
      data_type: s.data_type,
      name: s.name,
      canonical_unit: s.canonical_unit,
      timeseries_type: s.timeseries_type,
      retention: s.retention,
      has_data: count > 0,
      last_change: s.last_write,
    };
  }

  toTree(): TreeNode[] {
    const map = new Map<string, TreeNode>();
    for (const n of [...this.nodes.values()].sort(byPath)) {
      map.set(n.uuid, {
        uuid: n.uuid,
        node_type: n.node_type,
        name: n.name,
        parent_uuid: n.parent_uuid,
        path: n.path,
        data: n.data,
        series: [],
        children: [],
      });
    }
    for (const s of this.series) {
      if (s.owner_kind === "node") map.get(s.owner_uuid)?.series.push(this.seriesDict(s));
    }
    const roots: TreeNode[] = [];
    for (const n of map.values()) {
      if (n.parent_uuid && map.has(n.parent_uuid)) map.get(n.parent_uuid)!.children.push(n);
      else roots.push(n);
    }
    return roots;
  }

  toEdges(): Edge[] {
    return this.edges.map((e) => ({
      uuid: e.uuid,
      edge_type: e.edge_type,
      name: e.name,
      from_uuid: e.from_id,
      to_uuid: e.to_id,
      from_path: this.nodes.get(e.from_id)?.path ?? "",
      to_path: this.nodes.get(e.to_id)?.path ?? "",
      data: e.data,
      series: this.series.filter((s) => s.owner_kind === "edge" && s.owner_uuid === e.uuid).map((s) => this.seriesDict(s)),
    }));
  }

  counts(): Counts {
    const values = this.series.reduce(
      (a, s) => a + (s.timeseries_type === "OVERLAPPING" ? s.revisions.reduce((b, r) => b + r.points.length, 0) : s.points.length),
      0,
    );
    return { nodes: this.nodes.size, edges: this.edges.length, series: this.series.length, values };
  }

  stateVersion(): StateVersion {
    const c = this.counts();
    return { version: `${c.nodes}.${c.edges}.${c.series}.${c.values}.${this.ver}`, counts: c };
  }

  // --- values (for the plot) -------------------------------------------------
  private latestAsOf(s: SSeries, endKnown?: string): Point[] {
    if (s.timeseries_type !== "OVERLAPPING") return s.points;
    const revs = endKnown ? s.revisions.filter((r) => r.kt <= endKnown) : s.revisions;
    const byVt = new Map<string, { kt: string; v: number }>();
    for (const rev of revs) for (const p of rev.points) {
      const cur = byVt.get(p.t);
      if (!cur || rev.kt > cur.kt) byVt.set(p.t, { kt: rev.kt, v: p.v });
    }
    return [...byVt.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([t, x]) => ({ t, v: x.v }));
  }

  values(series_id: number, mode: "latest" | "overlapping"): SeriesValues {
    const s = this.series.find((x) => x.series_id === series_id);
    if (!s) return { mode, columns: [], rows: [], sql: "", query_ms: 0, stats: { count: 0 } };
    let columns: string[];
    let rows: unknown[][];
    if (mode === "overlapping") {
      columns = ["valid_time", "knowledge_time", "value"];
      rows = s.revisions
        .flatMap((rev) => rev.points.map((p) => [p.t, rev.kt, p.v] as unknown[]))
        .sort((a, b) => {
          const av = String(a[0]);
          const bv = String(b[0]);
          if (av !== bv) return av < bv ? -1 : 1;
          return String(a[1]) < String(b[1]) ? -1 : 1;
        });
    } else {
      columns = ["valid_time", "value"];
      rows = this.latestAsOf(s).map((p) => [p.t, p.v]);
    }
    const vals = rows.map((r) => Number(r[r.length - 1])).filter((v) => !Number.isNaN(v));
    const vts = rows.map((r) => String(r[0]));
    const stats = rows.length
      ? {
          count: rows.length,
          min_valid: vts.reduce((a, b) => (a < b ? a : b)),
          max_valid: vts.reduce((a, b) => (a > b ? a : b)),
          min_value: Math.min(...vals),
          max_value: Math.max(...vals),
        }
      : { count: 0 };
    return { mode, columns, rows, sql: "", query_ms: 0, stats };
  }

  // --- reads (for step sample output) ----------------------------------------
  seriesUnderSubtree(rootPath: string, data_type: string, name: string, nodeType?: string): SeriesMeta[] {
    const out: SeriesMeta[] = [];
    for (const s of this.series) {
      if (s.owner_kind !== "node" || s.data_type !== data_type || s.name !== name) continue;
      const n = this.nodes.get(s.owner_uuid);
      if (!n || !(n.path === rootPath || n.path.startsWith(rootPath + "/"))) continue;
      if (nodeType && n.node_type !== nodeType) continue;
      out.push({ series_id: s.series_id, path: n.path, data_type: s.data_type, name: s.name, canonical_unit: s.canonical_unit });
    }
    return out.sort(byPath);
  }

  readFrame(metas: SeriesMeta[], opts: ReadOpts): ReadFrame {
    const single = metas.length === 1;
    const inclKt = !!opts.include_knowledge_time;
    const rows: unknown[][] = [];
    for (const m of metas) {
      const s = this.series.find((x) => x.series_id === m.series_id)!;
      const fac = opts.unit ? factor(s.canonical_unit, opts.unit) : 1;
      if (inclKt) {
        for (const rev of s.revisions) {
          if (opts.end_known && rev.kt > opts.end_known) continue;
          for (const p of rev.points) {
            const row: unknown[] = [];
            if (!single) row.push(m.path);
            row.push(p.t, rev.kt, round3(p.v * fac));
            rows.push(row);
          }
        }
      } else {
        for (const p of this.latestAsOf(s, opts.end_known)) {
          const row: unknown[] = [];
          if (!single) row.push(m.path);
          row.push(p.t, round3(p.v * fac));
          rows.push(row);
        }
      }
    }
    const columns: string[] = [];
    if (!single) columns.push("path");
    columns.push("valid_time");
    if (inclKt) columns.push("knowledge_time");
    columns.push("value");
    return { columns, rows };
  }

}
