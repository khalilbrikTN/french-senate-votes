import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { formatSessionRange, getInitials } from './lib/format';
import { getGroupColor } from './lib/groups';
import type { Scrutin, Senator, Stats } from './types';

interface HeaderSearchProps {
  scrutins: Scrutin[];
  senators: Senator[];
  stats: Stats | null;
  isOpen: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenScrutin: (scrutin: Scrutin) => void;
  onOpenSenator: (senator: Senator) => void;
}

export default function HeaderSearch({ scrutins, senators, stats, isOpen, disabled = false, onOpenChange, onOpenScrutin, onOpenSenator }: HeaderSearchProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.toLocaleLowerCase('fr-FR').trim();

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [isOpen, onOpenChange]);

  const matchedScrutins = useMemo(() => normalizedQuery
    ? scrutins.filter(scrutin => (scrutin.title || '').toLocaleLowerCase('fr-FR').includes(normalizedQuery) || String(scrutin.number || '').includes(normalizedQuery)).slice(0, 5)
    : [], [normalizedQuery, scrutins]);
  const matchedSenators = useMemo(() => normalizedQuery
    ? senators.filter(senator => [senator.name, senator.dept, senator.group]
      .some(value => (value || '').toLocaleLowerCase('fr-FR').includes(normalizedQuery))).slice(0, 5)
    : [], [normalizedQuery, senators]);

  const closeSearch = (restoreFocus = true) => {
    setQuery('');
    onOpenChange(false);
    if (restoreFocus) window.requestAnimationFrame(() => toggleRef.current?.focus());
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (event.key !== 'Tab' || !isOpen || !rootRef.current) return;
    const focusable = Array.from(rootRef.current.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])'))
      .filter(element => element.tabIndex >= 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div ref={rootRef} className={`header-search-control${isOpen ? ' is-open' : ''}`} onKeyDown={handleKeyDown}>
      <button
        ref={toggleRef}
        className="btn-search header-search-toggle"
        type="button"
        aria-label="Rechercher un scrutin ou un sénateur"
        aria-expanded={isOpen}
        aria-controls="header-search-results"
        tabIndex={isOpen ? -1 : 0}
        disabled={disabled}
        onClick={() => onOpenChange(true)}
      >
        <SearchIcon />
      </button>
      {isOpen && (
        <div className="header-search-field">
          <SearchIcon />
          <label className="sr-only" htmlFor="header-search-input">Rechercher un scrutin ou un sénateur</label>
          <input
            ref={inputRef}
            id="header-search-input"
            className="header-search-input"
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Rechercher un scrutin ou un sénateur…"
            autoComplete="off"
          />
          <button className="header-search-close" type="button" aria-label="Fermer la recherche" onClick={() => closeSearch()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      )}
      {isOpen && (
      <div className="site-search-results" id="header-search-results" role="region" aria-label="Résultats de recherche" aria-live="polite">
        {!normalizedQuery ? (
          <p className="search-hint">Saisissez un nom, un numéro ou un mot-clé pour lancer la recherche.</p>
        ) : matchedScrutins.length === 0 && matchedSenators.length === 0 ? (
          <div className="search-no-results">Aucun résultat trouvé pour « {query.trim()} »</div>
        ) : (
          <>
            {matchedScrutins.length > 0 && (
              <section aria-labelledby="search-scrutins-title">
                <h2 className="search-results-heading search-results-heading-scrutins" id="search-scrutins-title">Scrutins officiels</h2>
                {matchedScrutins.map(scrutin => {
                  const adopted = scrutin.result === 'adopté';
                  const title = scrutin.title || '(sans titre)';
                  return (
                    <button className="search-result-item search-result-button" type="button" key={`${scrutin.session}-${scrutin.number}`} onClick={() => { closeSearch(false); onOpenScrutin(scrutin); }}>
                      <span className="search-result-copy">
                        <span className="search-result-meta">
                          <span className="search-result-number">Scrutin n°{scrutin.number}</span>
                          <span className="search-result-session">Session {formatSessionRange(scrutin.session)}</span>
                          <span className={`search-result-status ${adopted ? 'adopté' : 'rejeté'}`}>{adopted ? 'Adopté' : 'Rejeté'}</span>
                        </span>
                        <span className="search-result-title">{title.slice(0, 110)}{title.length > 110 ? '…' : ''}</span>
                      </span>
                      <ChevronIcon />
                    </button>
                  );
                })}
              </section>
            )}
            {matchedSenators.length > 0 && (
              <section aria-labelledby="search-senators-title">
                <h2 className="search-results-heading search-results-heading-senators" id="search-senators-title">Sénateurs</h2>
                {matchedSenators.map(senator => {
                  const color = getGroupColor(senator.group, stats);
                  return (
                    <button className="search-result-item search-result-button" type="button" key={senator.matricule} onClick={() => { closeSearch(false); onOpenSenator(senator); }}>
                      <SearchSenatorAvatar senator={senator} color={color} />
                      <span className="search-result-copy">
                        <span className="search-result-senator-name">{senator.name}</span>
                        <span className="search-result-senator-meta">{senator.group || 'Groupe non renseigné'} · {senator.dept || ''}</span>
                      </span>
                      <ChevronIcon />
                    </button>
                  );
                })}
              </section>
            )}
          </>
        )}
      </div>
      )}
    </div>
  );
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
}

function SearchSenatorAvatar({ senator, color }: { senator: Senator; color: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <span className="search-result-avatar" style={{ background: `${color}20`, color }}>
      {senator.avatar && !imageFailed
        ? <img src={senator.avatar} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} />
        : <span>{getInitials(senator.name)}</span>}
    </span>
  );
}

function ChevronIcon() {
  return <svg className="search-result-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>;
}
