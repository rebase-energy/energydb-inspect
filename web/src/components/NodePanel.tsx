import { useEffect, useState } from "react";
import { api, type RawTable, type Series, type TreeNode } from "../api/client";
import { formatCell } from "../lib/format";

interface Props {
  node: TreeNode;
  version: string;
  onSelectSeries: (n: TreeNode, s: Series) => void;
}

export function NodePanel({ node, version, onSelectSeries }: Props) {
  const [row, setRow] = useState<RawTable | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await api.node(node.path);
        if (alive) setRow(r);
      } catch {
        if (alive) setRow(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [node.path, version]);

  const cols = row?.columns ?? [];
  const values = row?.rows[0] ?? [];

  return (
    <div className="panel panel-detail">
      <div className="panel-head">
        <span className="overline">Node</span>
        <span className="title">{node.name}</span>
        <span className="muted">{node.node_type}</span>
      </div>
      <div className="panel-body">
        <div className="meta">
          {node.series.length > 0 && (
            <>
              <div className="section-label">Series</div>
              <div className="series-chips">
                {node.series.map((s) => (
                  <button
                    key={s.series_id}
                    className="series-chip"
                    data-has={s.has_data}
                    onClick={() => onSelectSeries(node, s)}
                  >
                    <span className="dot" />
                    {s.name} · {s.data_type} · {s.canonical_unit}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="section-label">Postgres row · energydb.node</div>
          {cols.map((c, i) => (
            <div className="kv" key={c}>
              <span className="k">{c}</span>
              <span className="v">{formatCell(values[i])}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
