import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Edge, TreeNode } from "../api/client";
import type { Theme } from "../hooks/useTheme";
import { walkNodes } from "../lib/tree";

interface MapSelection {
  kind: "node" | "edge";
  id: string;
}

/** A saved camera position, so Back can return the map to where it was. */
export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}
export interface MapHandle {
  saveView: () => MapView | null;
  restoreView: (v: MapView | null) => void;
}

interface Props {
  tree: TreeNode[];
  edges: Edge[];
  selected: MapSelection | null;
  onSelectNode: (n: TreeNode) => void;
  onSelectEdge: (e: Edge) => void;
  theme: Theme;
}

interface Geom {
  type: string;
  coordinates: unknown;
}

interface Feat {
  id: string;
  kind: "node" | "edge";
  name: string;
  sub: string;
  geom: Geom;
  obj: TreeNode | Edge;
}

const TILES = {
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const ATTR = '&copy; <a href="https://openstreetmap.org">OSM</a> &copy; <a href="https://carto.com">CARTO</a>';

function asGeom(data: Record<string, unknown> | undefined): Geom | null {
  const g = data?.geometry as Geom | undefined;
  return g && g.type && g.coordinates ? { type: g.type, coordinates: g.coordinates } : null;
}

/** A rough representative point [lon, lat] for a stored geometry. */
function repPoint(g: Geom): [number, number] | null {
  if (g.type === "Point") return g.coordinates as [number, number];
  if (g.type === "Polygon") {
    const ring = (g.coordinates as number[][][])[0];
    const n = ring.length;
    const [sx, sy] = ring.reduce(([x, y], [px, py]) => [x + px, y + py], [0, 0]);
    return [sx / n, sy / n];
  }
  if (g.type === "LineString") {
    const c = g.coordinates as number[][];
    return c[Math.floor(c.length / 2)] as [number, number];
  }
  return null;
}

function buildFeatures(tree: TreeNode[], edges: Edge[]): Feat[] {
  const nodes = [...walkNodes(tree)];
  const feats: Feat[] = [];
  const repByUuid = new Map<string, [number, number]>();

  for (const n of nodes) {
    const g = asGeom(n.data);
    if (!g) continue;
    feats.push({ id: n.uuid, kind: "node", name: n.name, sub: n.node_type, geom: g, obj: n });
    const rp = repPoint(g);
    if (rp) repByUuid.set(n.uuid, rp);
  }

  for (const e of edges) {
    let g = asGeom(e.data);
    if (!g) {
      // Derive a line between the endpoints' representative points.
      const a = repByUuid.get(e.from_uuid);
      const b = repByUuid.get(e.to_uuid);
      if (a && b) g = { type: "LineString", coordinates: [a, b] };
    }
    if (!g) continue;
    feats.push({ id: e.uuid, kind: "edge", name: e.name ?? e.edge_type, sub: e.edge_type, geom: g, obj: e });
  }
  return feats;
}

function palette(theme: Theme) {
  return theme === "dark"
    ? { base: "#03c497", sel: "#7fe7cd", fill: "#03c497" }
    : { base: "#0d9373", sel: "#06503d", fill: "#0d9373" };
}

/** Minimal entrance for a freshly-added point marker: it grows + fades in.
 * Only markers animate — polygon/line fills are left at their resting style so
 * they can't flash fully-filled for a frame before settling. */
function animateIn(lyr: L.CircleMarker, target: L.CircleMarkerOptions) {
  const r = target.radius ?? 5;
  const op = target.opacity ?? 1;
  const fop = target.fillOpacity ?? 0;
  // Hide it synchronously so it can't flash at full size before the first frame.
  lyr.setRadius(0);
  lyr.setStyle({ opacity: 0, fillOpacity: 0 });
  const dur = 360;
  const start = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / dur);
    const e = 1 - (1 - p) ** 3; // ease-out cubic
    lyr.setRadius(r * e);
    lyr.setStyle({ opacity: op * e, fillOpacity: fop * e });
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Leaflet style for a feature given the current selection (selected pops, the
 * rest dim). Shared by the build pass and the in-place restyle on selection. */
function styleFor(
  id: string,
  kind: "node" | "edge",
  isPoint: boolean,
  selId: string | null,
  pal: ReturnType<typeof palette>,
): L.CircleMarkerOptions {
  const isSel = id === selId;
  const dim = selId !== null && !isSel;
  const color = isSel ? pal.sel : pal.base;
  if (kind === "edge") {
    return { color, weight: isSel ? 4 : 2.5, dashArray: "5 4", opacity: dim ? 0.45 : 0.95 } as L.CircleMarkerOptions;
  }
  return {
    color,
    weight: isSel ? (isPoint ? 2.5 : 3) : 1.5,
    fillColor: pal.fill,
    fillOpacity: isSel ? (isPoint ? 1 : 0.32) : isPoint ? 0.85 : 0.12,
    opacity: dim ? 0.5 : 1,
    radius: isPoint ? (isSel ? 7 : 5) : undefined,
  } as L.CircleMarkerOptions;
}

export const MapPanel = forwardRef<MapHandle, Props>(function MapPanel(
  { tree, edges, selected, onSelectNode, onSelectEdge, theme },
  ref,
) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const featLayerRef = useRef<L.GeoJSON | null>(null);
  const restoreUntilRef = useRef(0); // while now() < this, a redraw leaves the camera alone
  const prevIdsRef = useRef<Set<string>>(new Set()); // feature ids drawn last time (for pop-in)
  const layerByIdRef = useRef<Map<string, L.Layer>>(new Map());
  const featsRef = useRef<Feat[]>([]);
  const selIdRef = useRef<string | null>(selected?.id ?? null);
  selIdRef.current = selected?.id ?? null;

  // Latest callbacks, read from click handlers without re-binding the layer.
  const cb = useRef({ onSelectNode, onSelectEdge });
  cb.current = { onSelectNode, onSelectEdge };

  // Save / restore the camera so the playground's Back can return the map to the
  // framing it had before the undone step. restoreView also tells the next feature
  // redraw to leave the camera alone (so it does not snap back to fit-all).
  useImperativeHandle(ref, () => ({
    saveView: () => {
      const map = mapRef.current;
      if (!map) return null;
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
    },
    restoreView: (v) => {
      const map = mapRef.current;
      if (!map || !v) return;
      restoreUntilRef.current = Date.now() + 700; // outlast the redraw that follows
      map.flyTo([v.lat, v.lng], v.zoom, { duration: 0.5 });
    },
  }));

  // Create the map once.
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    // Canvas renderer with a few px of click tolerance → the thin cable line and
    // small markers are easy to click.
    const map = L.map(elRef.current, {
      zoomControl: true,
      attributionControl: true,
      renderer: L.canvas({ tolerance: 6 }),
    }).setView([55.781, 12.913], 12);
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(elRef.current);
    requestAnimationFrame(() => map.invalidateSize());
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      featLayerRef.current = null;
    };
  }, []);

  // Swap the basemap when the theme changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) tileRef.current.remove();
    tileRef.current = L.tileLayer(TILES[theme], { attribution: ATTR, subdomains: "abcd", maxZoom: 19 }).addTo(map);
    tileRef.current.bringToBack();
  }, [theme]);

  // All map features (memoized once). The layer is rebuilt only when the feature
  // SET (ids + geometry kind) or the theme changes — NOT on selection, so clicking
  // / auto-selecting restyles in place instead of tearing down + re-flying.
  const feats = useMemo(() => buildFeatures(tree, edges), [tree, edges]);
  const featSetSig = useMemo(() => feats.map((f) => `${f.id}:${f.geom.type}`).join("|"), [feats]);

  // Move the camera to the selection (or fit all). Skipped during a Back restore.
  const positionCamera = (selId: string | null) => {
    const map = mapRef.current;
    if (!map || Date.now() < restoreUntilRef.current) return;
    const selLayer = selId ? layerByIdRef.current.get(selId) : null;
    if (selLayer) {
      if (selLayer instanceof L.CircleMarker) map.flyTo(selLayer.getLatLng(), 13, { duration: 0.6 });
      else map.flyToBounds((selLayer as L.Polygon).getBounds(), { padding: [44, 44], maxZoom: 14, duration: 0.6 });
      if ("bringToFront" in selLayer) (selLayer as L.Path).bringToFront();
    } else {
      const layer = featLayerRef.current;
      if (!layer) return;
      const b = layer.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 12 });
    }
  };

  // Restyle every feature in place for the given selection (no teardown).
  const restyle = (selId: string | null) => {
    const pal = palette(theme);
    for (const f of featsRef.current) {
      const lyr = layerByIdRef.current.get(f.id);
      if (!lyr) continue;
      const isPoint = f.geom.type === "Point";
      const st = styleFor(f.id, f.kind, isPoint, selId, pal);
      (lyr as L.Path).setStyle(st);
      if (lyr instanceof L.CircleMarker) lyr.setRadius(st.radius ?? 5);
    }
  };

  // Build the feature layer when the set or theme changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    featsRef.current = feats;
    const pal = palette(theme);
    const selId = selIdRef.current;

    if (featLayerRef.current) {
      featLayerRef.current.remove();
      featLayerRef.current = null;
    }
    const layerById = new Map<string, L.Layer>();
    layerByIdRef.current = layerById;
    if (feats.length === 0) {
      prevIdsRef.current = new Set();
      return;
    }

    const collection = {
      type: "FeatureCollection" as const,
      features: feats.map((f) => ({
        type: "Feature" as const,
        geometry: f.geom as never,
        properties: { id: f.id, kind: f.kind, name: f.name, sub: f.sub },
      })),
    };
    const layer = L.geoJSON(collection as never, {
      style: (feature) => {
        const p = feature?.properties as { id: string; kind: "node" | "edge" };
        return styleFor(p.id, p.kind, false, selId, pal);
      },
      pointToLayer: (feature, latlng) => {
        const p = feature.properties as { id: string; kind: "node" | "edge" };
        return L.circleMarker(latlng, styleFor(p.id, p.kind, true, selId, pal));
      },
      onEachFeature: (feature, lyr) => {
        const p = feature.properties as { id: string; kind: "node" | "edge"; name: string; sub: string };
        layerById.set(p.id, lyr);
        lyr.bindTooltip(`${p.name} · ${p.sub}`, { sticky: true, direction: "top", opacity: 0.95 });
        lyr.on("click", () => {
          const f = feats.find((x) => x.id === p.id);
          if (!f) return;
          if (f.kind === "node") cb.current.onSelectNode(f.obj as TreeNode);
          else cb.current.onSelectEdge(f.obj as Edge);
        });
      },
    }).addTo(map);
    featLayerRef.current = layer;

    const ids = feats.map((f) => f.id);
    const fresh = new Set(ids.filter((id) => !prevIdsRef.current.has(id)));
    prevIdsRef.current = new Set(ids);
    if (Date.now() < restoreUntilRef.current) return;

    for (const f of feats) {
      if (!fresh.has(f.id)) continue;
      const lyr = layerById.get(f.id);
      if (lyr instanceof L.CircleMarker) animateIn(lyr, styleFor(f.id, f.kind, true, selId, pal));
    }
    positionCamera(selId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featSetSig, theme]);

  // Restyle + recentre on selection change — no rebuild, so no flash / jump.
  useEffect(() => {
    if (!featLayerRef.current) return;
    const selId = selected?.id ?? null;
    restyle(selId);
    positionCamera(selId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const count = feats.length;

  return (
    <div className="map-panel">
      <div className="map-head">
        <span className="overline">Map</span>
        <span className="muted">{count} geometries</span>
      </div>
      <div className="map-canvas" ref={elRef} />
    </div>
  );
});
