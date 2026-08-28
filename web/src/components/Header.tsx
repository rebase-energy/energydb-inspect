import type { ConnectionStatus, Counts } from "../api/client";
import type { Reachability } from "../hooks/useInspector";
import type { Theme } from "../hooks/useTheme";
import { Logo } from "./Logo";

interface Props {
  counts: Counts;
  // Writable (demo / local dev): show Reset + the "point at your own DB" hint.
  // Read-only (connect mode, inspecting a real energydb): hide both, show a badge.
  writable: boolean;
  // pg/ch reachability + targets + last errors, from state-version's payload.
  // Null before the first response arrives.
  connection: ConnectionStatus | null;
  // Whether the /api/* backend itself is answering at all (distinct from
  // `connection`, which is about the database behind it).
  reachability: Reachability;
  autoRefresh: boolean;
  onToggleAuto: () => void;
  onRefresh: () => void;
  onReset: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

// "host/db" -> "host", for the CH chip (which only ever shows the host).
function hostOnly(target: string | null): string {
  if (!target) return "?";
  return target.split("/")[0] || "?";
}

function ConnChip({ label, ok, text, error }: { label: string; ok: boolean; text: string; error: string | null }) {
  return (
    <span className={`conn-chip ${ok ? "ok" : "bad"}`} title={error ?? undefined}>
      {label} {ok ? "✓" : "✗"} {text}
    </span>
  );
}

function ConnectionStrip({ connection }: { connection: ConnectionStatus }) {
  return (
    <div className="conn-strip">
      <ConnChip label="PG" ok={connection.pg_ok} text={connection.pg_target ?? "?"} error={connection.pg_error} />
      <ConnChip label="CH" ok={connection.ch_ok} text={hostOnly(connection.ch_target)} error={connection.ch_error} />
      <span className="conn-chip schema">schema: {connection.schema}</span>
    </div>
  );
}

export function Header({
  counts,
  writable,
  connection,
  reachability,
  autoRefresh,
  onToggleAuto,
  onRefresh,
  onReset,
  theme,
  onToggleTheme,
}: Props) {
  const disconnected = reachability === "unreachable" || reachability === "unauthorized";

  return (
    <>
      <header className="header">
        <div className="brand">
          <Logo theme={theme} />
          <span className="brand-word">
            <b>rebase</b>
            <span className="dot">.</span>
            <span className="energy">energy</span>
          </span>
        </div>
        <span className="brand-title">EnergyDB Inspector</span>

        {writable && (
          <a
            className="own-data"
            href="https://github.com/rebase-energy/energydb-inspect"
            target="_blank"
            rel="noreferrer"
            title="energydb-inspect on GitHub"
          >
            <span className="own-data-label">Run it on your own energydb:</span>
            <code className="own-data-cmd">uvx energydb-inspect</code>
          </a>
        )}

        <div className="header-spacer" />

        {!disconnected && connection && <ConnectionStrip connection={connection} />}

        <span className="summary">
          <b>{counts.nodes}</b> nodes · <b>{counts.edges}</b> edges · <b>{counts.series}</b> series ·{" "}
          <b>{counts.values}</b> values
        </span>

        <button className="switch" onClick={onToggleAuto} title="Auto-refresh from the database">
          <span className="switch-track" data-on={autoRefresh}>
            <span className="switch-knob" />
          </span>
          auto
        </button>
        <button className="btn subtle icon" onClick={onRefresh} title="Refetch now">
          ⟳
        </button>
        {disconnected ? (
          <span className="ro-badge bad" title="The inspector backend is not answering">
            disconnected
          </span>
        ) : writable ? (
          <button className="btn danger" onClick={onReset} title="Wipe + recreate the schema (local only)">
            Reset DB
          </button>
        ) : (
          <span className="ro-badge" title="Connected read-only to your energydb">
            read-only
          </span>
        )}
        <button className="btn subtle icon" onClick={onToggleTheme} title="Toggle light / dark">
          {theme === "dark" ? "☾" : "☀"}
        </button>
      </header>

      {disconnected && (
        <div className="conn-banner">
          {reachability === "unauthorized"
            ? "Session expired or invalid. Reload the page to reconnect."
            : "Cannot reach the inspector backend. Retrying..."}
        </div>
      )}
      {!disconnected && connection && connection.schema_has_tables === false && (
        <div className="conn-banner hint">
          schema '{connection.schema}' has no energydb tables. Is your deployment on a different ENERGYDB_SCHEMA?
        </div>
      )}
    </>
  );
}
