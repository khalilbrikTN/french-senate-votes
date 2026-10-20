import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { api } from '../api/endpoints';
import { breakdownSegments, compareCandidates, formatAgreement, positionLabel } from '../lib/compare';
import { formatDate, getInitials } from '../lib/format';
import { getGroupColor } from '../lib/groups';
import { findScrutin } from '../lib/scrutins';
import type { CompareDisagreement, ExpressedPosition, Scrutin, Senator, SenatorComparison, Stats } from '../types';
import '../compare.css';

interface SenatorCompareProps {
  senator: Senator;
  scrutins: Scrutin[];
  stats: Stats | null;
  onOpenScrutin: (scrutin: Scrutin) => void;
  // Sitting senators to pick from; fetched on first use when not provided.
  senators?: Senator[];
}

type ListState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; senators: Senator[] };

type ResultState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; comparison: SenatorComparison };

const MAX_OPTIONS = 8;

// The sitting senators list is shared by every dialog opened during the visit.
let sittingSenatorsCache: Senator[] | null = null;

export function resetCompareSenatorsCache() {
  sittingSenatorsCache = null;
}

export default function SenatorCompare({ senator, scrutins, stats, onOpenScrutin, senators }: SenatorCompareProps) {
  const id = useId();
  const inputId = `${id}-input`;
  const listboxId = `${id}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [picked, setPicked] = useState<Senator | null>(null);
  const [listState, setListState] = useState<ListState>(() => {
    const initial = senators?.length ? senators : sittingSenatorsCache;
    return initial ? { kind: 'ready', senators: initial } : { kind: 'idle' };
  });
  const listController = useRef<AbortController | null>(null);
  const [resultState, setResultState] = useState<ResultState>({ kind: 'loading' });
  const [resultRetry, setResultRetry] = useState(0);
  const sitting = senator.status === 'ACTIF';

  useEffect(() => {
    if (senators?.length) setListState({ kind: 'ready', senators });
  }, [senators]);

  // Load the list of sitting senators the first time the picker is used.
  function ensureList() {
    if (listState.kind !== 'idle' && listState.kind !== 'error') return;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListState({ kind: 'loading' });
    api.senators(controller.signal)
      .then(list => {
        if (controller.signal.aborted) return;
        sittingSenatorsCache = list;
        setListState({ kind: 'ready', senators: list });
      })
      .catch(() => {
        if (!controller.signal.aborted) setListState({ kind: 'error' });
      });
  }
  useEffect(() => () => listController.current?.abort(), []);

  // Escape closes the suggestions (then clears the query) before it reaches the
  // dialog, whose native keydown listener would close the whole panel.
  const escapeState = useRef({ open: false, query: '' });
  escapeState.current = { open, query };
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const current = escapeState.current;
      if (!current.query) return;
      event.stopPropagation();
      event.preventDefault();
      if (current.open) setOpen(false);
      else setQuery('');
    };
    input.addEventListener('keydown', onKeyDown);
    return () => input.removeEventListener('keydown', onKeyDown);
  }, [sitting]);

  // One comparison request per picked senator; a newer pick aborts the previous request.
  useEffect(() => {
    if (!picked) return;
    const controller = new AbortController();
    setResultState({ kind: 'loading' });
    api.compareSenators(senator.matricule, picked.matricule, controller.signal)
      .then(comparison => {
        if (!controller.signal.aborted) setResultState({ kind: 'ready', comparison });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setResultState({
          kind: 'error',
          message: error instanceof Error && error.message.startsWith('HTTP ')
            ? `Le serveur a répondu avec une erreur (${error.message.slice(5)}).`
            : 'Impossible de charger la comparaison.',
        });
      });
    return () => controller.abort();
  }, [senator.matricule, picked, resultRetry]);

  const options = useMemo(
    () => listState.kind === 'ready' ? compareCandidates(listState.senators, query, senator.matricule, MAX_OPTIONS) : [],
    [listState, query, senator.matricule],
  );
  const showListbox = open && query.trim() !== '' && listState.kind === 'ready';
  const activeOption = showListbox ? options[Math.min(activeIndex, options.length - 1)] : undefined;

  function pick(candidate: Senator) {
    setPicked(candidate);
    setQuery('');
    setOpen(false);
    setActiveIndex(0);
  }

  function clearPick() {
    setPicked(null);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      if (options.length) setActiveIndex(index => (index + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (options.length) setActiveIndex(index => (index - 1 + options.length) % options.length);
    } else if (event.key === 'Enter') {
      if (activeOption) {
        event.preventDefault();
        pick(activeOption);
      }
    }
  }

  if (!sitting) {
    return (
      <section className="senator-detail-section cmp-section" aria-labelledby={`${id}-title`}>
        <h3 className="senator-votes-history-title" id={`${id}-title`}>Comparer avec un autre sénateur</h3>
        <p className="senator-detail-message cmp-note" role="status">
          La comparaison n’est disponible que pour les sénateurs en exercice : seuls leurs votes individuels sont chargés.
        </p>
      </section>
    );
  }

  return (
    <section className="senator-detail-section cmp-section" aria-labelledby={`${id}-title`}>
      <h3 className="senator-votes-history-title" id={`${id}-title`}>Comparer avec un autre sénateur</h3>

      <div className="cmp-picker">
        <label className="cmp-label" htmlFor={inputId}>
          {picked ? 'Choisir un autre sénateur' : 'Rechercher un sénateur en exercice'}
        </label>
        <div className="cmp-combobox">
          <SearchIcon />
          <input
            ref={inputRef}
            id={inputId}
            className="filter-input cmp-input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showListbox}
            aria-controls={listboxId}
            aria-activedescendant={activeOption ? `${id}-opt-${activeOption.matricule}` : undefined}
            aria-describedby={`${id}-hint`}
            value={query}
            placeholder="Nom, département ou groupe…"
            autoComplete="off"
            spellCheck={false}
            onChange={event => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); ensureList(); }}
            onFocus={() => { setOpen(true); ensureList(); }}
            onBlur={() => setOpen(false)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <span className="sr-only" id={`${id}-hint`}>Utilisez les flèches haut et bas pour parcourir les suggestions, puis Entrée pour choisir.</span>
        {showListbox && (
          <ul className="cmp-options" id={listboxId} role="listbox" aria-label="Sénateurs en exercice">
            {options.length === 0 ? (
              <li className="cmp-option-empty" role="presentation">Aucun sénateur en exercice ne correspond à « {query.trim()} »</li>
            ) : options.map(candidate => {
              const color = getGroupColor(candidate.group, stats);
              const active = candidate === activeOption;
              return (
                <li
                  key={candidate.matricule}
                  id={`${id}-opt-${candidate.matricule}`}
                  role="option"
                  aria-selected={active}
                  className={`cmp-option${active ? ' is-active' : ''}`}
                  onMouseDown={event => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(options.indexOf(candidate))}
                  onClick={() => pick(candidate)}
                >
                  <span className="cmp-option-avatar" style={{ color, borderColor: `${color}66` }} aria-hidden="true">{getInitials(candidate.name)}</span>
                  <span className="cmp-option-name">{candidate.name}</span>
                  <span className="cmp-option-meta">
                    <span className="cmp-option-group" style={{ color, background: `${color}20`, borderColor: `${color}40` }}>{candidate.group || 'NI'}</span>
                    {candidate.dept && <span className="cmp-option-dept">{candidate.dept}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {open && query.trim() !== '' && listState.kind === 'loading' && (
          <p className="cmp-picker-status" role="status">Chargement de la liste des sénateurs…</p>
        )}
        {listState.kind === 'error' && (
          <p className="cmp-picker-status" role="alert">
            Impossible de charger la liste des sénateurs.{' '}
            <button className="btn-secondary" type="button" onClick={ensureList}>Réessayer</button>
          </p>
        )}
      </div>

      <div aria-live="polite" aria-busy={picked !== null && resultState.kind === 'loading'}>
        {picked && (
          <CompareResult
            senator={senator}
            other={picked}
            state={resultState}
            scrutins={scrutins}
            stats={stats}
            onOpenScrutin={onOpenScrutin}
            onClear={clearPick}
            onRetry={() => setResultRetry(value => value + 1)}
          />
        )}
      </div>

      <p className="cmp-note">
        Seuls les votes individuels des sénateurs en exercice sont chargés (les sessions anciennes sont partielles) :
        l’accord est calculé sur les scrutins où les deux sénateurs ont voté pour, contre ou se sont abstenus.
      </p>
    </section>
  );
}

interface CompareResultProps {
  senator: Senator;
  other: Senator;
  state: ResultState;
  scrutins: Scrutin[];
  stats: Stats | null;
  onOpenScrutin: (scrutin: Scrutin) => void;
  onClear: () => void;
  onRetry: () => void;
}

function CompareResult({ senator, other, state, scrutins, stats, onOpenScrutin, onClear, onRetry }: CompareResultProps) {
  const otherColor = getGroupColor(other.group, stats);
  return (
    <div className="cmp-result">
      <div className="cmp-pair">
        <span className="cmp-pair-names">
          <strong>{senator.name}</strong>
          <span className="cmp-pair-vs" aria-hidden="true">vs</span>
          <span className="sr-only"> comparé à </span>
          <strong style={{ color: otherColor }}>{other.name}</strong>
          <span className="cmp-option-group" style={{ color: otherColor, background: `${otherColor}20`, borderColor: `${otherColor}40` }}>{other.group || 'NI'}</span>
        </span>
        <button className="btn-secondary cmp-clear" type="button" onClick={onClear} aria-label={`Retirer ${other.name} de la comparaison`}>Retirer</button>
      </div>

      {state.kind === 'loading' && (
        <div className="senator-detail-loading"><div className="loading-spinner" /><span>Comparaison des votes…</span></div>
      )}
      {state.kind === 'error' && (
        <div className="senator-detail-message" role="alert">
          {state.message}
          <button className="btn-secondary" type="button" onClick={onRetry}>Réessayer</button>
        </div>
      )}
      {state.kind === 'ready' && state.comparison.shared === 0 && (
        <div className="senator-detail-message cmp-empty" role="status">
          Aucun vote commun : {senator.name} et {other.name} n’ont jamais exprimé tous deux une position
          (pour, contre ou abstention) sur un même scrutin dans les données chargées.
        </div>
      )}
      {state.kind === 'ready' && state.comparison.shared > 0 && (
        <ComparisonDetails comparison={state.comparison} senator={senator} other={other} scrutins={scrutins} onOpenScrutin={onOpenScrutin} />
      )}
    </div>
  );
}

function ComparisonDetails({ comparison, senator, other, scrutins, onOpenScrutin }: {
  comparison: SenatorComparison; senator: Senator; other: Senator; scrutins: Scrutin[]; onOpenScrutin: (scrutin: Scrutin) => void;
}) {
  const segments = breakdownSegments(comparison);
  const disagreementTotal = comparison.breakdown.opposite + comparison.breakdown.oneAbstained;
  const period = comparison.firstDate && comparison.lastDate
    ? comparison.firstDate === comparison.lastDate
      ? `le ${formatDate(comparison.firstDate)}`
      : `du ${formatDate(comparison.firstDate)} au ${formatDate(comparison.lastDate)}`
    : null;

  return (
    <>
      <div className="cmp-headline">
        <div className="cmp-rate">
          <span className="cmp-rate-value">{formatAgreement(comparison.agreementRate)}</span>
          <span className="cmp-rate-label">d’accord</span>
        </div>
        <p className="cmp-rate-detail">
          Même position sur <strong>{comparison.agree.toLocaleString('fr-FR')}</strong> des{' '}
          <strong>{comparison.shared.toLocaleString('fr-FR')}</strong> {comparison.shared > 1 ? 'votes communs' : 'vote commun'}
          {period && <><br /><span className="cmp-period">Période couverte : {period}</span></>}
        </p>
      </div>

      <div className="cmp-bar" aria-hidden="true">
        {segments.filter(segment => segment.value > 0).map(segment => (
          <span key={segment.key} className={`cmp-bar-seg ${segment.key}`} style={{ width: `${segment.share * 100}%` }} title={`${segment.label} : ${segment.value}`} />
        ))}
      </div>
      <ul className="cmp-breakdown" aria-label="Répartition des votes communs">
        {segments.map(segment => (
          <li key={segment.key} className="cmp-breakdown-item">
            <span className={`cmp-swatch ${segment.key}`} aria-hidden="true" />
            <span className="cmp-breakdown-label">{segment.label}</span>
            <span className="cmp-breakdown-value">{segment.value.toLocaleString('fr-FR')}</span>
          </li>
        ))}
      </ul>

      <div className="senator-votes-history-title cmp-subtitle">
        <span>Désaccords les plus récents ({disagreementTotal.toLocaleString('fr-FR')})</span>
        {comparison.disagreements.length > 0 && <span className="senator-history-hint">Cliquez sur un vote pour afficher le scrutin</span>}
      </div>
      {comparison.disagreements.length === 0 ? (
        <div className="senator-detail-message" role="status">Aucun désaccord : ils ont toujours voté de la même façon.</div>
      ) : (
        <>
          <div className="senator-history-list cmp-disagreements">
            {comparison.disagreements.map(item => (
              <DisagreementRow
                key={`${item.session}-${item.number}`}
                item={item}
                nameA={senator.nom || senator.name}
                nameB={other.nom || other.name}
                scrutin={findScrutin(scrutins, item.session, item.number) || null}
                onOpen={onOpenScrutin}
              />
            ))}
          </div>
          {disagreementTotal > comparison.disagreements.length && (
            <p className="cmp-more-note">{comparison.disagreements.length} désaccords les plus récents sur {disagreementTotal.toLocaleString('fr-FR')}.</p>
          )}
        </>
      )}
    </>
  );
}

function DisagreementRow({ item, nameA, nameB, scrutin, onOpen }: {
  item: CompareDisagreement; nameA: string; nameB: string; scrutin: Scrutin | null; onOpen: (scrutin: Scrutin) => void;
}) {
  const resultClass = item.result === 'adopté' ? 'adopté' : 'rejeté';
  const content = (
    <>
      <span className="history-scrutin-info">
        <span className="history-scrutin-meta">
          <span className={`history-result ${resultClass}`}>{item.result}</span>
          <span className="history-meta-divider" aria-hidden="true">·</span>
          <span className="history-scrutin-num">Scrutin n°{item.number}</span>
        </span>
        <span className="history-scrutin-title">{item.title}</span>
        <span className="cmp-positions">
          <PositionBadge name={nameA} position={item.positionA} />
          <PositionBadge name={nameB} position={item.positionB} />
        </span>
      </span>
      <span className="history-scrutin-date">{formatDate(item.date) || '—'}</span>
    </>
  );
  return scrutin ? (
    <button
      type="button"
      className="history-vote-row history-vote-button cmp-row"
      onClick={() => onOpen(scrutin)}
      aria-label={`Ouvrir le scrutin ${item.number}, session ${item.session} : ${nameA} ${positionLabel(item.positionA).toLowerCase()}, ${nameB} ${positionLabel(item.positionB).toLowerCase()}`}
    >
      {content}
    </button>
  ) : (
    <div className="history-vote-row cmp-row">{content}</div>
  );
}

function PositionBadge({ name, position }: { name: string; position: ExpressedPosition }) {
  return (
    <span className="cmp-position">
      <span className="cmp-position-name">{name}</span>
      <span className={`history-vote-badge ${position}`}>{positionLabel(position)}</span>
    </span>
  );
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}
