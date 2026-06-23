import type { ReactNode } from "react";

// Tidy an ISO-ish timestamp ("2026-01-01T00:00:00.000" -> "2026-01-01 00:00:00");
// any other string passes through unchanged.
function prettyTs(s: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.replace("T", " ").replace(/\.\d+/, "") : s;
}

/** A raw cell value as JSX: null -> ∅, object -> pretty-printed JSON block, timestamps tidied. */
export function formatCell(v: unknown): ReactNode {
  if (v === null || v === undefined) return <span style={{ color: "var(--text-dim)" }}>∅</span>;
  if (typeof v === "object") return <pre>{JSON.stringify(v, null, 2)}</pre>;
  return prettyTs(String(v));
}

/** A raw cell value as a single-line string (for dense tables). */
export function formatCellText(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return prettyTs(String(v));
}
