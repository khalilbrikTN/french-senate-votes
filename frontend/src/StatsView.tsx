import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from './api/endpoints';
import { getTotalSeats } from './lib/groups';
import { formatSessionRange } from './lib/format';
import { readChartTheme } from './lib/chartTheme';
import { getSessionScrutins } from './lib/scrutins';
import ActivityChart from './stats/ActivityChart';
import AdoptionChart from './stats/AdoptionChart';
import GroupCharts, { type GroupStatsState } from './stats/GroupCharts';
import Hemicycle from './stats/Hemicycle';
import { ClosestVotes, MarginChart } from './stats/MarginChart';
import type { Scrutin, Stats } from './types';
import './stats.css';

interface StatsViewProps {
  scrutins: Scrutin[];
  stats: Stats | null;
  selectedSession: string;
  onOpenScrutin: (scrutin: Scrutin) => void;
}

export default function StatsView({ scrutins, stats, selectedSession, onOpenScrutin }: StatsViewProps) {
  const sessionScrutins = useMemo(() => getSessionScrutins(scrutins, selectedSession), [scrutins, selectedSession]);
  const total = sessionScrutins.length;
  const adopted = sessionScrutins.filter(scrutin => scrutin.result === 'adopté').length;
  const rejected = sessionScrutins.filter(scrutin => scrutin.result === 'rejeté').length;
  const adoptionRate = total ? Math.round(adopted / total * 100) : 0;
  const totalVotes = sessionScrutins.reduce(
    (sum, scrutin) => sum + (scrutin.total || scrutin.pour + scrutin.contre + scrutin.abstention),
    0,
  );
  const averageVoters = total ? Math.round(totalVotes / total) : 340;
  const totalSeats = getTotalSeats(stats);
  const sessionLabel = selectedSession === 'all' ? 'Toutes les sessions' : `Session ${formatSessionRange(selectedSession)}`;
  const theme = useMemo(() => readChartTheme(), []);

  // Group behaviour comes from a separate, cached aggregation route; fetched once per visit.
  const [groupStats, setGroupStats] = useState<GroupStatsState>({ kind: 'loading' });
  const [groupRetry, setGroupRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setGroupStats({ kind: 'loading' });
    Promise.resolve()
      .then(() => api.groupStats(controller.signal))
      .then(data => { if (!controller.signal.aborted) setGroupStats({ kind: 'ready', data }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setGroupStats({ kind: 'error', message: error instanceof Error && error.message ? error.message : 'erreur inconnue' });
      });
    return () => controller.abort();
  }, [groupRetry]);
  const retryGroups = useCallback(() => setGroupRetry(n => n + 1), []);

  return (
    <main className="main-content view-panel" id="view-stats">
      <div className="container">
        <h1 className="sr-only">Statistiques</h1>
        <div className="stats-dashboard">
          <div className="stats-summary-grid">
            <SummaryCard accent="var(--color-blue)" label="Scrutins publics analysés" value={total} sub={sessionLabel} />
            <SummaryCard accent="var(--color-green)" label="Textes & amendements adoptés" value={adopted} sub={`${adoptionRate}% de taux d’adoption`} />
            <SummaryCard accent="var(--color-red)" label="Textes rejetés" value={rejected} sub={`${100 - adoptionRate}% de rejets ou motions`} />
            <SummaryCard accent="var(--color-gold)" label="Moyenne de votants" value={averageVoters} sub={`Sur ${totalSeats} sénateurs en exercice`} />
          </div>

          <div className="stats-charts-row">
            <div className="stats-stack">
              <section className="stats-chart-card">
                <div className="stats-chart-title">
                  <span>Issue des scrutins au Sénat</span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Pourcentage officiel</span>
                </div>
                {total ? (
                  <div className="chart-distribution-bars">
                    <DistributionBar label="Textes et amendements adoptés" count={adopted} percent={adoptionRate} color="var(--color-green)" />
                    <DistributionBar label="Textes rejetés" count={rejected} percent={100 - adoptionRate} color="var(--color-red)" />
                  </div>
                ) : (
                  <div className="stats-empty" role="status">Aucun scrutin pour cette sélection.</div>
                )}
              </section>
              <ClosestVotes scrutins={sessionScrutins} onOpenScrutin={onOpenScrutin} />
            </div>
            <Hemicycle stats={stats} theme={theme} />
          </div>

          <ActivityChart scrutins={sessionScrutins} sessionLabel={sessionLabel} theme={theme} />
          <AdoptionChart scrutins={scrutins} selectedSession={selectedSession} theme={theme} />

          <MarginChart scrutins={sessionScrutins} sessionLabel={sessionLabel} theme={theme} />

          <GroupCharts state={groupStats} selectedSession={selectedSession} stats={stats} theme={theme} onRetry={retryGroups} />
        </div>
      </div>
    </main>
  );
}

function SummaryCard({ accent, label, value, sub }: { accent: string; label: string; value: number; sub: string }) {
  return (
    <div className="stat-summary-card" style={{ '--stat-accent': accent } as CSSProperties}>
      <div className="stat-summary-label">{label}</div>
      <div className="stat-summary-num">{value.toLocaleString('fr-FR')}</div>
      <div className="stat-summary-sub">{sub}</div>
    </div>
  );
}

function DistributionBar({ label, count, percent, color }: { label: string; count: number; percent: number; color: string }) {
  return (
    <div className="chart-bar-group">
      <div className="chart-bar-label-row">
        <span className="chart-bar-name">{label}</span>
        <span className="chart-bar-value" style={{ color }}>{count.toLocaleString('fr-FR')} ({percent}%)</span>
      </div>
      <div className="chart-bar-track">
        <div className="chart-bar-fill" style={{ width: `${percent}%`, background: color }} />
      </div>
    </div>
  );
}
