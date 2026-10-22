import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/endpoints';
import EChart, { ChartDataTable, type ChartSize } from '../components/EChart';
import {
  SEQUENTIAL_RAMP, inkOn, sequentialColor, tooltipBase, tooltipRow, tooltipTitle, type ChartTheme,
} from '../lib/chartTheme';
import { formatSessionRange } from '../lib/format';
import { getGroupColor } from '../lib/groups';
import { COVERAGE_MIN, COVERAGE_RELIABLE } from '../lib/statsCharts';
import {
  THEME_MIN_VOTES, shortThemeLabel, themeAdoption, themeAnalysisScope, themeGroupMatrix,
} from '../lib/themes';
import { POLITICAL_GROUPS } from '../data/politicalGroups';
import type { Scrutin, Stats, ThemeStats } from '../types';
import { ChartCard, ChartEmpty, GradientLegend, LegendItem, axisStyle, nf, valueAxisStyle } from './common';
import '../themes.css';

type ThemeStatsState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: ThemeStats };

const shortGroup = (code: string) => POLITICAL_GROUPS[code]?.short ?? code;
const pct = (value: number) => `${nf(value * 100)} %`;
const EMPTY_CELL = 'rgba(255,255,255,0.03)';
// Rough width of an 11px axis label, to reserve the left margin of the horizontal charts.
const labelWidth = (labels: string[]) => Math.min(190, Math.max(40, ...labels.map(l => l.length * 6.4)) + 10);

const APPROXIMATE = 'Les thèmes sont attribués automatiquement à partir de l’intitulé de chaque scrutin (mots-clés sur le texte voté) : '
  + 'un seul thème principal par scrutin, classement approximatif. Un amendement au projet de loi de finances relève ainsi du budget, '
  + 'quel que soit son objet.';

export default function ThemeCharts({ scrutins, selectedSession, sessionLabel, stats, theme }: {
  scrutins: Scrutin[]; // votes of the selected session
  selectedSession: string;
  sessionLabel: string;
  stats: Stats | null;
  theme: ChartTheme;
}) {
  // Group positions per theme come from a separate cached aggregation route.
  const [state, setState] = useState<ThemeStatsState>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    Promise.resolve()
      .then(() => api.themeStats(controller.signal))
      .then(data => { if (!controller.signal.aborted) setState({ kind: 'ready', data }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'error', message: error instanceof Error && error.message ? error.message : 'erreur inconnue' });
      });
    return () => controller.abort();
  }, [retry]);

  return (
    <section className="stats-group-section" aria-labelledby="stats-themes-title">
      <div className="stats-section-head">
        <h2 id="stats-themes-title">Thèmes</h2>
        <p>{APPROXIMATE}</p>
      </div>
      <div className="stats-charts-row">
        <ThemeAdoptionChart scrutins={scrutins} sessionLabel={sessionLabel} theme={theme} />
        {state.kind === 'loading' && (
          <ChartCard id="stats-theme-groups" title="Vote des groupes par thème"><ChartEmpty>Chargement des votes par groupe…</ChartEmpty></ChartCard>
        )}
        {state.kind === 'error' && (
          <ChartCard id="stats-theme-groups" title="Vote des groupes par thème">
            <ChartEmpty tone="warning">
              Les votes des groupes par thème sont indisponibles ({state.message}).{' '}
              <button className="stats-inline-button" type="button" onClick={() => setRetry(n => n + 1)}>Réessayer</button>
            </ChartEmpty>
          </ChartCard>
        )}
        {state.kind === 'ready' && (
          <ThemeGroupChart data={state.data} selectedSession={selectedSession} stats={stats} theme={theme} />
        )}
      </div>
    </section>
  );
}

function ThemeAdoptionChart({ scrutins, sessionLabel, theme }: {
  scrutins: Scrutin[];
  sessionLabel: string;
  theme: ChartTheme;
}) {
  const rows = useMemo(() => themeAdoption(scrutins), [scrutins]);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const adopted = rows.reduce((sum, row) => sum + row.adopted, 0);

  const option = useMemo(() => (size: ChartSize) => {
    const compact = size.width < 460;
    const labels = rows.map(row => (compact ? shortThemeLabel(row.label) : row.label));
    const gap = { borderColor: theme.surface, borderWidth: 1 };
    return {
      grid: { left: labelWidth(labels), right: compact ? 64 : 84, top: 4, bottom: 24 },
      tooltip: {
        ...tooltipBase(theme),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.05)' } },
        formatter: (params: Array<{ dataIndex: number }>) => {
          const row = rows[params[0]?.dataIndex ?? 0];
          if (!row) return '';
          return tooltipTitle(row.label, theme)
            + tooltipRow(theme.textSecondary, nf(row.total), row.total > 1 ? 'scrutins' : 'scrutin', theme)
            + tooltipRow(theme.adopted, nf(row.adopted), 'adoptés', theme)
            + tooltipRow(theme.rejected, nf(row.rejected), 'rejetés', theme)
            + tooltipRow(theme.accent, `${nf(row.rate, 1)} %`, 'taux d’adoption', theme);
        },
      },
      xAxis: { type: 'value', minInterval: 1, splitNumber: compact ? 3 : 5, ...valueAxisStyle(theme) },
      yAxis: {
        type: 'category', data: labels, inverse: true,
        ...axisStyle(theme),
        axisLabel: { ...axisStyle(theme).axisLabel, color: theme.textSecondary, hideOverlap: false, interval: 0 },
      },
      series: [
        {
          name: 'Adoptés', type: 'bar', stack: 'votes', barMaxWidth: 16, barCategoryGap: '35%',
          itemStyle: { color: theme.adopted, ...gap },
          data: rows.map(row => ({ value: row.adopted, itemStyle: { borderRadius: row.rejected === 0 ? [0, 4, 4, 0] : 0 } })),
          emphasis: { disabled: true },
        },
        {
          name: 'Rejetés', type: 'bar', stack: 'votes', barMaxWidth: 16,
          itemStyle: { color: theme.rejected, borderRadius: [0, 4, 4, 0], ...gap },
          data: rows.map(row => row.rejected),
          // Direct label at the end of each bar: total and adoption rate, in text ink.
          label: {
            show: true, position: 'right', color: theme.textMuted, fontSize: 11, fontFamily: theme.fontFamily,
            formatter: (params: { dataIndex: number }) => {
              const row = rows[params.dataIndex];
              return row ? `${nf(row.total)} · ${nf(row.rate)} %` : '';
            },
          },
          emphasis: { disabled: true },
        },
      ],
    };
  }, [rows, theme]);

  if (!rows.length) {
    return (
      <ChartCard id="stats-theme-votes" title="Scrutins par thème">
        <ChartEmpty>Aucun scrutin pour cette sélection.</ChartEmpty>
      </ChartCard>
    );
  }

  const top = rows[0];
  const label = `Scrutins publics par thème, ${sessionLabel.toLowerCase()} : ${nf(total)} scrutins répartis en ${rows.length} thèmes. `
    + `Thème le plus fréquent : ${top.label}, ${nf(top.total)} scrutins dont ${nf(top.rate, 1)} % adoptés.`;

  return (
    <ChartCard
      id="stats-theme-votes"
      title="Scrutins par thème"
      aside={sessionLabel}
      caption="Nombre de scrutins publics par thème, adoptés et rejetés ; en bout de barre : total · taux d’adoption. Thème attribué automatiquement d’après l’intitulé."
    >
      <ul className="stats-legend" aria-label="Légende">
        <LegendItem color={theme.adopted} label="Adoptés" value={nf(adopted)} />
        <LegendItem color={theme.rejected} label="Rejetés" value={nf(total - adopted)} />
      </ul>
      <EChart option={option} height={rows.length * 26 + 32} label={label} />
      <ChartDataTable
        caption="Scrutins par thème"
        columns={['Thème', 'Scrutins', 'Adoptés', 'Rejetés', 'Taux d’adoption']}
        rows={rows.map(row => [row.label, row.total, row.adopted, row.rejected, `${nf(row.rate, 1)} %`])}
      />
    </ChartCard>
  );
}

function ThemeGroupChart({ data, selectedSession, stats, theme }: {
  data: ThemeStats;
  selectedSession: string;
  stats: Stats | null;
  theme: ChartTheme;
}) {
  const scope = useMemo(() => themeAnalysisScope(data, selectedSession), [data, selectedSession]);
  const matrix = useMemo(() => themeGroupMatrix(data, scope.sessions), [data, scope]);
  const { themes, groups, cells } = matrix;

  const scopeLabel = selectedSession === 'all'
    ? scope.sessions.length
      ? `Sessions ${formatSessionRange(scope.sessions[0])} à ${formatSessionRange(scope.sessions[scope.sessions.length - 1])}`
      : 'Aucune session'
    : `Session ${formatSessionRange(selectedSession)}`;

  const option = useMemo(() => (size: ChartSize) => {
    const compact = size.width < 460;
    const labels = themes.map(t => (compact ? shortThemeLabel(t.label) : t.label));
    const left = labelWidth(labels);
    const cellWidth = (size.width - left - 14) / Math.max(1, groups.length);
    // Group codes are up to 6 characters: no colour dot below 58px cells, tilted below 38px.
    const crowded = cellWidth < 58;
    const tilted = cellWidth < 38;
    const top = tilted ? 44 : 30;
    const cellHeight = (size.height - top - 6) / Math.max(1, themes.length);
    const rich: Record<string, object> = { code: { color: theme.textSecondary, fontSize: crowded ? 10 : 11, fontWeight: 600 } };
    groups.forEach((code, i) => { rich[`d${i}`] = { color: getGroupColor(code, stats), fontSize: 10, padding: [0, 3, 0, 0] }; });
    return {
      grid: { left, right: tilted ? 14 : 6, top, bottom: 6 },
      tooltip: {
        ...tooltipBase(theme),
        trigger: 'item',
        formatter: (params: { data: { cell?: (typeof cells)[number] } }) => {
          const cell = params.data?.cell;
          if (!cell) return '';
          const themeLabel = themes.find(t => t.id === cell.theme)?.label ?? cell.theme;
          const head = tooltipTitle(`${shortGroup(cell.group)} · ${themeLabel}`, theme);
          if (cell.pct === null) {
            return head + `<div style="color:${theme.textMuted}">Trop peu de scrutins (${cell.votes}, minimum ${THEME_MIN_VOTES})</div>`;
          }
          return head
            + `<div><strong style="color:${theme.textPrimary};font-size:14px">${nf(cell.pct, 1)} %</strong>`
            + `<span style="color:${theme.textMuted}"> de scrutins où la majorité du groupe a voté pour</span></div>`
            + `<div style="color:${theme.textMuted}">Pour ${nf(cell.pour)} · contre ${nf(cell.contre)} · abstention ${nf(cell.abstention)}`
            + ` · partagé ${nf(cell.votes - cell.pour - cell.contre - cell.abstention)} — sur ${nf(cell.votes)} scrutins</div>`;
        },
      },
      xAxis: {
        type: 'category', data: groups, position: 'top',
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: {
          color: theme.textSecondary, fontFamily: theme.fontFamily, rich, interval: 0, rotate: tilted ? 45 : 0,
          formatter: (value: string) => (crowded ? `{code|${shortGroup(value)}}` : `{d${groups.indexOf(value)}|●}{code|${shortGroup(value)}}`),
        },
      },
      yAxis: {
        type: 'category', data: labels, inverse: true,
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { color: theme.textSecondary, fontSize: 11, fontFamily: theme.fontFamily, interval: 0 },
      },
      // A grid of rounded cells drawn as a scatter series: ECharts 6 heatmaps require a
      // visualMap component, and the colour of each cell is computed here anyway.
      series: [{
        type: 'scatter',
        symbol: 'roundRect',
        symbolSize: [Math.max(4, cellWidth - 3), Math.max(4, cellHeight - 3)],
        data: cells.map(cell => {
          const color = cell.pct === null ? EMPTY_CELL : sequentialColor(cell.pct / 100);
          return {
            value: [groups.indexOf(cell.group), themes.findIndex(t => t.id === cell.theme)],
            cell,
            itemStyle: { color, opacity: 1 },
            label: {
              show: cellWidth >= 22, position: 'inside',
              color: cell.pct === null ? theme.textMuted : inkOn(color), fontSize: compact ? 9 : 11, fontWeight: 600,
              formatter: cell.pct === null ? '·' : String(Math.round(cell.pct)),
            },
          };
        }),
        emphasis: { scale: false, itemStyle: { borderColor: theme.textPrimary, borderWidth: 1 } },
      }],
    };
  }, [cells, groups, stats, theme, themes]);

  const caption = `Part des scrutins du thème où la majorité des membres du groupe ayant voté s’est prononcée pour (au moins ${data.minGroupVoters} membres exprimés). `
    + `Calculé à partir des votes nominatifs des sénateurs en exercice uniquement ; sous ${pct(COVERAGE_MIN)} de couverture la session n’est pas affichée, `
    + `entre ${pct(COVERAGE_MIN)} et ${pct(COVERAGE_RELIABLE)} elle est signalée comme partielle. « · » : moins de ${THEME_MIN_VOTES} scrutins. Non-inscrits exclus.`;

  let body;
  if (scope.state === 'empty' || (scope.state !== 'low' && (!groups.length || !themes.length))) {
    body = <ChartEmpty>Aucun vote nominatif exploitable pour cette sélection.</ChartEmpty>;
  } else if (scope.state === 'low') {
    body = (
      <ChartEmpty tone="warning">
        Couverture insuffisante : seuls <strong>{pct(scope.coverage)}</strong> des votants officiels de la session {formatSessionRange(selectedSession)} sont
        des sénateurs encore en exercice ; les positions des groupes par thème ne sont calculées qu’à partir de {pct(COVERAGE_MIN)} de couverture.
      </ChartEmpty>
    );
  } else {
    const label = `Carte de chaleur : part des scrutins où chacun des ${groups.length} groupes a voté majoritairement pour, sur ${themes.length} thèmes, ${scopeLabel.toLowerCase()}. `
      + 'Le détail est disponible dans le tableau des données.';
    body = (
      <>
        {scope.state === 'partial' && (
          <p className="stats-coverage-note">Couverture partielle ({pct(scope.coverage)}) : tendances indicatives.</p>
        )}
        <EChart option={option} height={themes.length * 30 + 52} label={label} />
        <GradientLegend from="0 %" to="100 %" ramp={SEQUENTIAL_RAMP} label="Pour" />
        <ChartDataTable
          caption="Vote des groupes par thème"
          columns={['Thème', 'Groupe', 'Majorité pour', 'Pour', 'Contre', 'Abstention', 'Scrutins']}
          rows={cells.filter(cell => cell.votes > 0).map(cell => [
            themes.find(t => t.id === cell.theme)?.label ?? cell.theme, shortGroup(cell.group),
            cell.pct === null ? '—' : `${nf(cell.pct, 1)} %`, cell.pour, cell.contre, cell.abstention, cell.votes,
          ])}
        />
      </>
    );
  }

  return (
    <ChartCard
      id="stats-theme-groups"
      title="Vote des groupes par thème"
      aside={scope.state === 'empty' ? undefined : `${scopeLabel} · couverture ${pct(scope.coverage)}`}
      caption={caption}
    >
      {body}
    </ChartCard>
  );
}
