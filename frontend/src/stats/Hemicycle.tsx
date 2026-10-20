import { useCallback, useMemo, useRef } from 'react';
import type { EChartsType } from 'echarts/core';
import EChart, { ChartDataTable, type ChartSize } from '../components/EChart';
import { escapeHtml, tooltipBase, tooltipTitle, type ChartTheme } from '../lib/chartTheme';
import { getGroupColor, getGroupName, getGroupSeats } from '../lib/groups';
import { assignSeats, hemicycleLayout, orderGroupsForHemicycle } from '../lib/statsCharts';
import { GROUP_CODES, POLITICAL_GROUPS } from '../data/politicalGroups';
import type { Stats } from '../types';
import { ChartCard, ChartEmpty, nf } from './common';
// Also shown on the landing page, before the Statistics view (which imports these styles) loads.
import '../stats.css';

export default function Hemicycle({ stats, theme }: { stats: Stats | null; theme: ChartTheme }) {
  const groups = useMemo(() => {
    const codes = new Set([...GROUP_CODES, ...Object.keys(stats?.groups ?? {})]);
    return orderGroupsForHemicycle([...codes].map(code => ({ code, seats: getGroupSeats(code, stats) })));
  }, [stats]);
  const total = groups.reduce((a, g) => a + g.seats, 0);
  const majority = Math.floor(total / 2) + 1;
  const layout = useMemo(() => hemicycleLayout(total), [total]);
  const seats = useMemo(() => assignSeats(layout, groups), [layout, groups]);
  const shortName = (code: string) => POLITICAL_GROUPS[code]?.short ?? code;
  const fullName = (code: string) => stats?.groups?.[code]?.name || getGroupName(code);

  // Hover is handled per group, not per dot: the highlight and tooltip change only when the
  // pointer reaches a different group, so the gaps between dots of one group don't flicker.
  const activeGroupRef = useRef<number | null>(null);
  const dotSizeRef = useRef(0);
  const groupCountRef = useRef(groups.length);
  groupCountRef.current = groups.length;

  const handleChartReady = useCallback((chart: EChartsType) => {
    const setActiveGroup = (index: number | null) => {
      activeGroupRef.current = index;
      const dot = dotSizeRef.current;
      chart.setOption({
        series: Array.from({ length: groupCountRef.current }, (_, i) => ({
          itemStyle: { opacity: index === null || i === index ? 1 : 0.25 },
          symbolSize: i === index ? dot * 1.15 : dot,
        })),
      });
    };
    chart.on('mouseover', params => {
      if (params.componentType !== 'series' || params.seriesIndex === undefined) return;
      if (params.seriesIndex === activeGroupRef.current) return;
      setActiveGroup(params.seriesIndex);
      chart.dispatchAction({ type: 'showTip', seriesIndex: params.seriesIndex, dataIndex: params.dataIndex });
    });
    // Leaving the chart clears the selection. ECharts' own 'globalout' is not always fired,
    // so the container's mouseleave is the reliable signal.
    const clear = () => {
      if (activeGroupRef.current === null) return;
      setActiveGroup(null);
      chart.dispatchAction({ type: 'hideTip' });
    };
    const container = chart.getDom();
    chart.on('globalout', clear);
    container.addEventListener('mouseleave', clear);
    return () => {
      chart.off('mouseover');
      chart.off('globalout');
      container.removeEventListener('mouseleave', clear);
    };
  }, []);

  const option = useMemo(() => (size: ChartSize) => {
    const pad = layout.dotRadius;
    const scale = Math.max(10, Math.min((size.width - 8) / (2 * (1 + pad)), (size.height - 8) / (1 + 2 * pad)));
    const gridWidth = 2 * (1 + pad) * scale;
    const gridHeight = (1 + 2 * pad) * scale;
    const dot = Math.max(3, 2 * layout.dotRadius * scale);
    // A new option redraws every group unhighlighted.
    dotSizeRef.current = dot;
    activeGroupRef.current = null;
    return {
      grid: {
        left: (size.width - gridWidth) / 2, top: (size.height - gridHeight) / 2,
        width: gridWidth, height: gridHeight,
      },
      xAxis: { type: 'value', min: -1 - pad, max: 1 + pad, show: false },
      yAxis: { type: 'value', min: -pad, max: 1 + pad, show: false },
      tooltip: {
        ...tooltipBase(theme),
        trigger: 'item',
        // Shown and hidden by handleChartReady, never by the pointer leaving a single dot.
        triggerOn: 'none',
        formatter: (params: { seriesName: string }) => {
          const code = params.seriesName;
          const count = groups.find(g => g.code === code)?.seats ?? 0;
          return tooltipTitle(shortName(code), theme)
            + `<div style="color:${theme.textMuted};max-width:240px;white-space:normal">${escapeHtml(fullName(code))}</div>`
            + `<div style="margin-top:4px"><strong style="color:${theme.textPrimary}">${count} sièges</strong>`
            + `<span style="color:${theme.textMuted}"> · ${nf(count / total * 100, 1)} %</span></div>`;
        },
      },
      series: groups.map(group => ({
        name: group.code,
        type: 'scatter',
        symbol: 'circle',
        symbolSize: dot,
        itemStyle: { color: getGroupColor(group.code, stats), borderColor: theme.surface, borderWidth: dot > 8 ? 1 : 0 },
        cursor: 'pointer',
        emphasis: { disabled: true },
        data: seats.filter(seat => seat.group === group.code).map(seat => [seat.x, seat.y]),
        animationDelay: (index: number) => index * 2,
      })),
    };
  }, [groups, layout, seats, stats, theme, total]);

  if (!total) {
    return (
      <ChartCard id="stats-hemicycle" title="Composition du Sénat">
        <ChartEmpty>Composition des groupes indisponible.</ChartEmpty>
      </ChartCard>
    );
  }

  const label = `Hémicycle de ${total} sièges, de gauche à droite : `
    + groups.map(g => `${shortName(g.code)} ${g.seats}`).join(', ') + `. Majorité absolue : ${majority} sièges.`;

  return (
    <ChartCard
      id="stats-hemicycle"
      title="Composition du Sénat"
      aside="Sénateurs en exercice"
      caption="Un point par sénateur en exercice, groupes rangés de gauche à droite selon leur positionnement politique. Effectifs en direct depuis la base."
    >
      <div className="hemicycle-wrap">
        <EChart option={option} label={label} className="hemicycle-chart" onReady={handleChartReady} />
        <div className="hemicycle-center" aria-hidden="true">
          <strong>{total}</strong>
        </div>
      </div>
      <p className="hemicycle-majority">{total} sièges · majorité absolue {majority}</p>
      <ul className="hemicycle-legend" aria-label="Sièges par groupe, de gauche à droite">
        {groups.map(group => (
          <li key={group.code} title={fullName(group.code)}>
            <span className="stats-legend-key stats-legend-key--dot" style={{ background: getGroupColor(group.code, stats) }} aria-hidden="true" />
            <span className="hemicycle-legend-code">{shortName(group.code)}</span>
            <span className="hemicycle-legend-seats">{group.seats}</span>
          </li>
        ))}
      </ul>
      <ChartDataTable
        caption="Sièges par groupe"
        columns={['Groupe', 'Nom', 'Sièges', 'Part']}
        rows={groups.map(group => [shortName(group.code), fullName(group.code), group.seats, `${nf(group.seats / total * 100, 1)} %`])}
      />
    </ChartCard>
  );
}
