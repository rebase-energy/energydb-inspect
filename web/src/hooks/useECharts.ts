import { useEffect, useRef } from "react";
import * as echarts from "echarts";

/**
 * Minimal React-19-safe ECharts binding: init once, setOption on change, resize
 * with the container, dispose on unmount. (echarts-for-react is avoided for R19.)
 */
export function useECharts(option: echarts.EChartsOption) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const chart = echarts.init(elRef.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return elRef;
}
