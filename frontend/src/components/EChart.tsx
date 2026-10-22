import { useEffect, useRef, useState, type ReactNode } from 'react';
import { use as registerECharts, init, type EChartsType } from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, MarkAreaComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { prefersReducedMotion } from '../lib/motion';

// Modular ECharts: only the series, components and renderer the Statistics page uses.
// SVG renderer: crisp at any pixel ratio, cheap at these sizes (≤ 500 marks) and it also
// works in jsdom, where canvas is not implemented.
registerECharts([BarChart, HeatmapChart, LineChart, ScatterChart,
  GridComponent, MarkAreaComponent, TooltipComponent, VisualMapComponent, SVGRenderer]);

export interface ChartSize {
  width: number;
  height: number;
}

interface EChartProps {
  // A function of the rendered size for charts whose geometry depends on it (hemicycle).
  option: EChartsCoreOption | ((size: ChartSize) => EChartsCoreOption);
  height?: number | string; // omitted: sized by CSS (e.g. aspect-ratio)
  // Short text alternative: the canvas/SVG itself is hidden from assistive technology.
  label: string;
  className?: string;
  // Called once with the chart instance after it is created, e.g. to attach event handlers.
  // May return a cleanup function, run when the chart is disposed.
  onReady?: (chart: EChartsType) => void | (() => void);
}

export default function EChart({ option, height, label, className, onReady }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const [size, setSize] = useState<ChartSize>({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const onReadyRef = useRef(onReady);
  const readyCleanupRef = useRef<(() => void) | void>(undefined);

  // Track the container size; hidden views (display: none) report 0 and are skipped.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => setSize(previous => {
      const next = { width: Math.round(element.clientWidth), height: Math.round(element.clientHeight) };
      return previous.width === next.width && previous.height === next.height ? previous : next;
    });
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    readyCleanupRef.current?.();
    chartRef.current?.dispose();
    chartRef.current = null;
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || size.width === 0 || size.height === 0 || failed) return;
    try {
      let chart = chartRef.current;
      if (!chart) {
        chart = init(element, null, { renderer: 'svg', width: size.width, height: size.height });
        chartRef.current = chart;
        readyCleanupRef.current = onReadyRef.current?.(chart);
      } else {
        chart.resize({ width: size.width, height: size.height, animation: { duration: 0 } });
      }
      const resolved = typeof option === 'function' ? option(size) : option;
      const animate = !prefersReducedMotion();
      chart.setOption({
        animation: animate,
        animationDuration: animate ? 450 : 0,
        animationDurationUpdate: animate ? 300 : 0,
        ...resolved,
      }, { notMerge: true, lazyUpdate: true });
    } catch {
      setFailed(true);
    }
  }, [option, size, failed]);

  return (
    <div
      ref={containerRef}
      className={`echart${className ? ` ${className}` : ''}`}
      style={{ height }}
      role="img"
      aria-label={label}
    >
      {failed && <p className="echart-fallback">Graphique indisponible dans ce navigateur : consultez le tableau des données.</p>}
    </div>
  );
}

// Text alternative shared by every chart: the same numbers as an HTML table, collapsed by default.
export function ChartDataTable({ caption, columns, rows }: {
  caption: string;
  columns: string[];
  rows: Array<Array<ReactNode>>;
}) {
  if (!rows.length) return null;
  return (
    <details className="chart-data">
      <summary>Voir les données</summary>
      <div className="chart-data-scroll">
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (cellIndex === 0
                  ? <th key={cellIndex} scope="row">{cell}</th>
                  : <td key={cellIndex}>{cell}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
