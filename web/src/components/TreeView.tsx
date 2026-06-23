import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { select, zoom, type ZoomBehavior, zoomIdentity, zoomTransform } from "d3";
import type { Edge, Series, TreeNode } from "../api/client";
import { BOX_W, edgePath, layoutTree, linkPath, nodeHeight } from "../lib/d3tree";

interface Props {
  tree: TreeNode[];
  edges: Edge[];
  selectedNode: string | null;
  selectedSeries: number | null;
  selectedEdge: string | null;
  onSelectNode: (n: TreeNode) => void;
  onSelectSeries: (n: TreeNode, s: Series) => void;
  onSelectEdge: (e: Edge) => void;
  onSelectEdgeSeries: (e: Edge, s: Series) => void;
  onDeselect: () => void;
  style?: CSSProperties;
  emptyHint: ReactNode;
  fitFloor?: number; // smallest auto-fit scale; lower on mobile so the whole tree fits
}

export function TreeView({
  tree,
  edges,
  selectedNode,
  selectedSeries,
  selectedEdge,
  onSelectNode,
  onSelectSeries,
  onSelectEdge,
  onSelectEdgeSeries,
  onDeselect,
  style,
  emptyHint,
  fitFloor = 0.56,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const firstFitRef = useRef(false); // first auto-fit is instant; later fits animate
  const layout = useMemo(() => layoutTree(tree), [tree]);

  // Apply the zoom/pan transform straight to the DOM <g> (not React state) so a
  // pan, wheel-zoom, or auto-fit animates at 60fps without re-rendering the whole
  // tree every frame — the foreignObject node cards are expensive to reconcile.
  useEffect(() => {
    if (!svgRef.current) return;
    const sel = select(svgRef.current);
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 1.8]) // allow zooming out far enough to fit the tree on a phone
      .on("zoom", (e) => {
        gRef.current?.setAttribute("transform", e.transform.toString());
      });
    zoomRef.current = z;
    sel.call(z).call(z.transform, zoomIdentity.translate(20, 20));
    return () => {
      sel.on(".zoom", null);
    };
  }, []);

  // Auto-fit the viewport so the whole tree stays in focus. Keyed on a structural
  // signature (set of node uuids + series counts), sorted so it is order-independent:
  // adding/removing a node re-fits, but a pure move (same nodes, new parent) does
  // not re-pan the camera — so the relocating node visibly travels instead.
  const fitSig = useMemo(
    () =>
      layout.nodes
        .map((n) => `${n.node.uuid}:${n.node.series.length}`)
        .sort()
        .join("|"),
    [layout],
  );
  // Frame the whole tree. `animate` glides (used for structural changes); resize /
  // first-show snaps instantly so the tree is never left half-fit.
  const fitView = useCallback(
    (animate: boolean) => {
      const svg = svgRef.current;
      const z = zoomRef.current;
      if (!svg || !z || layout.nodes.length === 0) return;
      const W = svg.clientWidth || svg.getBoundingClientRect().width;
      const H = svg.clientHeight || svg.getBoundingClientRect().height;
      if (!W || !H) return;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const { node, x, y } of layout.nodes) {
        const h = nodeHeight(node);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + BOX_W);
        minY = Math.min(minY, y - h / 2);
        maxY = Math.max(maxY, y + h / 2);
      }
      if (edges.length) maxX += 60; // room for the dashed edge + its label

      const pad = 48;
      const bw = Math.max(maxX - minX, 1);
      const bh = Math.max(maxY - minY, 1);
      const scale = Math.max(fitFloor, Math.min(1.25, Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh)));
      // Centre the tree while it fits; once it is wider/taller than the pane, anchor
      // it to the top-left padding instead, so the portfolio root never gets clipped.
      const sw = scale * bw;
      const sh = scale * bh;
      const tx = sw > W - 2 * pad ? pad - scale * minX : (W - sw) / 2 - scale * minX;
      const ty = sh > H - 2 * pad ? pad - scale * minY : (H - sh) / 2 - scale * minY;
      const t = zoomIdentity.translate(tx, ty).scale(scale);
      const glide = animate && firstFitRef.current;
      firstFitRef.current = true;
      if (glide) select(svg).transition().duration(700).call(z.transform, t);
      else select(svg).call(z.transform, t);
    },
    [layout, edges, fitFloor],
  );

  // useLayoutEffect: fit before paint on structural changes (no flash / snap).
  useLayoutEffect(() => {
    fitView(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSig]);

  // Refit when the pane resizes — e.g. switching to the Tree tab on mobile or
  // resizing the window — so the whole tree is always framed.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(() => fitView(false));
    ro.observe(svg);
    return () => ro.disconnect();
  }, [fitView]);

  // Track which nodes we've already shown so freshly-added ones animate in, and a
  // per-series data fingerprint (max change_time) so a badge pulses when its
  // series first gains data or gets re-written.
  const seen = useRef<Set<string>>(new Set());
  const seenSeries = useRef<Map<number, number>>(new Map());
  const mounted = useRef(false);
  const pulsing = (s: Series) =>
    mounted.current && s.last_change > 0 && seenSeries.current.get(s.series_id) !== s.last_change;
  useEffect(() => {
    layout.nodes.forEach((n) => {
      seen.current.add(n.node.uuid);
      n.node.series.forEach((s) => seenSeries.current.set(s.series_id, s.last_change));
    });
    edges.forEach((e) => e.series.forEach((s) => seenSeries.current.set(s.series_id, s.last_change)));
    mounted.current = true;
  });

  // Spotlight a relocating node: when a node keeps its uuid but its path changes
  // (a move_to), flag it for ~1s so its card lifts and the rest of the tree dims
  // while it slides to the new parent — reads clearly as a move, not a rebuild.
  const prevPaths = useRef<Map<string, string>>(new Map());
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [moving, setMoving] = useState<Set<string>>(new Set());
  useEffect(() => {
    const moved = new Set<string>();
    const present = new Set<string>();
    for (const { node } of layout.nodes) {
      present.add(node.uuid);
      const prev = prevPaths.current.get(node.uuid);
      if (prev !== undefined && prev !== node.path) moved.add(node.uuid);
      prevPaths.current.set(node.uuid, node.path);
    }
    for (const k of [...prevPaths.current.keys()]) if (!present.has(k)) prevPaths.current.delete(k);
    // Leave the spotlight running across the move's own mid-step refreshes (note /
    // status edits); only a fresh move resets the timer, the timeout clears it.
    if (moved.size === 0) return;
    setMoving(moved);
    if (moveTimer.current) clearTimeout(moveTimer.current);
    moveTimer.current = setTimeout(() => setMoving(new Set()), 1000);
  }, [layout]);

  // Click on empty canvas → deselect. Guard against pans: only treat it as a
  // click if the pointer barely moved between mousedown and mouseup.
  const downPt = useRef<{ x: number; y: number } | null>(null);

  // Clicking an item in the tree pans + zooms the tree a bit toward it (never
  // zooming out, keeps at least a modest scale and centres it).
  const zoomToWorld = (cx: number, cy: number) => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z) return;
    const W = svg.clientWidth || svg.getBoundingClientRect().width;
    const H = svg.clientHeight || svg.getBoundingClientRect().height;
    if (!W || !H) return;
    const scale = Math.min(1.6, Math.max(zoomTransform(svg).k, 1.2));
    const t = zoomIdentity.translate(W / 2 - scale * cx, H / 2 - scale * cy).scale(scale);
    select(svg).transition().duration(450).call(z.transform, t);
  };
  const zoomToNode = (uuid: string) => {
    const p = layout.pos.get(uuid);
    if (p) zoomToWorld(p.x + BOX_W / 2, p.y);
  };
  const zoomToEdge = (e: Edge) => {
    const f = layout.pos.get(e.from_uuid);
    const t = layout.pos.get(e.to_uuid);
    if (f && t) zoomToWorld((f.x + t.x) / 2 + BOX_W / 2, (f.y + t.y) / 2);
  };

  return (
    <div className="panel panel-tree" style={style}>
      <div className="panel-head">
        <span className="overline">Structure</span>
        <span className="title">Asset hierarchy</span>
      </div>
      <div className="panel-body">
        {tree.length === 0 && <div className="empty-hint">{emptyHint}</div>}
        <svg
          ref={svgRef}
          className={`tree-svg${moving.size ? " has-move" : ""}`}
          onMouseDown={(e) => {
            downPt.current = { x: e.clientX, y: e.clientY };
          }}
          onClick={(e) => {
            const d = downPt.current;
            downPt.current = null;
            if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) onDeselect();
          }}
        >
          <g ref={gRef}>
            {layout.links.map((l, i) => (
              <path key={`link-${i}`} className="tree-link" d={linkPath(l.sx, l.sy, l.tx, l.ty)} />
            ))}
            {edges.map((e) => {
              const f = layout.pos.get(e.from_uuid);
              const t = layout.pos.get(e.to_uuid);
              if (!f || !t) return null;
              const sx = f.x + BOX_W;
              const tx = t.x + BOX_W;
              const d = edgePath(sx, f.y, tx, t.y);
              const lx = Math.max(sx, tx) + 22;
              const ly = (f.y + t.y) / 2;
              const cardH = e.series.length > 0 ? 30 + e.series.length * 24 : 26;
              return (
                <g key={e.uuid} className="tree-edge-g">
                  <path
                    className="tree-edge-hit"
                    d={d}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onSelectEdge(e);
                      zoomToEdge(e);
                    }}
                  />
                  <path className="tree-edge" data-selected={selectedEdge === e.uuid} d={d} />
                  <foreignObject x={lx} y={ly - cardH / 2} width={170} height={cardH + 4}>
                    <div
                      className="edge-card"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onSelectEdge(e);
                        zoomToEdge(e);
                      }}
                    >
                      <span className="edge-label" data-selected={selectedEdge === e.uuid}>
                        {e.name ?? e.edge_type}
                      </span>
                      {e.series.length > 0 && (
                        <div className="badges">
                          {e.series.map((s) => (
                            <button
                              key={s.series_id}
                              className="badge"
                              data-has={s.has_data}
                              data-pulse={pulsing(s)}
                              data-forecast={s.data_type === "forecast"}
                              data-selected={selectedSeries === s.series_id}
                              title={`${s.name} · ${s.data_type} · ${s.canonical_unit}`}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                onSelectEdgeSeries(e, s);
                                zoomToEdge(e);
                              }}
                            >
                              <span className="badge-mark" />
                              <span className="badge-name">{s.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
            {layout.nodes
              // paint a relocating node (and its spotlight) above its siblings
              .slice()
              .sort((a, b) => (moving.has(a.node.uuid) ? 1 : 0) - (moving.has(b.node.uuid) ? 1 : 0))
              .map(({ node, x, y }) => {
              const h = nodeHeight(node);
              const isNew = mounted.current && !seen.current.has(node.uuid);
              const isMoving = moving.has(node.uuid);
              const cls = `node-g${mounted.current ? " anim" : ""}${isNew ? " enter" : ""}${isMoving ? " moving" : ""}`;
              return (
                <g key={node.uuid} className={cls} transform={`translate(${x},${y - h / 2})`}>
                  <foreignObject x={0} y={0} width={BOX_W} height={h + 2}>
                    <div
                      className="node-card"
                      data-selected={selectedNode === node.uuid}
                      title={node.path}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onSelectNode(node);
                        zoomToNode(node.uuid);
                      }}
                    >
                      <div className="node-head">
                        <span className="node-name">{node.name}</span>
                        <span className="node-type">{node.node_type}</span>
                      </div>
                      {node.series.length > 0 && (
                        <div className="badges">
                          {node.series.map((s) => (
                            <button
                              key={s.series_id}
                              className="badge"
                              data-has={s.has_data}
                              data-pulse={pulsing(s)}
                              data-forecast={s.data_type === "forecast"}
                              data-selected={selectedSeries === s.series_id}
                              title={`${s.name} · ${s.data_type} · ${s.canonical_unit}`}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                onSelectSeries(node, s);
                                zoomToNode(node.uuid);
                              }}
                            >
                              <span className="badge-mark" />
                              <span className="badge-name">{s.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </g>
        </svg>
        {tree.length > 0 && (
          <div className="legend">
            <span>
              <i style={{ borderColor: "var(--border-strong)" }} />
              hierarchy
            </span>
            <span>
              <i style={{ borderColor: "var(--edge)", borderTopStyle: "dashed" }} />
              grid edge
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
