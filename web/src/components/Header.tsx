import type { Counts } from "../api/client";
import type { Theme } from "../hooks/useTheme";
import { Logo } from "./Logo";

interface Props {
  counts: Counts;
  // Writable (demo / local dev): show Reset + the "point at your own DB" hint.
  // Read-only (connect mode, inspecting a real energydb): hide both, show a badge.
  writable: boolean;
  autoRefresh: boolean;
  onToggleAuto: () => void;
  onRefresh: () => void;
  onReset: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export function Header({
  counts,
  writable,
  autoRefresh,
  onToggleAuto,
  onRefresh,
  onReset,
  theme,
  onToggleTheme,
}: Props) {
  return (
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
      {writable ? (
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
  );
}
