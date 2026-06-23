import { useEffect, useMemo, useState } from "react";
import type { EChartsOption, LineSeriesOption } from "echarts";
import { api, type Edge, type Series, type SeriesValues, type TreeNode } from "../api/client";
import { useECharts } from "../hooks/useECharts";
import type { Theme } from "../hooks/useTheme";
import { DataTable } from "./Table";

interface Props {
  node: TreeNode | null;
  edge?: Edge | null;
  series: Series;
  version: string;
  theme: Theme;
}

const toMs = (s: unknown) => new Date(String(s) + "Z").getTime();
const ktLabel = (kt: string) => kt.slice(5, 16).replace("T", " ");

/** y-range [min, max] from a series' values: bottom near 0 so the low forecast
 * revisions (which dip below the actual) stay visible; `topPad` is the headroom
 * above the peak (the forecast view passes more, so its top legend doesn't sit
 * over the lines). The actual + forecast views share the same actual data, so
 * both compute the same range → the plot doesn't jump on the switch. */
function valueRange(sv: SeriesValues | null, topPad = 0.18): { min: number; max: number } | null {
  if (!sv || sv.rows.length === 0) return null;
  const ci = sv.columns.indexOf("value");
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of sv.rows) {
    const v = Number(r[ci]);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi > lo)) return null;
  const span = hi - lo;
  return { min: Math.max(0, lo - span * 0.36), max: hi + span * topPad };
}

function palette(theme: Theme) {
  // `multi` colours the forecast revisions: deliberately distinct hues (not all
  // green) so successive knowledge_times are easy to tell apart against the
  // green "latest" line and the dark "actual" truth line.
  return theme === "dark"
    ? { text: "#9a9a96", axis: "#3a3a38", line: "#03c497", split: "#2c2c2c", actual: "#e8e7e2", multi: ["#5aa9ff", "#c08bff", "#ffb454", "#ff6e9c", "#43d9b0", "#9be36b"] }
    : { text: "#6b6b67", axis: "#d6d5d0", line: "#0d9373", split: "#eceae4", actual: "#282828", multi: ["#2563eb", "#9333ea", "#d97706", "#db2777", "#0891b2", "#65a30d"] };
}

export function SeriesPanel({ node, edge, series, version, theme }: Props) {
  const [tab, setTab] = useState<"plot" | "table">("plot");
  const [latest, setLatest] = useState<SeriesValues | null>(null);
  const [overlap, setOverlap] = useState<SeriesValues | null>(null);
  const [actual, setActual] = useState<SeriesValues | null>(null);

  const isForecast = series.timeseries_type === "OVERLAPPING";

  // The sibling ACTUAL series of the same name (the "truth" the revisions chase).
  const actualSeries = useMemo(
    () =>
      node?.series.find(
        (s) =>
          s.series_id !== series.series_id &&
          s.name === series.name &&
          s.timeseries_type !== "OVERLAPPING" &&
          s.has_data,
      ) ?? null,
    [node, series.series_id, series.name],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const lt = await api.values(series.series_id, "latest");
        if (alive) setLatest(lt);
      } catch {
        /* ignore */
      }
      if (series.timeseries_type === "OVERLAPPING") {
        try {
          const ov = await api.values(series.series_id, "overlapping");
          if (alive) setOverlap(ov);
        } catch {
          /* ignore */
        }
      } else if (alive) {
        setOverlap(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [series.series_id, series.timeseries_type, version]);

  // Pull the actual series' values to overlay as a reference in "All revisions".
  useEffect(() => {
    let alive = true;
    if (!actualSeries) {
      setActual(null);
      return;
    }
    void (async () => {
      try {
        const a = await api.values(actualSeries.series_id, "latest");
        if (alive) setActual(a);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, [actualSeries, version]);

  // Always the "latest" view (revisions ghosted behind the stitched latest +
  // actual). The Latest / All-revisions toggle was removed.
  const showAll = false;
  const active = latest;

  const option = useMemo<EChartsOption>(() => {
    const pal = palette(theme);
    const chartSeries: LineSeriesOption[] = [];
    const toLine = (sv: SeriesValues): number[][] => {
      const ci = (c: string) => sv.columns.indexOf(c);
      return sv.rows.map((r) => [toMs(r[ci("valid_time")]), Number(r[ci("value")])]);
    };

    if (isForecast) {
      // Each forecast revision (one line per knowledge_time). Full opacity in
      // "All revisions"; ghosted in "Latest" so the actual + latest stand out.
      if (overlap) {
        const ci = (c: string) => overlap.columns.indexOf(c);
        const groups = new Map<string, [number, number][]>();
        for (const r of overlap.rows) {
          const kt = String(r[ci("knowledge_time")]);
          const pt: [number, number] = [toMs(r[ci("valid_time")]), Number(r[ci("value")])];
          (groups.get(kt) ?? groups.set(kt, []).get(kt)!).push(pt);
        }
        [...groups.entries()].forEach(([kt, data], i) => {
          const color = pal.multi[i % pal.multi.length];
          const op = showAll ? 1 : 0.28;
          chartSeries.push({
            name: ktLabel(kt),
            type: "line",
            showSymbol: false,
            smooth: 0.15,
            data: data.sort((a, b) => a[0] - b[0]),
            lineStyle: { width: showAll ? 1.8 : 1.4, color, opacity: op },
            itemStyle: { color, opacity: op },
            z: 2,
          });
        });
      }
      // "Latest" view: the stitched latest-per-valid_time forecast, prominent.
      if (!showAll && latest) {
        chartSeries.push({
          name: "latest",
          type: "line",
          showSymbol: false,
          smooth: 0.15,
          data: toLine(latest),
          lineStyle: { width: 2.4, color: pal.line },
          itemStyle: { color: pal.line },
          z: 4,
        });
      }
      // The actual (truth), always visible, drawn on top.
      if (actual) {
        chartSeries.push({
          name: "actual",
          type: "line",
          showSymbol: false,
          smooth: 0.15,
          data: toLine(actual),
          lineStyle: { width: 2.6, color: pal.actual },
          itemStyle: { color: pal.actual },
          z: 5,
        });
      }
    } else if (latest) {
      chartSeries.push({
        name: series.name,
        type: "line",
        showSymbol: false,
        smooth: 0.15,
        data: toLine(latest),
        lineStyle: { width: 2.2, color: pal.line },
        itemStyle: { color: pal.line },
        areaStyle: { color: pal.line, opacity: 0.08 },
      });
    }

    // Frame the y-axis to the actual (truth) line, which is shared by the
    // actual-only and forecast views → identical range, no jump on the switch.
    // The forecast view gets extra top headroom so its top legend clears the lines.
    const range = valueRange(isForecast ? actual : latest, isForecast ? 1.0 : 0.18);

    return {
      animationDuration: 300,
      color: pal.multi,
      grid: { left: 54, right: 18, top: isForecast ? 42 : 14, bottom: 54 },
      tooltip: { trigger: "axis", confine: true },
      // Only "actual" (+ "latest" in Latest view) in the legend — the per-revision
      // knowledge_time lines would crowd it (6+ entries); they still draw + show
      // their knowledge_time on hover.
      legend: isForecast
        ? {
            top: 4,
            data: showAll ? ["actual"] : ["actual", "latest"],
            textStyle: { color: pal.text, fontSize: 11 },
          }
        : undefined,
      dataZoom: [
        { type: "inside", throttle: 60 },
        {
          type: "slider",
          height: 16,
          bottom: 8,
          borderColor: "transparent",
          backgroundColor: pal.split,
          fillerColor: theme === "dark" ? "rgba(3,196,151,0.16)" : "rgba(13,147,115,0.14)",
          handleStyle: { color: pal.line, borderColor: pal.line },
          moveHandleStyle: { color: pal.line },
          dataBackground: { lineStyle: { color: pal.axis }, areaStyle: { color: pal.split } },
          selectedDataBackground: { lineStyle: { color: pal.line }, areaStyle: { color: pal.line, opacity: 0.18 } },
          textStyle: { color: pal.text, fontSize: 9 },
        },
      ],
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: pal.axis } },
        axisLabel: { color: pal.text, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: series.canonical_unit,
        nameTextStyle: { color: pal.text },
        scale: !range,
        min: range?.min,
        max: range?.max,
        axisLabel: { color: pal.text, formatter: (v: number) => String(parseFloat(Number(v).toFixed(2))) },
        splitLine: { lineStyle: { color: pal.split } },
      },
      series: chartSeries,
    };
  }, [latest, overlap, actual, showAll, isForecast, theme, series.name, series.canonical_unit]);

  const chartRef = useECharts(option);

  return (
    <div className="panel panel-detail">
      <div className="panel-head">
        <span className="overline">Series</span>
        <span className="title">
          {node?.name ?? edge?.name ?? edge?.edge_type} · {series.name}
        </span>
        <span className="muted">{series.data_type}</span>
        <div style={{ flex: 1 }} />
        <div className="tabs">
          <button className="tab" data-active={tab === "plot"} onClick={() => setTab("plot")}>
            Plot
          </button>
          <button className="tab" data-active={tab === "table"} onClick={() => setTab("table")}>
            Table
          </button>
        </div>
      </div>

      <div className="meta-row">
        <span>unit <span className="k">{series.canonical_unit}</span></span>
        <span>type <span className="k">{series.timeseries_type}</span></span>
        <span>retention <span className="k">{series.retention}</span></span>
        <span>points <span className="k">{active?.stats.count ?? 0}</span></span>
      </div>

      <div className="panel-body">
        <div className="chart" ref={chartRef} />
        {tab === "table" && (
          <div className="table-wrap">
            <DataTable columns={active?.columns ?? []} rows={active?.rows ?? []} />
          </div>
        )}
      </div>
    </div>
  );
}
