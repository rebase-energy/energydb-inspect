// Renders a structured step result: a small multi-line chart (one line per
// asset/path) + a compact table. Axis-less and legend-as-chips so it reads at a
// glance inside a story card.
import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { useECharts } from "../../hooks/useECharts";
import type { StepResult } from "../demo/steps";

const PALETTE = ["#0d9373", "#2563eb", "#d97706", "#9333ea", "#0891b2", "#db2777", "#65a30d"];

function MiniChart({ chart }: { chart: NonNullable<StepResult["chart"]> }) {
  const option = useMemo<EChartsOption>(
    () => ({
      animationDuration: 320,
      color: PALETTE,
      grid: { left: 6, right: 8, top: 6, bottom: 6, containLabel: true },
      tooltip: { trigger: "axis", confine: true },
      xAxis: {
        type: "time",
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        scale: true,
        name: chart.unit,
        nameTextStyle: { color: "#9a9a96", fontSize: 9 },
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      series: chart.series.map((s) => ({
        name: s.name,
        type: "line",
        showSymbol: false,
        smooth: 0.2,
        lineStyle: { width: 1.6 },
        data: s.data,
      })),
    }),
    [chart],
  );
  const ref = useECharts(option);
  return <div className="result-chart" ref={ref} />;
}

export function Result({ result }: { result: StepResult }) {
  const { chart, table, text } = result;
  return (
    <div className="result">
      {chart && chart.series.length > 0 && (
        <>
          <MiniChart chart={chart} />
          <div className="result-legend">
            {chart.series.map((s, i) => (
              <span key={s.name} className="result-legend-item">
                <i style={{ background: PALETTE[i % PALETTE.length] }} />
                {s.name}
              </span>
            ))}
          </div>
        </>
      )}
      {table && (
        <table className="result-table">
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{String(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {table && table.rowCount > table.rows.length && (
        <div className="result-more">… {table.rowCount} rows in total</div>
      )}
      {text && <div className="result-text">{text}</div>}
    </div>
  );
}
