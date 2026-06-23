// The one inspector dashboard. The structure tree on the left is shared by every
// build; `mode` picks the right side and the extras:
//  - "server" (the local DB-scanning tool): the classic detail column (node/edge
//    Postgres metadata + map), a full-height timeseries panel, and the bottom
//    "Under the hood" dock with the SQL + raw backing rows.
//  - "web" (the in-browser demo): the polished map + floating-plot layout, driven
//    by the Playground story column. No SQL, no raw rows, no detail panel, since
//    there is no server to query.
// The top bar (Header / web top bar) and the Playground live in the shells
// (App / WasmApp), not here.
import { type MouseEvent as ReactMouseEvent, type Ref, useEffect, useRef, useState } from "react";
import type { Edge, Series, TreeNode } from "./api/client";
import { EdgePanel } from "./components/EdgePanel";
import { MapPanel, type MapHandle } from "./components/MapPanel";
import { NodePanel } from "./components/NodePanel";
import { SeriesPanel } from "./components/SeriesPanel";
import { TreeView } from "./components/TreeView";
import { UnderTheHood } from "./components/UnderTheHood";
import type { Theme } from "./hooks/useTheme";
import { gutterDrag } from "./lib/drag";
import { walkNodes } from "./lib/tree";

interface Selection {
  node: TreeNode | null;
  series: Series | null;
  edge: Edge | null;
}
const EMPTY: Selection = { node: null, series: null, edge: null };

type DashboardMode = "server" | "web";

/** A series the active playground step wants surfaced (web only). Structurally
 *  matches the playground's StepFocus, kept local so this shared file does not
 *  depend on the web-only demo code. */
interface Focus {
  path: string;
  data_type: string;
  name: string;
}

interface Props {
  mode: DashboardMode;
  version: string;
  tree: TreeNode[];
  edges: Edge[];
  theme: Theme;
  // Web playground integration (all optional; the server shell passes none).
  focus?: Focus | null;
  view?: "tree" | "map" | "plot" | null; // mobile: tab the active step prefers
  mapHandle?: Ref<MapHandle>;
  mobile?: boolean; // stacked tabbed layout for narrow screens
}

/** Empty-state card. Copy depends on the mode (web has a playground to nudge to). */
function EmptyCard({ mode }: { mode: DashboardMode }) {
  return (
    <div className="es-card">
      <svg className="es-glyph" width="40" height="40" viewBox="0 0 40 40" aria-hidden>
        <path className="es-glyph-link" d="M13 20h7v-9h7M20 20v9h7" />
        <circle className="es-glyph-dot" cx="9" cy="20" r="4" />
        <circle className="es-glyph-dot" cx="31" cy="11" r="4" />
        <circle className="es-glyph-dot" cx="31" cy="29" r="4" />
      </svg>
      <div className="es-title">No assets yet</div>
      {mode === "web" ? (
        <>
          <div className="es-text">Run the steps on the left to build a demo portfolio.</div>
          <div className="es-cue">← start with step 1</div>
        </>
      ) : (
        <div className="es-text">Write to energydb (run the notebook) and the tree fills in here.</div>
      )}
    </div>
  );
}

/** First node-owned series with data (for the auto-show on first write). */
function firstDataSeries(tree: TreeNode[]): { node: TreeNode; series: Series } | null {
  for (const n of walkNodes(tree)) {
    const s = n.series.find((x) => x.has_data);
    if (s) return { node: n, series: s };
  }
  return null;
}

/** Any node- or edge-owned series carrying data (drives the auto-show re-arm). */
function hasAnyData(tree: TreeNode[], edges: Edge[]): boolean {
  if (firstDataSeries(tree)) return true;
  return edges.some((e) => e.series.some((s) => s.has_data));
}

/** Find a series by id across node + edge series, to check it still has data. */
function findSeriesById(tree: TreeNode[], edges: Edge[], id: number): Series | null {
  for (const n of walkNodes(tree)) {
    const s = n.series.find((x) => x.series_id === id);
    if (s) return s;
  }
  for (const e of edges) {
    const s = e.series.find((x) => x.series_id === id);
    if (s) return s;
  }
  return null;
}

export function Dashboard({ mode, version, tree, edges, theme, focus, view, mapHandle, mobile }: Props) {
  const [sel, setSel] = useState<Selection>(EMPTY);
  const [tab, setTab] = useState<"tree" | "map" | "plot">("tree");

  const selectNode = (node: TreeNode) => setSel({ ...EMPTY, node });
  const selectSeries = (node: TreeNode, series: Series) => setSel({ ...EMPTY, node, series });
  const selectEdge = (edge: Edge) => setSel({ ...EMPTY, edge });
  const selectEdgeSeries = (edge: Edge, series: Series) => setSel({ ...EMPTY, edge, series });

  // Drag the gutter between the tree and the right side.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [treeWidth, setTreeWidth] = useState<number | null>(null);
  const startTreeDrag = (e: ReactMouseEvent) => {
    const body = bodyRef.current;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    gutterDrag(e, "x", (ev) =>
      setTreeWidth(Math.max(280, Math.min(rect.width - 360, ev.clientX - rect.left))),
    );
  };

  // First time the tree has content: honour a ?node=/?series= deep-link if present
  // (server: shareable links), else default-select the root. An empty tree (initial,
  // or after a Reset) re-arms this so the root is re-selected once rebuilt.
  const initRef = useRef(false);
  useEffect(() => {
    if (tree.length === 0) {
      initRef.current = false;
      return;
    }
    if (initRef.current) return;
    initRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const wantNode = params.get("node");
    const wantSeries = params.get("series");
    if (wantNode || wantSeries) {
      const id = Number(wantSeries);
      for (const n of walkNodes(tree)) {
        if (wantNode && n.path === wantNode) return setSel({ ...EMPTY, node: n });
        const s = n.series.find((x) => x.series_id === id);
        if (wantSeries && s) return setSel({ ...EMPTY, node: n, series: s });
      }
      return;
    }
    setSel({ ...EMPTY, node: tree[0] });
  }, [tree]);

  // The plot auto-surfaces whenever data exists, unless the user closed it (×);
  // dismissal resets once all data is gone, so re-running re-shows it.
  const dismissedRef = useRef(false);

  // A step (web) can ask the dashboard to highlight a specific series.
  useEffect(() => {
    if (!focus) return;
    for (const n of walkNodes(tree)) {
      if (n.path === focus.path) {
        const s = n.series.find((x) => x.data_type === focus.data_type && x.name === focus.name);
        if (s) setSel({ ...EMPTY, node: n, series: s });
        return;
      }
    }
  }, [focus, tree]);

  // Keep the selection + plot honest as the tree changes (running, Back, or Reset):
  //  - drop a selection whose node/edge is gone,
  //  - hide the plot when the selected series no longer carries data,
  //  - surface the first data series whenever data exists and nothing is shown.
  useEffect(() => {
    const anyData = hasAnyData(tree, edges);
    if (!anyData) dismissedRef.current = false; // reset dismissal when data is gone
    setSel((s) => {
      const found = new Set<string>();
      for (const n of walkNodes(tree)) found.add(n.uuid);
      let next = s;
      if (next.node && !found.has(next.node.uuid)) next = EMPTY;
      if (next.edge && !edges.some((e) => e.uuid === next.edge!.uuid)) next = { ...next, edge: null };
      if (next.series) {
        const cur = findSeriesById(tree, edges, next.series.series_id);
        if (!cur || !cur.has_data) next = { ...next, series: null };
      }
      if (anyData && !next.series && !dismissedRef.current) {
        const hit = firstDataSeries(tree);
        if (hit) next = { node: hit.node, series: hit.series, edge: null };
      }
      return next;
    });
  }, [tree, edges]);

  // Mobile only: when a series is selected jump to the Plot tab; when it clears,
  // fall back to the Tree tab.
  useEffect(() => {
    if (sel.series) setTab("plot");
    else setTab((t) => (t === "plot" ? "tree" : t));
  }, [sel.series]);

  // Mobile only: when the active step prefers a view, switch to that tab.
  useEffect(() => {
    if (view) setTab(view);
  }, [view]);

  const treeEl = (
    <TreeView
      tree={tree}
      edges={edges}
      selectedNode={sel.node?.uuid ?? null}
      selectedSeries={sel.series?.series_id ?? null}
      selectedEdge={sel.edge?.uuid ?? null}
      onSelectNode={selectNode}
      onSelectSeries={selectSeries}
      onSelectEdge={selectEdge}
      onSelectEdgeSeries={selectEdgeSeries}
      onDeselect={() => setSel(EMPTY)}
      style={!mobile && treeWidth != null ? { flex: `0 0 ${treeWidth}px`, minWidth: 0 } : undefined}
      emptyHint={<EmptyCard mode={mode} />}
      fitFloor={mobile ? 0.18 : undefined}
    />
  );

  // Map of all assets, highlighting the given selection. `selected` falls back to
  // the root node (web) so the map is framed even before anything is clicked.
  const mapEl = (selected: { kind: "node" | "edge"; id: string } | null) => (
    <MapPanel
      ref={mapHandle}
      tree={tree}
      edges={edges}
      selected={selected}
      onSelectNode={selectNode}
      onSelectEdge={selectEdge}
      theme={theme}
    />
  );
  const seriesEl = sel.series ? (
    <SeriesPanel node={sel.node} edge={sel.edge} series={sel.series} version={version} theme={theme} />
  ) : null;

  // Map highlight: the selected node/edge, else the root so the map is framed
  // before anything is clicked. Used by the web + mobile layouts (server frames
  // its map per detail-column selection instead).
  const mapSelected = sel.node
    ? ({ kind: "node", id: sel.node.uuid } as const)
    : sel.edge
      ? ({ kind: "edge", id: sel.edge.uuid } as const)
      : tree[0]
        ? ({ kind: "node", id: tree[0].uuid } as const)
        : null;

  // Mobile (web only): tabbed tree / map / plot.
  if (mobile) {
    return (
      <div className="m-dashboard">
        <div className="m-tabs">
          <button className="m-tab" data-active={tab === "tree"} onClick={() => setTab("tree")}>
            Tree
          </button>
          <button className="m-tab" data-active={tab === "map"} onClick={() => setTab("map")}>
            Map
          </button>
          <button className="m-tab" data-active={tab === "plot"} disabled={!sel.series} onClick={() => setTab("plot")}>
            Plot
          </button>
        </div>
        <div className="m-tabpanel">
          {tab === "tree" && treeEl}
          {tab === "map" && mapEl(mapSelected)}
          {tab === "plot" && seriesEl}
        </div>
      </div>
    );
  }

  // Server (local DB tool): classic detail column + full-height series panel, and
  // the bottom Under-the-hood dock with the SQL + raw backing rows.
  if (mode === "server") {
    return (
      <>
        <div className="body" ref={bodyRef}>
          {treeEl}
          <div className="gutter-v" onMouseDown={startTreeDrag} title="Drag to resize" />
          {sel.series ? (
            seriesEl
          ) : sel.node ? (
            <div className="detail-col">
              <NodePanel node={sel.node} version={version} onSelectSeries={selectSeries} />
              {mapEl({ kind: "node", id: sel.node.uuid })}
            </div>
          ) : sel.edge ? (
            <div className="detail-col">
              <EdgePanel edge={sel.edge} />
              {mapEl({ kind: "edge", id: sel.edge.uuid })}
            </div>
          ) : (
            <div className="panel panel-detail">
              <div className="panel-head">
                <span className="overline">Detail</span>
              </div>
              <div className="panel-body">
                <div className="empty-hint">
                  Click a node for its Postgres metadata + map,
                  <br />
                  a grid edge for its route, or a series badge for its values.
                </div>
              </div>
            </div>
          )}
        </div>
        <UnderTheHood node={sel.node} series={sel.series} edge={sel.edge} version={version} />
      </>
    );
  }

  // Web (demo): polished map + floating plot, no detail panel, no dock.
  return (
    <div className="body" ref={bodyRef}>
      {treeEl}
      <div className="gutter-v" onMouseDown={startTreeDrag} title="Drag to resize" />
      <div className="web-right">
        {sel.series && (
          <div className="web-series">
            {seriesEl}
            <button
              className="web-series-close"
              title="Hide the timeseries"
              onClick={() => {
                dismissedRef.current = true;
                setSel((s) => ({ node: s.node, edge: s.edge, series: null }));
              }}
            >
              ×
            </button>
          </div>
        )}
        <div className="web-map">
          {mapEl(mapSelected)}
          {tree.length === 0 && (
            <div className="web-map-hint">Your assets and their locations will appear here on the map.</div>
          )}
        </div>
      </div>
    </div>
  );
}
