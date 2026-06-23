import { formatCellText } from "../lib/format";

export function DataTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  if (columns.length === 0) {
    return <div className="empty-hint">No rows.</div>;
  }
  return (
    <table className="data">
      <thead>
        <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((v, j) => <td key={j}>{formatCellText(v)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
