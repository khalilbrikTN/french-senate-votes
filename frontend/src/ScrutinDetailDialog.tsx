import { useEffect, useMemo, useState } from 'react';
import AccessibleDialog from './components/AccessibleDialog';
import FilterDropdown from './components/FilterDropdown';
import { api } from './api/endpoints';
import { getGroupColor, getGroupName } from './lib/groups';
import { formatDate, formatSessionRange, getInitials } from './lib/format';
import { findVoterSenator, voteNotes } from './lib/senators';
import { safeExternalUrl } from './lib/links';
import type { Position, Scrutin, ScrutinDetail, Senator, Stats, Voter } from './types';

interface ScrutinDetailDialogProps {
  scrutin: Scrutin;
  senators: Senator[];
  stats: Stats | null;
  onClose: () => void;
  onOpenSenator: (senator: Senator) => void;
  onOpenPhoto?: (src: string, name: string) => void;
}

type DetailState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; detail: ScrutinDetail };

const VOTE_TABS: Array<{ value: Position; label: string; className: string }> = [
  { value: 'pour', label: 'Pour', className: 'pour' },
  { value: 'contre', label: 'Contre', className: 'contre' },
  { value: 'abstention', label: 'Abstentions', className: 'abstention' },
  { value: 'non_votant', label: 'Non-votants', className: 'non_votant' },
];

const VOTE_ICONS: Record<Position, string> = {
  pour: '✓',
  contre: '✗',
  abstention: '∅',
  non_votant: '—',
};

export default function ScrutinDetailDialog({ scrutin, senators, stats, onClose, onOpenSenator, onOpenPhoto = () => undefined }: ScrutinDetailDialogProps) {
  const [detailState, setDetailState] = useState<DetailState>({ kind: 'loading' });
  const [selectedPosition, setSelectedPosition] = useState<Position>('pour');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setDetailState({ kind: 'loading' });

    api.scrutinDetail(scrutin.session, scrutin.number, controller.signal)
      .then(detail => {
        if (!controller.signal.aborted) setDetailState({ kind: 'ready', detail });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setDetailState({
          kind: 'error',
          message: error instanceof Error && error.message.startsWith('HTTP ')
            ? `Le serveur a répondu avec une erreur (${error.message.slice(5)}).`
            : 'Impossible de charger les votes nominatifs. Vérifiez la connexion puis réessayez.',
        });
      });

    return () => controller.abort();
  }, [scrutin.session, scrutin.number, retryCount]);

  const totalVotes = scrutin.pour + scrutin.contre + scrutin.abstention;
  const displayedTotal = scrutin.total || totalVotes;
  const percentages = {
    pour: percentage(scrutin.pour, totalVotes),
    contre: percentage(scrutin.contre, totalVotes),
    abstention: percentage(scrutin.abstention, totalVotes),
  };
  const adopted = scrutin.result === 'adopté';
  const officialUrl = safeExternalUrl(scrutin.url);

  return (
    <AccessibleDialog labelledBy="scrutin-dialog-title" onClose={onClose}>
      <div className="modal-content">
        <div className="modal-header">
          <div className="modal-badge-row">
            <div className="card-number">Scrutin public n°{scrutin.number}</div>
            <span className={`result-badge ${adopted ? 'adopté' : 'rejeté'}`}>{adopted ? '✓ Adopté' : '✗ Rejeté'}</span>
            <span className="result-badge unknown scrutin-source-badge">Données officielles sénat.fr</span>
          </div>
          <h2 className="modal-title" id="scrutin-dialog-title">{scrutin.title || '(sans titre)'}</h2>
          <div className="modal-meta">
            <div className="modal-meta-item"><CalendarIcon />{formatDate(scrutin.date) || scrutin.date || '—'}</div>
            <div className="modal-meta-item"><SessionIcon />Session {formatSessionRange(scrutin.session) || scrutin.session || '—'}</div>
            <div className="modal-meta-item"><PeopleIcon />{displayedTotal.toLocaleString('fr-FR')} votants</div>
          </div>
        </div>

        <section className="modal-vote-summary" aria-label="Résultats officiels du vote">
          <div className="vote-summary-title">Résultats officiels du vote</div>
          <div className="vote-summary-grid">
            <SummaryItem value={scrutin.pour} label={`Pour (${percentages.pour}%)`} className="pour" />
            <SummaryItem value={scrutin.contre} label={`Contre (${percentages.contre}%)`} className="contre" />
            <SummaryItem value={scrutin.abstention} label={`Abstentions (${percentages.abstention}%)`} className="abstention" />
            <SummaryItem value={displayedTotal} label="Votants" className="total" />
          </div>
          <div className="vote-big-bar" role="img" aria-label={`Pour ${percentages.pour}%, contre ${percentages.contre}%, abstentions ${percentages.abstention}%`}>
            <div className="vote-big-bar-pour" style={{ width: `${percentages.pour}%` }} />
            <div className="vote-big-bar-contre" style={{ width: `${percentages.contre}%` }} />
            <div className="vote-big-bar-abstention" style={{ width: `${percentages.abstention}%` }} />
          </div>
        </section>

        {scrutin.groups.length > 0 && (
          <section className="modal-section">
            <h3 className="modal-section-title">Votes ventilés par groupe politique</h3>
            <div className="groups-list">
              {scrutin.groups.map(group => {
                const groupTotal = group.pour + group.contre + group.abstention;
                const pourPercent = Number(percentage(group.pour, groupTotal));
                const contrePercent = Number(percentage(group.contre, groupTotal));
                const color = getGroupColor(group.code, stats);
                return (
                  <div className="group-row" key={group.code}>
                    <span className="group-dot" style={{ background: color }} />
                    <span className="group-name" title={group.name || group.code}>{group.name || group.code}</span>
                    <div className="group-bar" role="img" aria-label={`${pourPercent}% pour et ${contrePercent}% contre`}>
                      <div className="group-bar-pour" style={{ width: `${pourPercent}%`, background: color }} />
                      <div className="group-bar-contre" style={{ width: `${100 - pourPercent}%` }} />
                    </div>
                    <div className="group-votes">
                      {group.pour > 0 && <span className="group-vote-item pour">✓ {group.pour}</span>}
                      {group.contre > 0 && <span className="group-vote-item contre">✗ {group.contre}</span>}
                      {group.abstention > 0 && <span className="group-vote-item abstention">∅ {group.abstention}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="modal-section" aria-live="polite" aria-busy={detailState.kind === 'loading'}>
          <h3 className="modal-section-title">Votes nominatifs</h3>
          {detailState.kind === 'loading' && (
            <div className="loading-state modal-detail-loading"><div className="loading-spinner" /><p>Chargement des votes nominatifs…</p></div>
          )}
          {detailState.kind === 'error' && (
            <div className="voters-scope-note" role="alert">
              <p>{detailState.message}</p>
              <button className="btn-secondary" type="button" onClick={() => setRetryCount(count => count + 1)}>Réessayer</button>
            </div>
          )}
          {detailState.kind === 'ready' && (
            <VoterDetails
              detail={detailState.detail}
              senators={senators}
              stats={stats}
              selectedPosition={selectedPosition}
              onSelectPosition={setSelectedPosition}
              onOpenSenator={onOpenSenator}
              onOpenPhoto={onOpenPhoto}
            />
          )}
        </section>

        {officialUrl ? (
          <a href={officialUrl} target="_blank" rel="noopener noreferrer" className="modal-link">
            <ExternalLinkIcon />Consulter ce scrutin sur senat.fr
          </a>
        ) : (
          <span className="modal-link is-disabled" aria-disabled="true">Fiche officielle indisponible</span>
        )}
      </div>
    </AccessibleDialog>
  );
}

function VoterDetails({
  detail,
  senators,
  stats,
  selectedPosition,
  onSelectPosition,
  onOpenSenator,
  onOpenPhoto,
}: {
  detail: ScrutinDetail;
  senators: Senator[];
  stats: Stats | null;
  selectedPosition: Position;
  onSelectPosition: (position: Position) => void;
  onOpenSenator: (senator: Senator) => void;
  onOpenPhoto: (src: string, name: string) => void;
}) {
  // The search and group filter combine and stay in place across the position tabs; they
  // reset only when this scrutin is left (the dialog is remounted for each scrutin).
  const [voterSearch, setVoterSearch] = useState('');
  const [voterGroupFilter, setVoterGroupFilter] = useState('all');
  const corrections = detail.corrections || [];
  const voterList = detail.senateurs?.[selectedPosition] || [];
  const filtersActive = voterSearch.trim() !== '' || voterGroupFilter !== 'all';

  // Every group present in this scrutin, so a chosen group stays selectable in any tab.
  const groupOptions = useMemo(() => {
    const voterGroup = (voter: Voter) => voter.group?.trim() || findVoterSenator(senators, voter)?.group || 'NI';
    const counts = new Map<string, number>();
    VOTE_TABS.forEach(tab => (detail.senateurs?.[tab.value] || []).forEach(voter => counts.set(voterGroup(voter), 0)));
    voterList.forEach(voter => {
      const code = voterGroup(voter);
      counts.set(code, (counts.get(code) || 0) + 1);
    });
    return [
      { value: 'all', label: 'Tous les groupes', hint: 'Dans cette position de vote' },
      ...[...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right, 'fr'))
        .map(([code, count]) => ({
          value: code,
          label: getGroupName(code),
          badge: code,
          hint: `${count.toLocaleString('fr-FR')} sénateur${count === 1 ? '' : 's'} dans cette position`,
        })),
    ];
  }, [detail, voterList, senators]);

  const normalizedSearch = voterSearch.trim().toLocaleLowerCase('fr-FR');
  const matchesFilters = (voter: Voter) => {
    const senator = findVoterSenator(senators, voter);
    const groupCode = voter.group?.trim() || senator?.group || 'NI';
    if (voterGroupFilter !== 'all' && groupCode !== voterGroupFilter) return false;
    if (!normalizedSearch) return true;
    const groupName = getGroupName(groupCode, senator?.groupFullName);
    return [voter.name, groupCode, groupName]
      .some(value => value.toLocaleLowerCase('fr-FR').includes(normalizedSearch));
  };
  const filteredVoters = voterList.filter(matchesFilters);

  return (
    <>
      {detail.listedVoters === 0 ? (
        <p className="voters-scope-note">Aucun vote individuel chargé pour ce scrutin : seuls les votes des sénateurs actuellement en exercice sont disponibles.</p>
      ) : (
        <>
          <p className="voters-scope-note">
            {detail.listedVoters.toLocaleString('fr-FR')} sénateurs en exercice aujourd’hui figurent dans ce scrutin. Les autres votants ne sont pas chargés, la liste est donc partielle.
          </p>
          <div className="vote-tabs" role="group" aria-label="Filtrer les votes nominatifs">
            {VOTE_TABS.map(tab => {
              const selected = selectedPosition === tab.value;
              const voters = detail.senateurs?.[tab.value] || [];
              // With active filters, each tab counts the senators that match them in that position.
              const count = filtersActive ? voters.filter(matchesFilters).length : voters.length;
              return (
                <button
                  className={`vote-tab ${tab.className}${selected ? ' active' : ''}`}
                  key={tab.value}
                  type="button"
                  aria-pressed={selected}
                  title={filtersActive ? `${count} sur ${voters.length} correspondent aux filtres` : undefined}
                  onClick={() => onSelectPosition(tab.value)}
                >
                  {tab.label} <span className="vote-tab-count">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="voter-filter-toolbar">
            <label className="voter-filter-search-field" htmlFor="voter-name-search">
              <span>Rechercher un sénateur</span>
              <span className="voter-filter-search-control">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></svg>
                <input
                  id="voter-name-search"
                  type="search"
                  placeholder="Saisir un nom ou un groupe"
                  value={voterSearch}
                  onChange={event => setVoterSearch(event.target.value)}
                />
              </span>
            </label>
            <FilterDropdown
              id="voter-group-filter"
              label="Groupe politique"
              value={voterGroupFilter}
              options={groupOptions}
              onChange={setVoterGroupFilter}
              className="voter-filter-select-field"
            />
          </div>
          <p className="voter-filter-results" role="status" aria-live="polite">
            {filteredVoters.length.toLocaleString('fr-FR')} sénateur{filteredVoters.length === 1 ? '' : 's'} affiché{filteredVoters.length === 1 ? '' : 's'}
          </p>
          <div className="senators-list">
            {filteredVoters.length > 0 ? filteredVoters.map(voter => (
              <VoterRow
                key={`${selectedPosition}-${voter.id || voter.name}`}
                voter={voter}
                position={selectedPosition}
                senator={findVoterSenator(senators, voter)}
                stats={stats}
                onOpenSenator={onOpenSenator}
                onOpenPhoto={onOpenPhoto}
              />
            )) : (
              <div className="voter-list-empty">
                {voterList.length === 0
                  ? 'Aucun sénateur enregistré dans cette position'
                  : 'Aucun sénateur ne correspond à ces critères'}
              </div>
            )}
          </div>
        </>
      )}

      {corrections.length > 0 && (
        <section className="modal-section">
          <h4 className="modal-section-title">Mises au point après le vote</h4>
          <ul className="vote-corrections">
            {corrections.map((correction, index) => {
              const url = safeExternalUrl(correction.url);
              return (
                <li key={`${index}-${correction.text}`}>
                  {correction.text}{url && <> <a href={url} target="_blank" rel="noopener noreferrer">compte rendu</a></>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

function VoterRow({
  voter,
  position,
  senator,
  stats,
  onOpenSenator,
  onOpenPhoto,
}: {
  voter: Voter;
  position: Position;
  senator: Senator | null;
  stats: Stats | null;
  onOpenSenator: (senator: Senator) => void;
  onOpenPhoto: (src: string, name: string) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const color = getGroupColor(voter.group || senator?.group || 'NI', stats);
  const notes = voteNotes(voter);

  const content = (
    <>
      <span
        className={`senator-avatar${senator?.avatar && !imageFailed ? ' voter-photo-trigger' : ''}`}
        style={{ background: `${color}20`, color, borderColor: `${color}44` }}
        title={senator?.avatar && !imageFailed ? `Agrandir le portrait de ${voter.name}` : undefined}
        onClick={event => {
          if (!senator?.avatar || imageFailed) return;
          event.stopPropagation();
          onOpenPhoto(senator.avatar, voter.name);
        }}
      >
        {senator?.avatar && !imageFailed ? (
          <img src={senator.avatar} alt="" className="voter-photo-img" onError={() => setImageFailed(true)} />
        ) : getInitials(voter.name)}
      </span>
      <span className="senator-info">
        <span className="senator-name">{voter.name}{voter.hasCorrection ? ' *' : ''}</span>
        <span className="senator-group" style={{ color }}>{voter.group || senator?.group || 'NI'}</span>
        {notes.length > 0 && <span className="voter-note">{notes.join(' · ')}</span>}
      </span>
      <span className="vote-icon" aria-label={positionLabel(position)}>{VOTE_ICONS[position]}</span>
    </>
  );

  return senator ? (
    <button className="senator-item voter-item-button" type="button" title={`Voir la fiche de ${voter.name}`} onClick={() => onOpenSenator(senator)}>
      {content}
    </button>
  ) : (
    <div className="senator-item">
      {content}
    </div>
  );
}

function SummaryItem({ value, label, className }: { value: number; label: string; className: string }) {
  return <div className="vote-summary-item"><div className={`vote-summary-num ${className}`}>{value.toLocaleString('fr-FR')}</div><div className="vote-summary-label">{label}</div></div>;
}

function percentage(value: number, total: number): string {
  return total > 0 ? (value / total * 100).toFixed(1) : '0.0';
}

function positionLabel(position: Position): string {
  return VOTE_TABS.find(tab => tab.value === position)?.label || position;
}

function CalendarIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
}

function SessionIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
}

function PeopleIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
}

function ExternalLinkIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>;
}
