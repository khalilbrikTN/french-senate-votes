import { useMemo } from 'react';
import EChart, { ChartDataTable, type ChartSize } from '../components/EChart';
import { SEQUENTIAL_RAMP, inkOn, sequentialColor, tooltipBase, tooltipTitle, type ChartTheme } from '../lib/chartTheme';
import { formatSessionRange } from '../lib/format';
import { getGroupColor } from '../lib/groups';
import {
  COVERAGE_MIN, COVERAGE_RELIABLE, agreementMatrix, cohesionGrid, groupAnalysisScope,
} from '../lib/statsCharts';
import { POLITICAL_GROUPS } from '../data/politicalGroups';
import type { GroupStats, Stats } from '../types';
import { ChartCard, ChartEmpty, GradientLegend, nf, shortSession } from './common';

const shortName = (code: string) => POLITICAL_GROUPS[code]?.short ?? code;
const pct = (value: number) => `${nf(value * 100)} %`;
const EMPTY_CELL = 'rgba(255,255,255,0.03)';

export type GroupStatsState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: GroupStats };

export default function GroupCharts({ state, selectedSession, stats, theme, onRetry }: {
  state: GroupStatsState;
  selectedSession: string;
  stats: Stats | null;
  theme: ChartTheme;
  onRetry: () => void;
}) {
  return (
    <section className="stats-group-section" aria-labelledby="stats-groups-title">
      <div className="stats-section-head">
        <h2 id="stats-groups-title">Comportement des groupes</h2>
        <p>
          Calculé à partir des votes nominatifs des <strong>sénateurs en exercice uniquement</strong> (348 aujourd’hui) :
          les anciens sénateurs ne sont pas chargés, si bien que les sessions anciennes sont incomplètes.
          La <em>couverture</em> d’une session est la part de ses votants officiels retrouvés nominativement ;
          sous {pct(COVERAGE_MIN)} les chiffres ne sont pas affichés, entre {pct(COVERAGE_MIN)} et {pct(COVERAGE_RELIABLE)} ils sont signalés comme partiels.
        </p>
      </div>
      {state.kind === 'loading' && (
        <div className="stats-charts-row">
          <ChartCard id="stats-agreement" title="Accord entre groupes"><ChartEmpty>Chargement des votes par groupe…</ChartEmpty></ChartCard>
          <ChartCard id="stats-cohesion" title="Cohésion des groupes"><ChartEmpty>Chargement des votes par groupe…</ChartEmpty></ChartCard>
        </div>
      )}
      {state.kind === 'error' && (
        <ChartEmpty tone="warning">
          Les statistiques par groupe sont indisponibles ({state.message}).{' '}
          <button className="stats-inline-button" type="button" onClick={onRetry}>Réessayer</button>
        </ChartEmpty>
      )}
      {state.kind === 'ready' && (
        <div className="stats-charts-row">
          <AgreementChart data={state.data} selectedSession={selectedSession} stats={stats} theme={theme} />
          <CohesionChart data={state.data} selectedSession={selectedSession} stats={stats} theme={theme} />
        </div>
      )}
    </section>
  );
}

// Axis label with a dot in the group colour (identity) and the code in muted ink.
function groupAxisLabel(groups: string[], stats: Stats | null, theme: ChartTheme, withDot = true) {
  const rich: Record<string, object> = { code: { color: theme.textSecondary, fontSize: 11, fontWeight: 600 } };
  groups.forEach((code, i) => { rich[`d${i}`] = { color: getGroupColor(code, stats), fontSize: 10, padding: [0, 3, 0, 0] }; });
  return {
    color: theme.textSecondary,
    fontFamily: theme.fontFamily,
    rich,
    formatter: (value: string) => (withDot ? `{d${groups.indexOf(value)}|●}{code|${shortName(value)}}` : `{code|${shortName(value)}}`),
  };
}

function AgreementChart({ data, selectedSession, stats, theme }: {
  data: GroupStats;
  selectedSession: string;
  stats: Stats | null;
  theme: ChartTheme;
}) {
  const scope = useMemo(() => groupAnalysisScope(data, selectedSession), [data, selectedSession]);
  const matrix = useMemo(() => agreementMatrix(data, scope.sessions), [data, scope]);
  const { groups, cells } = matrix;

  const scopeLabel = selectedSession === 'all'
    ? scope.sessions.length
      ? `Sessions ${formatSessionRange(scope.sessions[0])} à ${formatSessionRange(scope.sessions[scope.sessions.length - 1])}`
      : 'Aucune session'
    : `Session ${formatSessionRange(selectedSession)}`;

  const option = useMemo(() => (size: ChartSize) => {
    const compact = size.width < 460;
    return {
      grid: { left: compact ? 58 : 70, right: 6, top: 30, bottom: 6 },
      tooltip: {
        ...tooltipBase(theme),
        trigger: 'item',
        formatter: (params: { data: { cell?: (typeof cells)[number] } }) => {
          const cell = params.data?.cell;
          if (!cell) return '';
          if (cell.pct === null) {
            return tooltipTitle(`${shortName(cell.a)} et ${shortName(cell.b)}`, theme)
              + `<div style="color:${theme.textMuted}">Trop peu de scrutins communs (${cell.votes})</div>`;
          }
          return tooltipTitle(`${shortName(cell.a)} et ${shortName(cell.b)}`, theme)
            + `<div><strong style="color:${theme.textPrimary};font-size:14px">${nf(cell.pct, 1)} %</strong>`
            + `<span style="color:${theme.textMuted}"> de positions identiques</span></div>`
            + `<div style="color:${theme.textMuted}">${nf(cell.agree)} scrutins sur ${nf(cell.votes)}</div>`;
        },
      },
      xAxis: {
        type: 'category', data: groups, position: 'top',
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { ...groupAxisLabel(groups, stats, theme, !compact), interval: 0, rotate: compact ? 45 : 0 },
      },
      yAxis: {
        type: 'category', data: groups, inverse: true,
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { ...groupAxisLabel(groups, stats, theme), interval: 0 },
      },
      series: [{
        type: 'heatmap',
        data: [
          ...cells.map(cell => {
            const color = cell.pct === null ? EMPTY_CELL : sequentialColor(cell.pct / 100);
            return {
              value: [groups.indexOf(cell.a), groups.indexOf(cell.b), cell.pct ?? '-'],
              cell,
              itemStyle: { color, borderColor: theme.surface, borderWidth: 2, borderRadius: 4 },
              label: {
                show: true, color: cell.pct === null ? theme.textMuted : inkOn(color), fontSize: compact ? 9 : 11, fontWeight: 600,
                formatter: cell.pct === null ? '·' : String(Math.round(cell.pct)),
              },
            };
          }),
          ...groups.map((_, i) => ({
            value: [i, i, '-'],
            itemStyle: { color: EMPTY_CELL, borderColor: theme.surface, borderWidth: 2, borderRadius: 4 },
            label: { show: false },
          })),
        ],
        emphasis: { itemStyle: { borderColor: theme.textPrimary, borderWidth: 1 } },
      }],
    };
  }, [cells, groups, stats, theme]);

  const caption = 'Part des scrutins où les deux groupes ont adopté la même position majoritaire (pour, contre ou abstention), parmi ceux où chacun avait une majorité nette d’au moins '
    + `${data.minGroupVoters} membres exprimés. Les non-votants sont ignorés ; les non-inscrits, qui ne forment pas un groupe, sont exclus.`;

  let body;
  if (scope.state === 'empty' || (scope.state !== 'low' && groups.length < 2)) {
    body = <ChartEmpty>Aucun vote nominatif exploitable pour cette sélection.</ChartEmpty>;
  } else if (scope.state === 'low') {
    body = (
      <ChartEmpty tone="warning">
        Couverture insuffisante : seuls <strong>{pct(scope.coverage)}</strong> des votants officiels de la session {formatSessionRange(selectedSession)} sont
        des sénateurs encore en exercice. Avec si peu de votes nominatifs, la position majoritaire des groupes ne serait pas représentative ;
        la matrice n’est calculée qu’à partir de {pct(COVERAGE_MIN)} de couverture.
      </ChartEmpty>
    );
  } else {
    const strongest = cells.filter(c => c.pct !== null && c.a < c.b).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    const top = strongest[0];
    const bottom = strongest[strongest.length - 1];
    const label = `Matrice d’accord entre ${groups.length} groupes, ${scopeLabel.toLowerCase()}. `
      + (top ? `Accord le plus fort : ${shortName(top.a)} et ${shortName(top.b)}, ${nf(top.pct ?? 0)} %. ` : '')
      + (bottom ? `Le plus faible : ${shortName(bottom.a)} et ${shortName(bottom.b)}, ${nf(bottom.pct ?? 0)} %.` : '');
    body = (
      <>
        {scope.state === 'partial' && (
          <p className="stats-coverage-note">Couverture partielle ({pct(scope.coverage)}) : tendances indicatives.</p>
        )}
        <EChart option={option} height={groups.length * 36 + 44} label={label} />
        <GradientLegend from="0 %" to="100 %" ramp={SEQUENTIAL_RAMP} label="Accord" />
        <ChartDataTable
          caption="Accord entre groupes"
          columns={['Paire', 'Accord', 'Scrutins communs']}
          rows={cells.filter(c => groups.indexOf(c.a) < groups.indexOf(c.b))
            .map(c => [`${shortName(c.a)} – ${shortName(c.b)}`, c.pct === null ? '—' : `${nf(c.pct, 1)} %`, c.votes])}
        />
      </>
    );
  }

  return (
    <ChartCard
      id="stats-agreement"
      title="Accord entre groupes"
      aside={scope.state === 'empty' ? undefined : `${scopeLabel} · couverture ${pct(scope.coverage)}`}
      caption={caption}
    >
      {body}
    </ChartCard>
  );
}

function CohesionChart({ data, selectedSession, stats, theme }: {
  data: GroupStats;
  selectedSession: string;
  stats: Stats | null;
  theme: ChartTheme;
}) {
  const grid = useMemo(() => cohesionGrid(data), [data]);
  const sessions = grid.sessions.map(s => s.session);
  const minValue = grid.cells.length ? Math.min(...grid.cells.map(c => c.value)) : 70;
  const floor = Math.min(70, Math.floor(minValue / 5) * 5);
  const selectedRow = data.sessions.find(s => s.session === selectedSession);
  const selectedHidden = selectedSession !== 'all' && !sessions.includes(selectedSession);

  const option = useMemo(() => (size: ChartSize) => {
    const compact = size.width < 460;
    const cellWidth = (size.width - (compact ? 64 : 76)) / Math.max(1, sessions.length);
    const colorOf = (value: number) => sequentialColor((value - floor) / (100 - floor));
    return {
      grid: { left: compact ? 58 : 70, right: 6, top: 6, bottom: 40 },
      tooltip: {
        ...tooltipBase(theme),
        trigger: 'item',
        formatter: (params: { data: { cell?: (typeof grid.cells)[number] } }) => {
          const cell = params.data?.cell;
          if (!cell) return '';
          const session = grid.sessions.find(s => s.session === cell.session);
          return tooltipTitle(`${shortName(cell.group)} · ${formatSessionRange(cell.session)}`, theme)
            + `<div><strong style="color:${theme.textPrimary};font-size:14px">${nf(cell.value, 1)}</strong>`
            + `<span style="color:${theme.textMuted}"> indice d’accord</span></div>`
            + `<div style="color:${theme.textMuted}">${nf(cell.votes)} scrutins · ${nf(cell.avgVoters, 1)} membres exprimés en moyenne</div>`
            + (session ? `<div style="color:${theme.textMuted}">Couverture de la session : ${pct(session.coverage)}${session.partial ? ' (partielle)' : ''}</div>` : '');
        },
      },
      xAxis: {
        type: 'category', data: sessions,
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: {
          interval: 0, color: theme.textMuted, fontSize: compact ? 9 : 10, lineHeight: 13, fontFamily: theme.fontFamily,
          rich: {
            sel: { color: theme.textPrimary, fontWeight: 700, fontSize: compact ? 9 : 10, lineHeight: 13 },
            cov: { color: theme.textMuted, fontSize: 9, lineHeight: 12 },
          },
          formatter: (value: string) => {
            const s = grid.sessions.find(row => row.session === value);
            const name = `${shortSession(value)}${s?.partial ? '*' : ''}`;
            const coverage = s ? `{cov|${Math.round(s.coverage * 100)} %}` : '';
            return `${value === selectedSession ? `{sel|${name}}` : name}\n${coverage}`;
          },
        },
      },
      yAxis: {
        type: 'category', data: grid.groups, inverse: true,
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { ...groupAxisLabel(grid.groups, stats, theme), interval: 0 },
      },
      series: [{
        type: 'heatmap',
        data: grid.cells.map(cell => {
          const color = colorOf(cell.value);
          const selected = cell.session === selectedSession;
          return {
            value: [sessions.indexOf(cell.session), grid.groups.indexOf(cell.group), cell.value],
            cell,
            itemStyle: {
              color,
              borderColor: selected ? theme.textPrimary : theme.surface,
              borderWidth: selected ? 1.5 : 2,
              borderRadius: 4,
            },
            label: {
              show: cellWidth >= 24,
              color: inkOn(color), fontSize: compact ? 9 : 10, fontWeight: 600,
              formatter: String(Math.round(cell.value)),
            },
          };
        }),
        emphasis: { itemStyle: { borderColor: theme.textPrimary, borderWidth: 1 } },
      }],
    };
  }, [floor, grid, selectedSession, sessions, stats, theme]);

  const caption = (
    <>
      Indice d’accord de Hix, Noury et Roland : pour chaque scrutin, (max(P, C, A) − ½ · (P + C + A − max)) / (P + C + A),
      où P, C et A sont les membres du groupe ayant voté pour, contre ou s’étant abstenus ; 100 = vote unanime,
      0 = groupe partagé en trois parts égales. Moyenne sur les scrutins où au moins {data.minGroupVoters} membres se sont exprimés.
      Sous chaque session : sa couverture ; * = couverture partielle (moins de {pct(COVERAGE_RELIABLE)}).
      {grid.hiddenSessions > 0 && ` ${grid.hiddenSessions} sessions plus anciennes (couverture < ${pct(COVERAGE_MIN)}) ne sont pas affichées.`}
    </>
  );

  if (!grid.cells.length) {
    return (
      <ChartCard id="stats-cohesion" title="Cohésion des groupes">
        <ChartEmpty>Aucune session n’a une couverture suffisante pour mesurer la cohésion.</ChartEmpty>
      </ChartCard>
    );
  }

  const latest = sessions[sessions.length - 1];
  const latestCells = grid.cells.filter(c => c.session === latest).sort((a, b) => a.value - b.value);
  const label = `Cohésion de ${grid.groups.length} groupes sur ${sessions.length} sessions (${formatSessionRange(sessions[0])} à ${formatSessionRange(latest)}), indice de 0 à 100. `
    + (latestCells.length ? `En ${formatSessionRange(latest)}, le groupe le moins uni est ${shortName(latestCells[0].group)} (${nf(latestCells[0].value, 1)}), le plus uni ${shortName(latestCells[latestCells.length - 1].group)} (${nf(latestCells[latestCells.length - 1].value, 1)}).` : '');

  return (
    <ChartCard
      id="stats-cohesion"
      title="Cohésion des groupes"
      aside={`Sessions à couverture ≥ ${pct(COVERAGE_MIN)}`}
      caption={caption}
    >
      {selectedHidden && selectedRow && (
        <p className="stats-coverage-note">
          La session {formatSessionRange(selectedSession)} n’est pas affichée : couverture de {pct(selectedRow.coverage)} seulement.
        </p>
      )}
      <EChart option={option} height={grid.groups.length * 32 + 50} label={label} />
      <GradientLegend from={nf(floor)} to="100" ramp={SEQUENTIAL_RAMP} label="Indice" />
      <ChartDataTable
        caption="Cohésion des groupes par session"
        columns={['Groupe', 'Session', 'Indice', 'Scrutins', 'Couverture']}
        rows={grid.groups.flatMap(group => grid.cells.filter(c => c.group === group).map(c => {
          const session = grid.sessions.find(s => s.session === c.session);
          return [shortName(group), formatSessionRange(c.session), nf(c.value, 1), c.votes, session ? pct(session.coverage) : '—'];
        }))}
      />
    </ChartCard>
  );
}
