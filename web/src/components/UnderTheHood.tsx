import { type MouseEvent as ReactMouseEvent, useEffect, useState } from "react";
import { api, type Edge, type RawTable, type Series, type TreeNode } from "../api/client";
import { DataTable } from "./Table";
import { gutterDrag } from "../lib/drag";

interface Props {
  node: TreeNode | null;
  series: Series | null;
  edge: Edge | null;
  version: string;
}

/** A single contextual view of the raw backing rows for whatever is selected:
 *  a series → its ClickHouse rows; an edge → the Postgres edge table; otherwise
 *  a node → its Postgres row. */
export function UnderTheHood({ node, series, edge, version }: Props) {
  const [open, setOpen] = useState(true);
  const [height, setHeight] = useState(210);
  const [data, setData] = useState<RawTable | null>(null);

  // Drag the top gutter to resize the panel's height (up = taller).
  const startDrag = (e: ReactMouseEvent) => {
    const startY = e.clientY;
    const startH = height;
    gutterDrag(e, "y", (ev) =>
      setHeight(Math.max(90, Math.min(window.innerHeight - 280, startH + (startY - ev.clientY)))),
    );
  };

  const label = series
    ? "ClickHouse · series_values"
    : edge
      ? "Postgres · energydb.edge"
      : node
        ? "Postgres · energydb.node"
        : null;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      try {
        let d: RawTable | null = null;
        if (series) d = await api.rawCh(series.series_id);
        else if (edge) d = await api.edgeRow(edge.from_path, edge.to_path);
        else if (node) d = await api.node(node.path);
        if (alive) setData(d);
      } catch {
        if (alive) setData(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [series?.series_id, edge?.uuid, node?.path, version, open]);

  return (
    <div className={`hood${open ? "" : " collapsed"}`}>
      <div className="gutter-h" onMouseDown={startDrag} title="Drag to resize" />
      <div className="hood-head">
        <span className="overline">Under the hood</span>
        {label && <span className="muted">{label}</span>}
        <div style={{ flex: 1 }} />
        <button className="btn icon subtle" onClick={() => setOpen((v) => !v)} title={open ? "Collapse" : "Expand"}>
          {open ? "▾" : "▴"}
        </button>
      </div>
      <div className="hood-body" style={{ height }}>
        {!node && !series && !edge ? (
          <div className="empty-hint">Select a node, edge, or series to see its raw rows.</div>
        ) : (
          <>
            {data?.sql && <div className="sql">{data.sql}</div>}
            <div className="hood-scroll">
              <DataTable columns={data?.columns ?? []} rows={data?.rows ?? []} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
