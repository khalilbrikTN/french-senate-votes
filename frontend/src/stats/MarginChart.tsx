import { useMemo } from 'react';
import EChart, { ChartDataTable } from '../components/EChart';
import { tooltipBase, tooltipRow, tooltipTitle, type ChartTheme } from '../lib/chartTheme';
import { formatSessionRange } from '../lib/format';
import { CLOSE_VOTE_MARGIN, closestVotes, marginHistogram } from '../lib/statsCharts';
import type { Scrutin } from '../types';
import { ChartCard, ChartEmpty, LegendItem, axisStyle, nf, valueAxisStyle } from './common';

export function MarginChart({ scrutins, sessionLabel, theme }: {
  scrutins: Scrutin[];
  sessionLabel: string;
  theme: ChartTheme;
}) {
  const histogram = useMemo(() => marginHistogram(scrutins), [scrutins]);
  const { bins, close, total, binSize } = histogram;
  const closeShare = total ? close / total * 100 : 0;

  const option = useMemo(() => {
    const labels = bins.map(bin => String(bin.from));
    return {
      grid: { left: 40, right: 12, top: 34, bottom: 44 },
      tooltip: {
        ...tooltipBase(theme),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.05)' } },
        formatter: (params: Array<{ dataIndex: number }>) => {
          const bin = bins[params[0]?.dataIndex ?? 0];
          return tooltipTitle(`Écart de ${bin.from} à ${bin.to - 1} voix`, theme)
            + tooltipRow(theme.textSecondary, nf(bin.adopted + bin.rejected), 'scrutins', theme)
            + tooltipRow(theme.adopted, nf(bin.adopted), 'adoptés', theme)
            + tooltipRow(theme.rejected, nf(bin.rejected), 'rejetés', theme);
        },
      },
      xAxis: {
        type: 'category', data: labels, ...axisStyle(theme),
        name: 'Écart |pour − contre| en voix', nameLocation: 'middle', nameGap: 28,
        nameTextStyle: { color: theme.textMuted, fontSize: 11 },
      },
      yAxis: { type: 'value', minInterval: 1, splitNumber: 4, ...valueAxisStyle(theme) },
      series: [
        {
          name: 'Adoptés', type: 'bar', stack: 'm', barCategoryGap: '20%', barMaxWidth: 24,
          itemStyle: { color: theme.adopted, borderColor: theme.surface, borderWidth: 1 },
          data: bins.map(bin => ({ value: bin.adopted, itemStyle: { borderRadius: bin.rejected ? 0 : [3, 3, 0, 0] } })),
          emphasis: { disabled: true },
          markArea: close ? {
            silent: true,
            itemStyle: { color: 'rgba(133,133,246,0.10)' },
            label: {
              show: true, position: 'insideTopLeft', distance: [6, -22],
              color: theme.textPrimary, fontSize: 11, fontWeight: 600,
              formatter: `< ${CLOSE_VOTE_MARGIN} voix : ${nf(close)} scrutin${close > 1 ? 's' : ''}`,
            },
            data: [[{ xAxis: labels[0] }, { xAxis: labels[Math.ceil(CLOSE_VOTE_MARGIN / binSize) - 1] }]],
          } : undefined,
        },
        {
          name: 'Rejetés', type: 'bar', stack: 'm', barMaxWidth: 24,
          itemStyle: { color: theme.rejected, borderRadius: [3, 3, 0, 0], borderColor: theme.surface, borderWidth: 1 },
          data: bins.map(bin => bin.rejected),
          emphasis: { disabled: true },
        },
      ],
    };
  }, [bins, binSize, close, theme]);

  const mode = bins.reduce((best, bin, i) => (bin.adopted + bin.rejected > bins[best].adopted + bins[best].rejected ? i : best), 0);
  const label = total
    ? `Histogramme des écarts de voix entre pour et contre, ${sessionLabel.toLowerCase()}, par tranches de ${binSize} voix : ${nf(close)} scrutins sur ${nf(total)} (${nf(closeShare, 1)} %) ont été décidés à moins de ${CLOSE_VOTE_MARGIN} voix ; la tranche la plus fréquente va de ${bins[mode].from} à ${bins[mode].to - 1} voix.`
    : '';

  return (
    <ChartCard
      id="stats-margins"
      wide
      title="Écarts de voix"
      aside={sessionLabel}
      caption={total ? `Écart = |pour − contre| (les abstentions ne comptent pas). Tranches de ${binSize} voix ; la zone éclairée regroupe les scrutins décidés à moins de ${CLOSE_VOTE_MARGIN} voix.` : undefined}
    >
      {total ? (
        <>
          <p className="stats-viz-kpi">
            <strong>{nf(close)}</strong> scrutin{close > 1 ? 's' : ''} sur {nf(total)} décidé{close > 1 ? 's' : ''} à moins de {CLOSE_VOTE_MARGIN} voix
            <span> ({nf(closeShare, 1)} %)</span>
          </p>
          <ul className="stats-legend" aria-label="Légende">
            <LegendItem color={theme.adopted} label="Adoptés" />
            <LegendItem color={theme.rejected} label="Rejetés" />
          </ul>
          <EChart option={option} height={250} label={label} />
          <ChartDataTable
            caption="Répartition des écarts de voix"
            columns={['Écart (voix)', 'Adoptés', 'Rejetés', 'Total']}
            rows={bins.filter(bin => bin.adopted + bin.rejected).map(bin => [`${bin.from}–${bin.to - 1}`, bin.adopted, bin.rejected, bin.adopted + bin.rejected])}
          />
        </>
      ) : (
        <ChartEmpty>Aucun scrutin avec un décompte pour / contre dans cette sélection.</ChartEmpty>
      )}
    </ChartCard>
  );
}

export function ClosestVotes({ scrutins, onOpenScrutin }: { scrutins: Scrutin[]; onOpenScrutin: (scrutin: Scrutin) => void }) {
  const votes = useMemo(() => closestVotes(scrutins), [scrutins]);
  return (
    <ChartCard id="stats-closest" title="Votes les plus disputés" aside="Plus faible écart de voix">
      {votes.length ? (
        <div className="close-votes-list">
          {votes.map(scrutin => (
            <article className="close-vote-item" key={`${scrutin.session}-${scrutin.number}`}>
              <button className="close-vote-open" type="button" aria-label={`Ouvrir le scrutin n°${scrutin.number}, session ${scrutin.session}`} onClick={() => onOpenScrutin(scrutin)} />
              <span className="close-vote-number">
                n°{scrutin.number}<span>{formatSessionRange(scrutin.session)}</span>
              </span>
              <span className="close-vote-title" title={scrutin.title}>{scrutin.title}</span>
              <span className="close-vote-margin tight">± {Math.abs(scrutin.pour - scrutin.contre)} voix</span>
            </article>
          ))}
        </div>
      ) : (
        <ChartEmpty>Aucun scrutin disputé trouvé pour cette sélection.</ChartEmpty>
      )}
    </ChartCard>
  );
}
