import { useMemo } from 'react';
import EChart, { ChartDataTable, type ChartSize } from '../components/EChart';
import { tooltipBase, tooltipRow, tooltipTitle, type ChartTheme } from '../lib/chartTheme';
import { formatMonth, monthlyActivity } from '../lib/statsCharts';
import type { Scrutin } from '../types';
import { ChartCard, ChartEmpty, LegendItem, axisStyle, nf, valueAxisStyle } from './common';

export default function ActivityChart({ scrutins, sessionLabel, theme }: {
  scrutins: Scrutin[];
  sessionLabel: string;
  theme: ChartTheme;
}) {
  const data = useMemo(() => monthlyActivity(scrutins), [scrutins]);
  const totals = useMemo(() => data.months.map((_, i) => data.adopted[i] + data.rejected[i]), [data]);
  const totalVotes = totals.reduce((a, n) => a + n, 0);
  const peak = totals.reduce((best, n, i) => (n > totals[best] ? i : best), 0);
  const adoptedTotal = data.adopted.reduce((a, n) => a + n, 0);

  const option = useMemo(() => (size: ChartSize) => {
    const months = data.months;
    const dense = months.length > 36;
    const slot = (size.width - 60) / Math.max(1, months.length);
    // Year ticks on long ranges (thinned on narrow screens), month names on a single session.
    const yearStep = slot * 12 < 34 ? 4 : slot * 12 < 60 ? 2 : 1;
    const radius = Math.min(4, Math.max(1, slot / 4));
    const gap = slot >= 6 ? { borderColor: theme.surface, borderWidth: 1 } : {};
    return {
      grid: { left: 40, right: 12, top: 16, bottom: 28 },
      tooltip: {
        ...tooltipBase(theme),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.05)' } },
        formatter: (params: Array<{ dataIndex: number }>) => {
          const i = params[0]?.dataIndex ?? 0;
          return tooltipTitle(formatMonth(months[i]), theme)
            + tooltipRow(theme.textSecondary, nf(totals[i]), totals[i] > 1 ? 'scrutins' : 'scrutin', theme)
            + tooltipRow(theme.adopted, nf(data.adopted[i]), 'adoptés', theme)
            + tooltipRow(theme.rejected, nf(data.rejected[i]), 'rejetés', theme);
        },
      },
      xAxis: {
        type: 'category',
        data: months,
        ...axisStyle(theme),
        axisLabel: {
          ...axisStyle(theme).axisLabel,
          hideOverlap: false,
          interval: dense
            ? (_index: number, value: string) => value.endsWith('-01') && parseInt(value) % yearStep === 0
            : 0,
          formatter: (value: string) => (dense
            ? value.slice(0, 4)
            : `${formatMonth(value, 'short').replace('.', '')}${value.endsWith('-01') || value === months[0] ? `\n${value.slice(0, 4)}` : ''}`),
        },
      },
      yAxis: { type: 'value', minInterval: 1, splitNumber: 4, ...valueAxisStyle(theme) },
      series: [
        {
          name: 'Adoptés', type: 'bar', stack: 'votes', barMaxWidth: 24, barCategoryGap: dense ? '20%' : '35%',
          itemStyle: { color: theme.adopted, ...gap },
          data: data.adopted.map((value, i) => ({
            value,
            itemStyle: { borderRadius: data.rejected[i] === 0 ? [radius, radius, 0, 0] : 0 },
          })),
          emphasis: { disabled: true },
        },
        {
          name: 'Rejetés', type: 'bar', stack: 'votes', barMaxWidth: 24,
          itemStyle: { color: theme.rejected, borderRadius: [radius, radius, 0, 0], ...gap },
          data: data.rejected,
          emphasis: { disabled: true },
        },
      ],
    };
  }, [data, theme, totals]);

  const label = totalVotes
    ? `Histogramme mensuel des scrutins publics, ${sessionLabel.toLowerCase()} : ${nf(totalVotes)} scrutins de ${formatMonth(data.months[0])} à ${formatMonth(data.months[data.months.length - 1])}, dont ${nf(adoptedTotal)} adoptés ; le mois le plus chargé est ${formatMonth(data.months[peak])} avec ${totals[peak]} scrutins.`
    : 'Aucun scrutin pour cette sélection.';

  return (
    <ChartCard
      id="stats-activity"
      wide
      title="Activité : scrutins publics par mois"
      aside={sessionLabel}
      caption={totalVotes ? `Mois le plus chargé : ${formatMonth(data.months[peak])} (${totals[peak]} scrutins). Les mois sans scrutin public (été, suspensions) restent à zéro.` : undefined}
    >
      {totalVotes ? (
        <>
          <ul className="stats-legend" aria-label="Légende">
            <LegendItem color={theme.adopted} label="Adoptés" value={nf(adoptedTotal)} />
            <LegendItem color={theme.rejected} label="Rejetés" value={nf(totalVotes - adoptedTotal)} />
          </ul>
          <EChart option={option} height={260} label={label} />
          <ChartDataTable
            caption="Scrutins publics par mois"
            columns={['Mois', 'Adoptés', 'Rejetés', 'Total']}
            rows={data.months.flatMap((month, i) => (totals[i]
              ? [[formatMonth(month), data.adopted[i], data.rejected[i], totals[i]]]
              : []))}
          />
        </>
      ) : (
        <ChartEmpty>Aucun scrutin daté pour cette sélection.</ChartEmpty>
      )}
    </ChartCard>
  );
}
