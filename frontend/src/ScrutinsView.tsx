import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { CONFIG } from './config';
import { readChartTheme } from './lib/chartTheme';
import { formatSessionRange } from './lib/format';
import { useIdleWhenNearViewport } from './lib/deferred';
import { preferredScrollBehavior } from './lib/motion';
import { filterScrutins, getSessionScrutins } from './lib/scrutins';
import type { ResultFilter, ScrutinSort } from './lib/scrutins';
import { ALL_THEMES, filterByTheme, hasThemes, themeCounts } from './lib/themes';
import type { Scrutin, Stats } from './types';
import EmptyState from './components/EmptyState';
import FilterDropdown, { type FilterDropdownOption } from './components/FilterDropdown';
import ScrutinCard from './components/ScrutinCard';
import SectionHeader from './components/SectionHeader';
import './themes.css';

// The hemicycle carries the chart library: load it separately so the landing page appears first.
// Its import starts only once the page has loaded and the browser is idle (see below).
const Hemicycle = lazy(() => import('./stats/Hemicycle'));

interface ScrutinsViewProps {
  isActive?: boolean;
  scrutins: Scrutin[];
  stats: Stats | null;
  selectedSession: string;
  onOpenScrutin: (scrutin: Scrutin) => void;
  onOpenSearch: () => void;
}

// Same box before the import starts and while it loads, so the hero does not shift.
// Same card frame and title as the loaded hemicycle, so the card reads as there from the start.
const hemicyclePlaceholder = (
  <div className="stats-chart-card scrutins-hemicycle-loading" aria-busy="true">
    <div className="stats-chart-title">
      <span>Composition du Sénat</span>
      <span className="scrutins-hemicycle-loading-aside">Sénateurs en exercice</span>
    </div>
    <div className="loading-state"><div className="loading-spinner" /><p>Chargement de la composition du Sénat…</p></div>
  </div>
);

const RESULT_FILTERS: Array<{ id: ResultFilter; label: string }> = [
  { id: 'all', label: 'Tous' },
  { id: 'adopté', label: 'Adoptés' },
  { id: 'rejeté', label: 'Rejetés' },
];

export default function ScrutinsView({ isActive = true, scrutins, stats, selectedSession, onOpenScrutin, onOpenSearch }: ScrutinsViewProps) {
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [sort, setSort] = useState<ScrutinSort>('date-desc');
  const [search, setSearch] = useState('');
  const [themeFilter, setThemeFilter] = useState<string>(ALL_THEMES);
  const [visibleCount, setVisibleCount] = useState<number>(CONFIG.PAGE_SIZE);

  const sessionScrutins = useMemo(
    () => getSessionScrutins(scrutins, selectedSession),
    [scrutins, selectedSession],
  );
  const filteredScrutins = useMemo(
    () => filterScrutins(filterByTheme(sessionScrutins, themeFilter), { result: resultFilter, search, sort }),
    [sessionScrutins, themeFilter, resultFilter, search, sort],
  );
  // Themes: automatic classification of the titles (see the backend's app/themes.py).
  // Every theme of the data stays listed; the counts follow the header session.
  const showThemes = useMemo(() => hasThemes(scrutins), [scrutins]);
  const themeOptions = useMemo<FilterDropdownOption[]>(() => [
    { value: ALL_THEMES, label: 'Tous les thèmes', hint: `${sessionScrutins.length.toLocaleString('fr-FR')} scrutins` },
    ...themeCounts(scrutins, sessionScrutins).map(theme => ({
      value: theme.id, label: theme.label,
      hint: `${theme.count.toLocaleString('fr-FR')} scrutin${theme.count === 1 ? '' : 's'}`,
    })),
  ], [scrutins, sessionScrutins]);
  const visibleScrutins = filteredScrutins.slice(0, visibleCount);
  const chartTheme = useMemo(() => readChartTheme(), []);
  const [hemicycleRef, showHemicycle] = useIdleWhenNearViewport<HTMLDivElement>();
  const sessionLabel = selectedSession === 'all'
    ? 'Toutes les sessions'
    : `Session ${formatSessionRange(selectedSession)}`;

  useEffect(() => setVisibleCount(CONFIG.PAGE_SIZE), [scrutins, selectedSession]);

  function resetPagination(update: () => void) {
    update();
    setVisibleCount(CONFIG.PAGE_SIZE);
  }

  return (
    <>
      <section className="hero scrutin-landing-hero" id="hero-section">
        <div className="hero-bg"><div className="hero-gradient" /></div>
        <div className="container scrutin-hero-layout">
          <div className="hero-content scrutin-hero-copy">
            <h1 className="hero-title scrutin-hero-title">
              <span className={`scrutin-hero-title-line scrutin-hero-title-line-first${isActive ? ' is-active' : ''}`}>Scrutins &amp; Votes</span>
              <span className={`hero-accent scrutin-hero-title-line scrutin-hero-title-line-second${isActive ? ' is-active' : ''}`}>du Sénat</span>
            </h1>
            <p className="hero-desc">
              Consultez les décisions du Sénat, comparez les positions des groupes et découvrez comment chaque sénateur a voté.
            </p>
            <div className="hero-actions scrutin-hero-actions">
              <button className="btn-primary" type="button" onClick={() => document.getElementById('scrutins-list')?.scrollIntoView({ behavior: preferredScrollBehavior() })}>
                Voir les derniers scrutins
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
              </button>
              <button className="btn-secondary" type="button" onClick={onOpenSearch}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                Rechercher
              </button>
            </div>
          </div>

          <div className="scrutins-hemicycle" ref={hemicycleRef}>
            {showHemicycle ? (
              <Suspense fallback={hemicyclePlaceholder}>
                <Hemicycle stats={stats} theme={chartTheme} />
              </Suspense>
            ) : hemicyclePlaceholder}
          </div>
        </div>
      </section>

      <main className="main-content view-panel" id="view-scrutins">
        <div className="container">
          <div className="scrutins-content-grid">
            <section className="scrutins-primary-column" id="scrutins-list" aria-label="Liste des scrutins">
              <div className="filter-bar">
                <div className="filter-group">
                  <span className="filter-label">Résultat</span>
                  <div className="filter-chips" role="group" aria-label="Filtrer par résultat">
                    {RESULT_FILTERS.map(filter => (
                      <button
                        key={filter.id}
                        className={`filter-chip${resultFilter === filter.id ? ' active' : ''}`}
                        type="button"
                        aria-pressed={resultFilter === filter.id}
                        onClick={() => resetPagination(() => setResultFilter(filter.id))}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                </div>

                {showThemes && (
                  <div className="filter-group theme-filter-group">
                    <FilterDropdown
                      id="scrutin-theme"
                      label="Thème"
                      value={themeFilter}
                      options={themeOptions}
                      onChange={value => resetPagination(() => setThemeFilter(value))}
                      className="theme-filter-field"
                    />
                  </div>
                )}

                <div className="filter-group">
                  <label className="filter-label" htmlFor="scrutin-sort">Trier par</label>
                  <select id="scrutin-sort" className="filter-select" value={sort} onChange={event => resetPagination(() => setSort(event.target.value as ScrutinSort))}>
                    <option value="date-desc">Date (récent → ancien)</option>
                    <option value="date-asc">Date (ancien → récent)</option>
                    <option value="numero-desc">Numéro (décroissant)</option>
                    <option value="numero-asc">Numéro (croissant)</option>
                  </select>
                </div>

                <div className="filter-group filter-search-group">
                  <label className="sr-only" htmlFor="scrutin-search">Filtrer les scrutins par mot-clé</label>
                  <input
                    id="scrutin-search"
                    type="search"
                    className="filter-input"
                    placeholder="Filtrer par mot-clé..."
                    value={search}
                    onChange={event => resetPagination(() => setSearch(event.target.value))}
                  />
                </div>
              </div>

              <SectionHeader
                title={<>Scrutins <span>— {sessionLabel}</span></>}
                count={<>{filteredScrutins.length.toLocaleString('fr-FR')} scrutin{filteredScrutins.length === 1 ? '' : 's'}</>}
              />

              {themeFilter !== ALL_THEMES && (
                <p className="theme-filter-note">
                  Thème attribué automatiquement d’après l’intitulé du scrutin : classement indicatif, un seul thème principal par scrutin.
                </p>
              )}

              <div className="scrutins-grid">
                {visibleScrutins.length > 0 ? visibleScrutins.map((scrutin, index) => (
                  <ScrutinCard key={`${scrutin.session}-${scrutin.number}`} scrutin={scrutin} index={index} onOpen={onOpenScrutin} />
                )) : (
                  <EmptyState
                    icon="🔍"
                    title="Aucun scrutin trouvé"
                    description="Essayez de modifier vos filtres ou vos termes de recherche."
                    style={{ gridColumn: '1 / -1' }}
                  />
                )}
              </div>

              {filteredScrutins.length > visibleScrutins.length && (
                <div className="load-more-container">
                  <button className="btn-load-more" type="button" onClick={() => setVisibleCount(count => count + CONFIG.PAGE_SIZE)}>
                    Charger plus de scrutins
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
                  </button>
                </div>
              )}
            </section>

            <aside className="scrutins-discovery" aria-labelledby="scrutins-discovery-title">
              <p className="scrutins-discovery-kicker">Pour aller plus loin</p>
              <h2 id="scrutins-discovery-title">Explorer le Sénat</h2>
              <p className="scrutins-discovery-description">Retrouvez les élus, les groupes et les tendances de vote.</p>
              <div className="scrutins-discovery-grid">
                <a className="scrutins-discovery-link" href="#groupes">
                  <span className="scrutins-discovery-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                  </span>
                  <span className="scrutins-discovery-copy"><strong>Groupes politiques</strong><small>Comparer leurs positions</small></span>
                  <svg className="scrutins-discovery-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
                </a>
                <a className="scrutins-discovery-link" href="#senateurs">
                  <span className="scrutins-discovery-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
                  </span>
                  <span className="scrutins-discovery-copy"><strong>Sénateurs</strong><small>Consulter les élus et leurs votes</small></span>
                  <svg className="scrutins-discovery-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
                </a>
                <a className="scrutins-discovery-link" href="#stats">
                  <span className="scrutins-discovery-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 19V5" /><path d="M4 19h17" /><path d="m7 15 4-4 3 2 5-6" /></svg>
                  </span>
                  <span className="scrutins-discovery-copy"><strong>Statistiques</strong><small>Voir les tendances générales</small></span>
                  <svg className="scrutins-discovery-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
                </a>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
