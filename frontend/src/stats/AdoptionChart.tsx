import { useMemo } from 'react';
import EChart, { ChartDataTable } from '../components/EChart';
import { tooltipBase, tooltipRow, tooltipTitle, type ChartTheme } from '../lib/chartTheme';
import { formatSessionRange } from '../lib/format';
import { adoptionBySession } from '../lib/statsCharts';
import type { Scrutin } from '../types';
import { ChartCard, ChartEmpty, axisStyle, nf, shortSession, valueAxisStyle } from './common';

// Two panels on one shared session axis (rate on top, volume below) rather than one chart with
// two y-scales: a dual axis would suggest a correlation that only comes from the scale choice.
export default function AdoptionChart({ scrutins, selectedSession, theme }: {
  scrutins: Scrutin[];
  selectedSession: string;
  theme: ChartTheme;
}) {
  const rows = useMemo(() => adoptionBySession(scrutins), [scrutins]);
  const selectedIndex = rows.findIndex(row => row.session === selectedSession);

  const option = useMemo(() => {
    const sessions = rows.map(row => row.session);
    const highlight = (i: number) => selectedIndex < 0 || i === selectedIndex;
    const labelIndex = selectedIndex >= 0 ? selectedIndex : rows.length - 1;
    const xAxis = (gridIndex: number, showLabels: boolean) => ({
      type: 'category' as const,
      gridIndex,
      data: sessions,
      ...axisStyle(theme),
      axisLabel: {
        ...axisStyle(theme).axisLabel,
        show: showLabels,
        formatter: (value: string) => shortSession(value),
        // The selected session's label is drawn in primary ink and bold.
        rich: { sel: { color: theme.textPrimary, fontWeight: 700, fontSize: 11 } },
      },
    });
    return {
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 44, right: 16, top: 34, height: '33%' },
        { left: 44, right: 16, bottom: 28, height: '33%' },
      ],
      tooltip: {
        ...tooltipBase(theme),
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: 'rgba(255,255,255,0.25)', width: 1 } },
        formatter: (params: Array<{ dataIndex: number }>) => {
          const row = rows[params[0]?.dataIndex ?? 0];
          return tooltipTitle(`Session ${formatSessionRange(row.session)}`, theme)
            + tooltipRow(theme.accent, `${nf(row.rate, 1)} %`, 'taux d’adoption', theme)
            + tooltipRow(theme.textSecondary, nf(row.total), 'scrutins', theme)
            + tooltipRow(theme.adopted, nf(row.adopted), 'adoptés', theme)
            + tooltipRow(theme.rejected, nf(row.rejected), 'rejetés', theme);
        },
      },
      xAxis: [
        { ...xAxis(0, false), axisLine: { show: false } },
        {
          ...xAxis(1, true),
          axisLabel: {
            ...xAxis(1, true).axisLabel,
            formatter: (value: string) => (value === selectedSession ? `{sel|${shortSession(value)}}` : shortSession(value)),
          },
        },
      ],
      yAxis: [
        {
          type: 'value', gridIndex: 0, min: 0, max: 100, interval: 50,
          name: 'Adoptés (%)', nameLocation: 'end', nameGap: 14,
          nameTextStyle: { color: theme.textSecondary, fontSize: 11, align: 'left', padding: [0, 0, 0, -36] },
          ...valueAxisStyle(theme),
          axisLabel: { ...valueAxisStyle(theme).axisLabel, formatter: (v: number) => `${v} %` },
        },
        {
          type: 'value', gridIndex: 1, splitNumber: 2, minInterval: 1,
          name: 'Scrutins publics', nameLocation: 'end', nameGap: 14,
          nameTextStyle: { color: theme.textSecondary, fontSize: 11, align: 'left', padding: [0, 0, 0, -36] },
          ...valueAxisStyle(theme),
        },
      ],
      series: [
        {
          name: 'Taux d’adoption', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
          lineStyle: { width: 2, color: theme.accent, cap: 'round', join: 'round' },
          itemStyle: { color: theme.accent },
          symbol: 'circle',
          data: rows.map((row, i) => ({
            value: row.rate,
            symbolSize: i === labelIndex ? 10 : 6,
            itemStyle: { color: theme.accent, borderColor: theme.surface, borderWidth: 2 },
            label: i === labelIndex
              ? { show: true, position: 'top', formatter: `${nf(row.rate, 1)} %`, color: theme.textPrimary, fontSize: 11, fontWeight: 700 }
              : { show: false },
          })),
          emphasis: { disabled: true },
        },
        {
          name: 'Scrutins', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 24,
          data: rows.map((row, i) => ({
            value: row.total,
            itemStyle: {
              color: highlight(i) ? theme.accent : theme.accentMuted,
              borderRadius: [4, 4, 0, 0],
            },
          })),
          emphasis: { disabled: true },
        },
      ],
    };
  }, [rows, selectedIndex, selectedSession, theme]);

  if (!rows.length) {
    return (
      <ChartCard id="stats-adoption" wide title="Adoption par session">
        <ChartEmpty>Aucun scrutin disponible.</ChartEmpty>
      </ChartCard>
    );
  }

  const selected = selectedIndex >= 0 ? rows[selectedIndex] : null;
  const best = rows.reduce((a, b) => (b.rate > a.rate ? b : a));
  const worst = rows.reduce((a, b) => (b.rate < a.rate ? b : a));
  const label = `Taux d’adoption et nombre de scrutins publics pour les ${rows.length} sessions, de ${formatSessionRange(rows[0].session)} à ${formatSessionRange(rows[rows.length - 1].session)}. `
    + `Taux le plus élevé : ${nf(best.rate, 1)} % en ${formatSessionRange(best.session)} ; le plus bas : ${nf(worst.rate, 1)} % en ${formatSessionRange(worst.session)}.`
    + (selected ? ` Session sélectionnée ${formatSessionRange(selected.session)} : ${nf(selected.rate, 1)} % sur ${selected.total} scrutins.` : '');

  return (
    <ChartCard
      id="stats-adoption"
      wide
      title="Adoption par session"
      aside={selected ? `Session ${formatSessionRange(selected.session)} en surbrillance` : 'Toutes les sessions'}
      caption={`Ce graphique couvre toujours les ${rows.length} sessions ; la session choisie dans l’en-tête est mise en évidence. Taux d’adoption = scrutins adoptés / scrutins publics de la session.`}
    >
      <EChart option={option} height={320} label={label} />
      <ChartDataTable
        caption="Adoption par session"
        columns={['Session', 'Scrutins', 'Adoptés', 'Rejetés', 'Taux d’adoption']}
        rows={rows.map(row => [formatSessionRange(row.session), row.total, row.adopted, row.rejected, `${nf(row.rate, 1)} %`])}
      />
    </ChartCard>
  );
}
