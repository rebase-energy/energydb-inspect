import { type MouseEvent as ReactMouseEvent, useMemo, useRef, useState } from "react";
import { setApi } from "../../api/client";
import { Logo } from "../../components/Logo";
import { type MapHandle, type MapView } from "../../components/MapPanel";
import { useTheme } from "../../hooks/useTheme";
import { gutterDrag } from "../../lib/drag";
import { MockClient } from "../mock/client";
import { makeMockApi } from "../mock/api";
import { MockStore } from "../mock/store";
import { Playground } from "../playground/Playground";
import { RunBar } from "../playground/RunBar";
import { Dashboard } from "../../Dashboard";
import { useIsMobile } from "./useIsMobile";
import { type CameraAdapter, usePlayground } from "./usePlayground";
import { useWasmInspector } from "./useWasmInspector";

// Web-only demo: no server and no in-browser database. One in-memory MockStore
// backs both the story playground (mutates it) and the dashboard (reads it via
// the mock `api`). One app shell, one top bar; the story is a column of floating
// cards on the left, the tree + map fill the right, a hairline between them.
export default function WebApp() {
  const { theme, toggle } = useTheme();
  const store = useMemo(() => new MockStore(), []);
  // Point the dashboard's api at the store before the inspector hook reads it.
  useMemo(() => setApi(makeMockApi(store)), [store]);
  const client = useMemo(() => new MockClient(store), [store]);

  const insp = useWasmInspector(true);
  // Map camera handle, so Back can restore the framing it had before a step ran.
  const mapHandle = useRef<MapHandle>(null);
  const camera = useMemo<CameraAdapter>(
    () => ({
      capture: () => mapHandle.current?.saveView() ?? null,
      restore: (v) => mapHandle.current?.restoreView(v as MapView | null),
    }),
    [],
  );
  const pg = usePlayground(client, store, insp.refresh, camera);
  const isMobile = useIsMobile();

  // Drag the hairline to resize the story column. null → even three-way split.
  const [pgWidth, setPgWidth] = useState<number | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const startDrag = (e: ReactMouseEvent) => {
    gutterDrag(e, "x", (ev) => {
      const left = layoutRef.current?.getBoundingClientRect().left ?? 0;
      setPgWidth(Math.max(340, Math.min(860, ev.clientX - left)));
    });
  };

  const c = insp.counts;

  return (
    <div className={`app${isMobile ? " app-mobile" : ""}`}>
      <header className="header">
        <div className="brand">
          <Logo theme={theme} />
          <span className="brand-word">
            <b>rebase</b>
            <span className="dot">.</span>
            <span className="energy">energy</span>
          </span>
        </div>
        {!isMobile && <span className="brand-title">EnergyDB Inspector</span>}
        {!isMobile && (
          <a
            className="own-data"
            href="https://github.com/rebase-energy/energydb"
            target="_blank"
            rel="noreferrer"
            title="Open energydb on GitHub"
          >
            <span className="own-data-label">Run on your own energydb instance:</span>
            <code className="own-data-cmd">docker run -p 8000:8000 -p 2718:2718 ghcr.io/rebase-energy/energydb-inspector</code>
          </a>
        )}
        <div className="header-spacer" />
        {!isMobile && (
          <span className="summary">
            <b>{c.nodes}</b> nodes · <b>{c.edges}</b> edges · <b>{c.series}</b> series · <b>{c.values}</b> values
          </span>
        )}
        <button className="btn subtle icon" onClick={toggle} title="Toggle light / dark">
          {theme === "dark" ? "☾" : "☀"}
        </button>
      </header>

      {isMobile ? (
        <div className="m-body">
          <div className="m-story">
            <Playground ctrl={pg} mobile />
          </div>
          <div className="m-dash">
            <Dashboard
              mobile
              mode="web"
              version={insp.version}
              tree={insp.tree}
              edges={insp.edges}
              theme={theme}
              focus={pg.activeFocus}
              view={pg.activeView}
              mapHandle={mapHandle}
            />
          </div>
          <RunBar ctrl={pg} />
        </div>
      ) : (
        <div className="app-body" ref={layoutRef}>
          <div className="story-col" style={pgWidth != null ? { flex: `0 0 ${pgWidth}px` } : undefined}>
            <Playground ctrl={pg} />
          </div>
          <div className="gutter-hair" onMouseDown={startDrag} title="Drag to resize" />
          <div className="dash-col">
            <Dashboard
              mode="web"
              version={insp.version}
              tree={insp.tree}
              edges={insp.edges}
              theme={theme}
              focus={pg.activeFocus}
              mapHandle={mapHandle}
            />
          </div>
        </div>
      )}
    </div>
  );
}
