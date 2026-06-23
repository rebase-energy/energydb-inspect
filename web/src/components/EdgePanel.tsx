import type { Edge } from "../api/client";
import { formatCell } from "../lib/format";

interface Props {
  edge: Edge;
}

/** Metadata for a grid edge, drawn straight from the /api/edges row. */
export function EdgePanel({ edge }: Props) {
  const rows: [string, unknown][] = [
    ["edge_type", edge.edge_type],
    ["name", edge.name],
    ["from", edge.from_path],
    ["to", edge.to_path],
    ...Object.entries(edge.data ?? {}),
  ];

  return (
    <div className="panel panel-detail">
      <div className="panel-head">
        <span className="overline">Edge</span>
        <span className="title">{edge.name ?? edge.edge_type}</span>
        <span className="muted">{edge.edge_type}</span>
      </div>
      <div className="panel-body">
        <div className="meta">
          <div className="section-label">Postgres row · energydb.edge</div>
          {rows.map(([k, v]) => (
            <div className="kv" key={k}>
              <span className="k">{k}</span>
              <span className="v">{formatCell(v)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
