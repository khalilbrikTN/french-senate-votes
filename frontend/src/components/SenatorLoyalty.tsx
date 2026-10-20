import { useEffect, useId, useState } from 'react';
import { api } from '../api/endpoints';
import { formatDate } from '../lib/format';
import { LOYALTY_COVERAGE_NOTE, LOYALTY_DEFINITION, formatLoyalty, loyaltyTone, positionLabel } from '../lib/loyalty';
import { findScrutin } from '../lib/scrutins';
import type { RebelVote, Scrutin, Senator, SenatorRebels } from '../types';
import '../loyalty.css';

// Most recent rebel votes fetched first; "Tout afficher" fetches up to MAX_REBELS.
export const REBELS_PAGE_SIZE = 50;
const MAX_REBELS = 1000;

type LoyaltyState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; data: SenatorRebels };

interface SenatorLoyaltyProps {
  senator: Senator;
  scrutins: Scrutin[];
  onOpenScrutin: (scrutin: Scrutin) => void;
}

export default function SenatorLoyalty({ senator, scrutins, onOpenScrutin }: SenatorLoyaltyProps) {
  const former = senator.status === 'ANCIEN';
  const [state, setState] = useState<LoyaltyState>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const [limit, setLimit] = useState(REBELS_PAGE_SIZE);
  const [expanded, setExpanded] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const listId = useId();

  useEffect(() => {
    if (former) return;
    const controller = new AbortController();
    setMoreError(false);
    api.senatorRebels(senator.matricule, limit, controller.signal)
      .then(data => { if (!controller.signal.aborted) setState({ kind: 'ready', data }); })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Keep the figures already shown when only the longer list failed.
        if (limit > REBELS_PAGE_SIZE) setMoreError(true);
        else setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, [senator.matricule, former, limit, retry]);

  if (former) {
    return (
      <section className="senator-detail-section loyalty-block" aria-labelledby={`${listId}-title`}>
        <h3 className="senator-votes-history-title" id={`${listId}-title`}>Loyauté au groupe</h3>
        <p className="loyalty-message" role="status">Non calculée : les votes individuels ne sont chargés que pour les sénateurs en exercice.</p>
      </section>
    );
  }

  return (
    <section className="senator-detail-section loyalty-block" aria-labelledby={`${listId}-title`} aria-busy={state.kind === 'loading'}>
      <h3 className="senator-votes-history-title" id={`${listId}-title`}>Loyauté au groupe</h3>
      {state.kind === 'loading' && (
        <div className="senator-detail-loading"><div className="loading-spinner" /><span>Calcul de la loyauté…</span></div>
      )}
      {state.kind === 'error' && (
        <div className="loyalty-message" role="alert">
          Impossible de charger la loyauté au groupe.
          <button className="btn-secondary" type="button" onClick={() => { setState({ kind: 'loading' }); setRetry(n => n + 1); }}>Réessayer</button>
        </div>
      )}
      {state.kind === 'ready' && (
        <LoyaltySummary
          data={state.data}
          listId={listId}
          expanded={expanded}
          moreError={moreError}
          onToggle={() => setExpanded(open => !open)}
          onShowAll={() => setLimit(Math.min(MAX_REBELS, state.data.total))}
          scrutins={scrutins}
          onOpenScrutin={onOpenScrutin}
        />
      )}
      <details className="loyalty-definition">
        <summary>Méthode et limites</summary>
        <p>{LOYALTY_DEFINITION}</p>
        <p>{LOYALTY_COVERAGE_NOTE}</p>
      </details>
    </section>
  );
}

interface LoyaltySummaryProps {
  data: SenatorRebels;
  listId: string;
  expanded: boolean;
  moreError: boolean;
  onToggle: () => void;
  onShowAll: () => void;
  scrutins: Scrutin[];
  onOpenScrutin: (scrutin: Scrutin) => void;
}

function LoyaltySummary({ data, listId, expanded, moreError, onToggle, onShowAll, scrutins, onOpenScrutin }: LoyaltySummaryProps) {
  const counted = data.follows + data.rebels;
  if (counted === 0) {
    return (
      <p className="loyalty-message" role="status">
        Aucun vote comparable : la loyauté n’est mesurée que pour les votes émis au sein d’un groupe
        (hors non-inscrits) comptant au moins {data.minGroupVoters} positions exprimées.
      </p>
    );
  }
  const tone = loyaltyTone(data.loyalty);
  const shown = data.items.length;

  return (
    <>
      <div className="loyalty-summary">
        <div className={`loyalty-score tone-${tone}`}>
          <span className="loyalty-score-value">{formatLoyalty(data.loyalty)}</span>
          <span className="loyalty-score-label">des votes alignés sur le groupe</span>
        </div>
        <div className="loyalty-summary-details">
          <div className="loyalty-bar" role="img" aria-label={`Loyauté : ${formatLoyalty(data.loyalty)}`}>
            <span className={`loyalty-bar-fill tone-${tone}`} style={{ width: `${data.loyalty ?? 0}%` }} />
          </div>
          <p className="loyalty-counts">
            <strong>{data.follows.toLocaleString('fr-FR')}</strong> votes alignés · <strong>{data.rebels.toLocaleString('fr-FR')}</strong> écart{data.rebels === 1 ? '' : 's'} sur {counted.toLocaleString('fr-FR')} votes comparés
            {data.ties > 0 && <> · {data.ties.toLocaleString('fr-FR')} sans majorité de groupe (non comptés)</>}
          </p>
          {data.group && data.groupAvgLoyalty !== null && (
            <p className="loyalty-counts">Moyenne du groupe {data.group} : <strong>{formatLoyalty(data.groupAvgLoyalty)}</strong></p>
          )}
          {!data.ranked && (
            <p className="loyalty-caveat">Échantillon limité (moins de {data.minRankedVotes} votes comparés) : indicateur peu significatif.</p>
          )}
        </div>
      </div>

      {data.total > 0 && (
        <div className="loyalty-rebels">
          <button className="loyalty-toggle" type="button" aria-expanded={expanded} aria-controls={listId} onClick={onToggle}>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m7.5 5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {expanded ? 'Masquer' : 'Voir'} les votes contre la ligne du groupe ({data.total.toLocaleString('fr-FR')})
          </button>
          <div id={listId} hidden={!expanded}>
            {expanded && (
              <>
                <p className="senator-history-hint loyalty-list-hint">Les plus récents d’abord · cliquez sur un vote pour afficher le scrutin</p>
                <div className="senator-history-list loyalty-rebel-list">
                  {data.items.map(item => (
                    <RebelRow
                      key={`${item.scrutinSession}-${item.scrutinNumber}`}
                      item={item}
                      scrutin={findScrutin(scrutins, item.scrutinSession, item.scrutinNumber) || null}
                      onOpen={onOpenScrutin}
                    />
                  ))}
                </div>
                {moreError && <p className="history-load-error" role="alert">Impossible de charger la liste complète.</p>}
                {shown < data.total && shown < MAX_REBELS && (
                  <div className="senator-history-more">
                    <button className="btn-secondary" type="button" onClick={onShowAll}>
                      Tout afficher ({shown} sur {data.total.toLocaleString('fr-FR')})
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function RebelRow({ item, scrutin, onOpen }: { item: RebelVote; scrutin: Scrutin | null; onOpen: (scrutin: Scrutin) => void }) {
  const tally = `${item.groupPour} pour · ${item.groupContre} contre · ${item.groupAbstention} abst.`;
  const notes = [item.specialStatus, item.delegatedBy ? `Délégation de ${item.delegatedBy}` : null].filter(Boolean);
  const content = (
    <>
      <span className="loyalty-rebel-positions">
        <span className={`history-vote-badge ${item.vote}`} title="Son vote">{positionLabel(item.vote)}</span>
        <span className="loyalty-rebel-vs" aria-hidden="true">vs</span>
        <span className={`loyalty-group-position ${item.groupPosition}`} title={`Majorité du groupe ${item.group} : ${tally}`}>
          {item.group} : {positionLabel(item.groupPosition)}
        </span>
      </span>
      <span className="history-scrutin-info">
        <span className="history-scrutin-meta">
          <span className={`history-result ${item.scrutinResult === 'adopté' ? 'adopté' : 'rejeté'}`}>{item.scrutinResult}</span>
          <span className="history-meta-divider" aria-hidden="true">·</span>
          <span className="history-scrutin-num">Scrutin n°{item.scrutinNumber}</span>
        </span>
        <span className="history-scrutin-title">{item.scrutinTitle}</span>
        <span className="history-vote-note">Groupe {item.group} : {tally}{notes.length > 0 && ` · ${notes.join(' · ')}`}</span>
      </span>
      <span className="history-scrutin-date">{formatDate(item.scrutinDate) || '—'}</span>
    </>
  );
  const label = `Son vote : ${positionLabel(item.vote)}, majorité du groupe : ${positionLabel(item.groupPosition)}`;
  return scrutin ? (
    <button type="button" className="history-vote-row history-vote-button loyalty-rebel-row" onClick={() => onOpen(scrutin)}
      aria-label={`Ouvrir le scrutin ${item.scrutinNumber}, session ${item.scrutinSession}. ${label}`}>
      {content}
    </button>
  ) : (
    <div className="history-vote-row loyalty-rebel-row">{content}</div>
  );
}
