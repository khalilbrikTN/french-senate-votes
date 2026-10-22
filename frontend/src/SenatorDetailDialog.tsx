import { useEffect, useRef, useState } from 'react';
import AccessibleDialog from './components/AccessibleDialog';
import SenatorVoteChart from './components/SenatorVoteChart';
import SenatorCompare from './components/SenatorCompare';
import ShareButton from './components/ShareButton';
import SenatorLoyalty from './components/SenatorLoyalty';
import { api } from './api/endpoints';
import { SENATE_GROUP_CODE_ALIASES } from './data/politicalGroups';
import { careerPeriodLabel, cleanGroupMemberships } from './lib/career';
import { formatDate, getInitials } from './lib/format';
import { getGroupColor, getGroupName } from './lib/groups';
import { safeExternalUrl } from './lib/links';
import { formerSenatorLabel, formerTag, isFormerSenator, recordedNonVoterCount, senatorGroupLabel, senatorTitle, socialLinks, voteNotes } from './lib/senators';
import { findScrutin } from './lib/scrutins';
import { senatorHash } from './lib/routes';
import type { GroupMembership, HistoryItem, Senator, SenatorVotesPage, Scrutin, Stats } from './types';

interface SenatorDetailDialogProps {
  senator: Senator;
  scrutins: Scrutin[];
  stats: Stats | null;
  onClose: () => void;
  onOpenScrutin: (scrutin: Scrutin) => void;
  onOpenPhoto?: (src: string, name: string) => void;
}

const HISTORY_PAGE_SIZE = 50;

type HistoryState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; total: number; items: HistoryItem[] };

type CareerState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; memberships: GroupMembership[] };

export default function SenatorDetailDialog({ senator, scrutins, stats, onClose, onOpenScrutin, onOpenPhoto = () => undefined }: SenatorDetailDialogProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [historyState, setHistoryState] = useState<HistoryState>({ kind: 'loading' });
  const [historyRetry, setHistoryRetry] = useState(0);
  const [moreState, setMoreState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [careerState, setCareerState] = useState<CareerState>({ kind: 'loading' });
  const [careerRetry, setCareerRetry] = useState(0);
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setHistoryState({ kind: 'loading' });
    setMoreState('idle');

    api.senatorVotes(senator.matricule, 0, HISTORY_PAGE_SIZE, controller.signal)
      .then(page => {
        if (!controller.signal.aborted) setHistoryState(historyFromPage(page));
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setHistoryState({
          kind: 'error',
          message: error instanceof Error && error.message.startsWith('HTTP ')
            ? `Le serveur a répondu avec une erreur (${error.message.slice(5)}).`
            : 'Impossible de charger l’historique des votes.',
        });
      });

    return () => controller.abort();
  }, [senator.matricule, historyRetry]);

  useEffect(() => {
    const controller = new AbortController();
    setCareerState({ kind: 'loading' });

    api.senatorDetail(senator.matricule, controller.signal)
      .then(detail => {
        if (!controller.signal.aborted) setCareerState({ kind: 'ready', memberships: cleanGroupMemberships(detail.group_memberships || []) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setCareerState({ kind: 'error' });
      });

    return () => controller.abort();
  }, [senator.matricule, careerRetry]);

  useEffect(() => () => moreController.current?.abort(), []);

  async function loadMoreHistory() {
    if (historyState.kind !== 'ready' || moreState === 'loading' || historyState.items.length >= historyState.total) return;
    moreController.current?.abort();
    const controller = new AbortController();
    moreController.current = controller;
    const offset = historyState.items.length;
    setMoreState('loading');

    try {
      const page = await api.senatorVotes(senator.matricule, offset, HISTORY_PAGE_SIZE, controller.signal);
      if (controller.signal.aborted) return;
      setHistoryState(current => current.kind === 'ready'
        ? { kind: 'ready', total: page.total, items: [...current.items, ...page.items] }
        : current);
      setMoreState('idle');
    } catch {
      if (!controller.signal.aborted) setMoreState('error');
    }
  }

  const former = isFormerSenator(senator);
  const color = getGroupColor(senator.group, stats);
  const groupName = getGroupName(senator.group, senator.groupFullName);
  const voteStats = senator.stats || { pour: 0, contre: 0, abstention: 0, total: 0 };
  const nonVoterCount = recordedNonVoterCount(voteStats);
  const recordedPositionTotal = voteStats.total + (nonVoterCount ?? 0);
  const positionShare = (value: number) => recordedPositionTotal > 0
    ? `${(value / recordedPositionTotal * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % des positions`
    : null;
  const officialUrl = safeExternalUrl(senator.url);

  return (
    <AccessibleDialog labelledBy="senator-dialog-title" onClose={onClose}>
      <div className="modal-content">
        <div className="senator-profile-header">
          {senator.avatar && !imageFailed ? (
            <button
              className="senator-profile-avatar senator-photo-trigger"
              type="button"
              aria-label={`Agrandir la photo de ${senator.name}`}
              title={`Agrandir la photo de ${senator.name}`}
              style={{ borderColor: `${color}66`, color }}
              onClick={() => onOpenPhoto(senator.avatar!, senator.name)}
            >
              <img src={senator.avatar} alt="" decoding="async" onError={() => setImageFailed(true)} />
            </button>
          ) : (
            <div className="senator-profile-avatar" style={{ borderColor: `${color}66`, color }}>
              {getInitials(senator.name)}
            </div>
          )}
          <div className="senator-profile-info">
            <h2 className="senator-profile-name" id="senator-dialog-title">{senator.name}</h2>
            <div className="senator-profile-group" style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>
              <span className="senator-profile-group-dot" style={{ background: color }} />
              {former ? senatorGroupLabel(senator, groupName) : `Groupe ${senatorGroupLabel(senator, groupName)}`}
            </div>
            {former ? (
              <div className="senator-profile-status"><span className="senator-former-tag">{formerTag(senator)}</span>{formerSenatorLabel(senator)}</div>
            ) : (
              <div className="senator-profile-status">{senatorTitle(senator)} en exercice</div>
            )}
            <div className="senator-profile-dept">
              <LocationIcon />
              <span className="senator-profile-detail-text">
                {senator.dept || 'Sénat'}{!former && <> · <span className="senator-profile-commission">{senator.commission || 'Sénat'}</span></>}
              </span>
            </div>
            <div className="senator-profile-dept senator-profile-profession">
              <BriefcaseIcon />
              <span className="senator-profile-detail-text">
                {senator.profession || <span className="senator-profile-muted">Profession non renseignée</span>}
              </span>
            </div>
            {officialUrl ? (
              <div className="senator-official-link-row"><a href={officialUrl} target="_blank" rel="noopener noreferrer" className="modal-link senator-official-link" aria-label="Consulter la fiche officielle sur senat.fr" title="Fiche officielle sur senat.fr"><ExternalLinkIcon />Fiche Sénat</a><ShareButton hash={senatorHash(senator)} title={senator.name} className="modal-link senator-official-link" /></div>
            ) : (
              <div className="senator-official-link-row"><span className="modal-link senator-official-link is-disabled" aria-disabled="true" title="Pas de fiche officielle sur senat.fr">Fiche indisponible</span><ShareButton hash={senatorHash(senator)} title={senator.name} className="modal-link senator-official-link" /></div>
            )}
            {socialLinks(senator).length > 0 && (
              <div className="senator-social-links" aria-label="Réseaux sociaux">
                {socialLinks(senator).map(link => (
                  <a className="senator-social-link" href={link.url} key={link.network} target="_blank" rel="noopener noreferrer">
                    {link.label === link.network ? link.network : `${link.network} ${link.label}`}
                  </a>
                ))}
              </div>
            )}
          </div>
          <SenatorVoteChart stats={voteStats} />
        </div>

        <div className="senator-detail-metrics" aria-label="Statistiques de votes">
          <Metric value={voteStats.total} label="Votes exprimés" kind="total" />
          <Metric value={voteStats.pour} label="Pour" share={positionShare(voteStats.pour)} kind="pour" />
          <Metric value={voteStats.contre} label="Contre" share={positionShare(voteStats.contre)} kind="contre" />
          <Metric value={voteStats.abstention} label="Abstention" share={positionShare(voteStats.abstention)} kind="abstention" />
          <Metric value={nonVoterCount} label="Non-votants enregistrés" share={nonVoterCount === null ? null : positionShare(nonVoterCount)} kind="non-votant" />
        </div>
        <p className="senator-nonvoter-note">
          Ce nombre correspond aux scrutins où la position « non-votant » a été enregistrée. Les absences sans enregistrement ne sont pas comptées.
        </p>

        <SenatorLoyalty senator={senator} scrutins={scrutins} onOpenScrutin={onOpenScrutin} />

        <section className="senator-detail-section" aria-live="polite" aria-busy={careerState.kind === 'loading'}>
          <h3 className="senator-votes-history-title">Parcours politique</h3>
          <CareerTimeline state={careerState} stats={stats} onRetry={() => setCareerRetry(value => value + 1)} />
        </section>

        <SenatorCompare senator={senator} scrutins={scrutins} stats={stats} onOpenScrutin={onOpenScrutin} />

        <section className="senator-detail-section" aria-live="polite" aria-busy={historyState.kind === 'loading'}>
          <div className="senator-votes-history-title">
            <span>Historique des votes officiels ({historyState.kind === 'ready' ? historyState.total.toLocaleString('fr-FR') : historyState.kind === 'loading' ? '…' : '—'})</span>
            <span className="senator-history-hint">Cliquez sur un vote pour afficher le scrutin</span>
          </div>
          {historyState.kind === 'loading' && <LoadingMessage label="Chargement de l’historique…" />}
          {historyState.kind === 'error' && (
            <div className="senator-detail-message" role="alert">
              {historyState.message}
              <button className="btn-secondary" type="button" onClick={() => setHistoryRetry(value => value + 1)}>Réessayer</button>
            </div>
          )}
          {historyState.kind === 'ready' && historyState.total === 0 && (
            <div className="senator-detail-message" role="status">
              {former
                ? 'Les votes individuels ne sont chargés que pour les sénateurs en exercice.'
                : 'Aucun vote individuel enregistré pour ce sénateur.'}
            </div>
          )}
          {historyState.kind === 'ready' && historyState.total > 0 && (
            <>
              <div className="senator-history-list">
                {historyState.items.map((item, index) => {
                  const scrutin = findScrutin(scrutins, item.scrutinSession, item.scrutinNumber) || null;
                  return (
                    <HistoryRow
                      key={`${item.scrutinSession}-${item.scrutinNumber}-${index}`}
                      item={item}
                      scrutin={scrutin}
                      onOpen={onOpenScrutin}
                    />
                  );
                })}
              </div>
              {moreState === 'error' && <p className="history-load-error" role="alert">Impossible de charger plus de votes.</p>}
              {historyState.items.length < historyState.total && (
                <div className="senator-history-more">
                  <button className="btn-secondary" type="button" onClick={() => void loadMoreHistory()} disabled={moreState === 'loading'}>
                    {moreState === 'loading'
                      ? 'Chargement…'
                      : moreState === 'error'
                        ? `Réessayer (${historyState.items.length} sur ${historyState.total})`
                        : `Afficher plus (${historyState.items.length} sur ${historyState.total})`}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

      </div>
    </AccessibleDialog>
  );
}

function CareerTimeline({ state, stats, onRetry }: { state: CareerState; stats: Stats | null; onRetry: () => void }) {
  if (state.kind === 'loading') return <div className="senator-career"><LoadingMessage label="Chargement du parcours…" /></div>;
  if (state.kind === 'error') return <div className="senator-career senator-career-message" role="alert">Impossible de charger le parcours politique. <button className="btn-secondary" type="button" onClick={onRetry}>Réessayer</button></div>;
  if (!state.memberships.length) return <div className="senator-career senator-career-message" role="status">Aucune appartenance à un groupe enregistrée.</div>;

  return (
    <div className="senator-career">
      <ol className="senator-career-list">
        {state.memberships.map((membership, index) => {
          const displayCode = membership.group_code ? SENATE_GROUP_CODE_ALIASES[membership.group_code] || membership.group_code : 'NI';
          const color = getGroupColor(displayCode, stats);
          const exactPeriod = `${membership.start_date ? formatDate(membership.start_date) : 'début non renseigné'} → ${membership.end_date ? formatDate(membership.end_date) : 'en cours'}`;
          return (
            <li className="senator-career-item" title={exactPeriod} key={`${membership.group_code}-${membership.start_date}-${index}`}>
              <span className="senator-career-dot" style={{ background: color }} />
              <span className="senator-career-code" style={{ background: `${color}20`, color, borderColor: `${color}40` }}>{membership.group_code || 'NI'}</span>
              <span className="senator-career-name">{membership.group_name || membership.group_code || 'Non-inscrit'}</span>
              <span className="senator-career-years">{careerPeriodLabel(membership)}</span>
            </li>
          );
        })}
      </ol>
      <div className="senator-career-note">Les noms sont les noms actuels des groupes, tels que publiés par le Sénat pour chaque code.</div>
    </div>
  );
}

function HistoryRow({ item, scrutin, onOpen }: { item: HistoryItem; scrutin: Scrutin | null; onOpen: (scrutin: Scrutin) => void }) {
  const [badgeClass, badgeLabel] = voteBadge(item.vote);
  const resultClass = item.scrutinResult === 'adopté' ? 'adopté' : 'rejeté';
  const notes = voteNotes(item);
  const content = (
    <>
      <span className={`history-vote-badge ${badgeClass}`}>{badgeLabel}</span>
      <span className="history-scrutin-info">
        <span className="history-scrutin-meta">
          <span className={`history-result ${resultClass}`}>{item.scrutinResult}</span>
          <span className="history-meta-divider" aria-hidden="true">·</span>
          <span className="history-scrutin-num">Scrutin n°{item.scrutinNumber}</span>
        </span>
        <span className="history-scrutin-title">{item.scrutinTitle}</span>
        {notes.length > 0 && <span className="history-vote-note">{notes.join(' · ')}</span>}
      </span>
      <span className="history-scrutin-date">{formatDate(item.scrutinDate) || '—'}</span>
    </>
  );

  return scrutin ? (
    <button type="button" className="history-vote-row history-vote-button" onClick={() => onOpen(scrutin)} aria-label={`Ouvrir le scrutin ${item.scrutinNumber}, session ${item.scrutinSession}`}>
      {content}
    </button>
  ) : (
    <div className="history-vote-row">{content}</div>
  );
}

function historyFromPage(page: SenatorVotesPage): HistoryState {
  return { kind: 'ready', total: page.total, items: page.items };
}

function voteBadge(vote: HistoryItem['vote']): [string, string] {
  switch (vote) {
    case 'pour': return ['pour', '✓ Pour'];
    case 'contre': return ['contre', '✗ Contre'];
    case 'abstention': return ['abstention', '∅ Abs.'];
    case 'non_votant': return ['non-votant', '— N.V.'];
  }
}

function Metric({ value, label, share, kind }: { value: number | null; label: string; share?: string | null; kind: string }) {
  return (
    <div className={`senator-metric-box ${kind}`}>
      <div className="senator-metric-val">{value === null ? '—' : value.toLocaleString('fr-FR')}</div>
      <div className="senator-metric-label">{label}</div>
      {share && <small className="senator-metric-share">{share}</small>}
    </div>
  );
}

function LoadingMessage({ label }: { label: string }) {
  return <div className="senator-detail-loading"><div className="loading-spinner" /><span>{label}</span></div>;
}

function LocationIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></svg>;
}

function BriefcaseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>;
}

function ExternalLinkIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>;
}
