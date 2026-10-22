import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/endpoints';
import { GROUP_CODES, POLITICAL_GROUPS } from '../data/politicalGroups';
import { getInitials } from '../lib/format';
import { getGroupColor } from '../lib/groups';
import {
  LOYALTY_COVERAGE_NOTE, LOYALTY_DEFINITION, averageLoyalty, countedVotes, formatLoyalty, loyaltyTone, rankByIndependence,
} from '../lib/loyalty';
import SenatorDetailDialog from '../SenatorDetailDialog';
import type { LoyaltyOverview, Scrutin, Senator, Stats } from '../types';
import FilterDropdown from './FilterDropdown';
import '../loyalty.css';

export const RANKING_PAGE_SIZE = 20;
export const MIN_VOTES_CHOICES = [100, 500, 1000];

type OverviewState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; data: LoyaltyOverview };

interface LoyaltyRankingProps {
  senators: Senator[];
  stats: Stats | null;
  // Opens the app's senator panel. Without it the ranking opens its own panel
  // (whose rebel votes then cannot open the scrutin: it has no scrutin list).
  onOpenSenator?: (senator: Senator) => void;
  scrutins?: Scrutin[];
  onOpenScrutin?: (scrutin: Scrutin) => void;
  // h1 when the ranking is the whole page (Indépendance view), h2 inside another page.
  titleAs?: 'h1' | 'h2';
}

export default function LoyaltyRanking({
  senators, stats, onOpenSenator, scrutins = [], onOpenScrutin = () => undefined, titleAs: Title = 'h2',
}: LoyaltyRankingProps) {
  const [state, setState] = useState<OverviewState>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const [group, setGroup] = useState('all');
  const [minVotes, setMinVotes] = useState(MIN_VOTES_CHOICES[0]);
  const [visible, setVisible] = useState(RANKING_PAGE_SIZE);
  const [localSenator, setLocalSenator] = useState<Senator | null>(null);
  // Hidden views stay mounted: fetch the ranking once it is first on screen.
  const sectionRef = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (seen || !sectionRef.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setSeen(true);
    }, { rootMargin: '400px' });
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, [seen]);

  useEffect(() => {
    if (!seen) return;
    const controller = new AbortController();
    setState({ kind: 'loading' });
    api.loyalty(controller.signal)
      .then(data => { if (!controller.signal.aborted) setState({ kind: 'ready', data }); })
      .catch(() => { if (!controller.signal.aborted) setState({ kind: 'error' }); });
    return () => controller.abort();
  }, [retry, seen]);

  useEffect(() => setVisible(RANKING_PAGE_SIZE), [group, minVotes]);

  const byMatricule = useMemo(() => new Map(senators.map(s => [s.matricule, s])), [senators]);
  const data = state.kind === 'ready' ? state.data : null;
  const ranked = useMemo(() => data ? rankByIndependence(data.senators, { group, minVotes }) : [], [data, group, minVotes]);
  const groupAverages = useMemo(() => {
    if (!data) return [];
    const codes = [...new Set([...GROUP_CODES, ...data.groups.map(g => g.group)])].filter(code => code !== 'NI');
    return codes
      .map(code => {
        const members = rankByIndependence(data.senators, { group: code, minVotes });
        return { code, average: averageLoyalty(members), count: members.length };
      })
      .filter(entry => entry.count > 0)
      .sort((a, b) => (a.average! - b.average!) || a.code.localeCompare(b.code));
  }, [data, minVotes]);

  const openSenator = (senator: Senator) => (onOpenSenator ? onOpenSenator(senator) : setLocalSenator(senator));
  const groupOptions = [
    { value: 'all', label: 'Tous les groupes', hint: 'Hors non-inscrits' },
    ...groupAverages.map(({ code }) => ({ value: code, label: POLITICAL_GROUPS[code]?.name || code, badge: code })),
  ];
  const minVotesOptions = MIN_VOTES_CHOICES.map(value => ({
    value: String(value), label: `${value.toLocaleString('fr-FR')} votes comparés ou plus`,
  }));
  const selectedAverage = groupAverages.find(entry => entry.code === group);

  return (
    <section ref={sectionRef} className="loyalty-ranking" aria-labelledby="loyalty-ranking-title" aria-busy={state.kind === 'loading'}>
      <div className="loyalty-ranking-header">
        <div>
          <p className="section-eyebrow">Discipline de vote</p>
          <Title className="loyalty-ranking-title" id="loyalty-ranking-title">Les sénateurs les plus indépendants</Title>
          <p className="loyalty-ranking-lead">
            Sénateurs en exercice classés du moins au plus aligné sur la position majoritaire de leur groupe.
          </p>
        </div>
      </div>

      {state.kind === 'loading' && (
        <div className="loading-state"><div className="loading-spinner" /><p>Calcul de la loyauté des sénateurs…</p></div>
      )}
      {state.kind === 'error' && (
        <div className="loyalty-message" role="alert">
          Impossible de charger le classement de loyauté.
          <button className="btn-secondary" type="button" onClick={() => setRetry(n => n + 1)}>Réessayer</button>
        </div>
      )}

      {data && (
        <>
          <div className="loyalty-group-averages" aria-label="Loyauté moyenne par groupe">
            {groupAverages.map(entry => {
              const color = getGroupColor(entry.code, stats);
              const active = group === entry.code;
              return (
                <button
                  key={entry.code}
                  type="button"
                  className={`loyalty-group-chip${active ? ' is-active' : ''}`}
                  style={{ borderColor: active ? color : `${color}55` }}
                  aria-pressed={active}
                  title={`${entry.count} sénateurs classés`}
                  onClick={() => setGroup(active ? 'all' : entry.code)}
                >
                  <span className="loyalty-group-chip-code" style={{ color }}>
                    <span className="loyalty-dot" style={{ background: color }} />{entry.code}
                  </span>
                  <span className="loyalty-group-chip-value">{formatLoyalty(entry.average)}</span>
                </button>
              );
            })}
          </div>
          <p className="loyalty-caption">Moyenne de la loyauté des sénateurs classés de chaque groupe (groupe actuel).</p>

          <div className="loyalty-filters">
            <FilterDropdown id="loyalty-group" label="Groupe politique" value={group} options={groupOptions} onChange={setGroup} />
            <FilterDropdown id="loyalty-min-votes" label="Seuil de classement" value={String(minVotes)} options={minVotesOptions} onChange={value => setMinVotes(Number(value))} />
          </div>

          <p className="loyalty-results" aria-live="polite">
            <strong>{ranked.length.toLocaleString('fr-FR')}</strong> sénateur{ranked.length === 1 ? '' : 's'} classé{ranked.length === 1 ? '' : 's'}
            {selectedAverage && <> · moyenne du groupe {selectedAverage.code} : <strong>{formatLoyalty(selectedAverage.average)}</strong></>}
          </p>

          {ranked.length === 0 ? (
            <p className="loyalty-message" role="status">Aucun sénateur n’atteint ce seuil de votes comparés.</p>
          ) : (
            <ol className="loyalty-ranking-list">
              {ranked.slice(0, visible).map((entry, index) => {
                const senator = byMatricule.get(entry.matricule);
                const color = getGroupColor(entry.group, stats);
                const tone = loyaltyTone(entry.loyalty);
                const content = (
                  <>
                    <span className="loyalty-rank">{index + 1}</span>
                    <span className="loyalty-avatar" style={{ borderColor: `${color}66`, color }}>
                      {senator?.avatar ? <img src={senator.avatar} alt="" loading="lazy" decoding="async" /> : getInitials(entry.name)}
                    </span>
                    <span className="loyalty-row-main">
                      <span className="loyalty-row-name">{entry.name}</span>
                      <span className="loyalty-row-meta">
                        <span className="loyalty-row-group" style={{ color, background: `${color}20`, borderColor: `${color}40` }}>{entry.group}</span>
                        <span>{entry.rebels.toLocaleString('fr-FR')} écart{entry.rebels === 1 ? '' : 's'} / {countedVotes(entry).toLocaleString('fr-FR')} votes</span>
                      </span>
                    </span>
                    <span className="loyalty-row-score">
                      <span className={`loyalty-row-value tone-${tone}`}>{formatLoyalty(entry.loyalty)}</span>
                      <span className="loyalty-bar loyalty-bar-sm" aria-hidden="true">
                        <span className={`loyalty-bar-fill tone-${tone}`} style={{ width: `${entry.loyalty ?? 0}%` }} />
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={entry.matricule}>
                    {senator ? (
                      <button type="button" className="loyalty-row" onClick={() => openSenator(senator)}
                        aria-label={`${index + 1}. ${entry.name}, ${entry.group}, loyauté ${formatLoyalty(entry.loyalty)} : ouvrir la fiche`}>
                        {content}
                      </button>
                    ) : (
                      <div className="loyalty-row">{content}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {visible < ranked.length && (
            <div className="senator-history-more">
              <button className="btn-secondary" type="button" onClick={() => setVisible(n => n + RANKING_PAGE_SIZE)}>
                Afficher plus ({Math.min(visible, ranked.length)} sur {ranked.length})
              </button>
            </div>
          )}

          <details className="loyalty-definition">
            <summary>Méthode et limites</summary>
            <p>{LOYALTY_DEFINITION}</p>
            <p>
              Pour être classé, un sénateur doit compter au moins {minVotes.toLocaleString('fr-FR')} votes comparés.
              Le groupe affiché est le groupe actuel ; chaque vote est comparé au groupe du jour du scrutin.
            </p>
            <p>{LOYALTY_COVERAGE_NOTE}</p>
          </details>
        </>
      )}

      {localSenator && (
        <SenatorDetailDialog
          key={localSenator.matricule}
          senator={localSenator}
          scrutins={scrutins}
          stats={stats}
          onClose={() => setLocalSenator(null)}
          onOpenScrutin={onOpenScrutin}
        />
      )}
    </section>
  );
}
