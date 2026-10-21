import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api } from './api/endpoints';
import AboutView from './AboutView';
import developerPhoto from './assets/developer.jpg';
import PhotoPreviewDialog from './components/PhotoPreviewDialog';
import HeaderSearch from './HeaderSearch';
import GroupsView from './GroupsView';
import { formatSessionRange } from './lib/format';
import { preferredScrollBehavior } from './lib/motion';
import { listSessions } from './lib/scrutins';
import SenatorsView from './SenatorsView';
import SenatorDetailDialog from './SenatorDetailDialog';
import ScrutinDetailDialog from './ScrutinDetailDialog';
import ScrutinsView from './ScrutinsView';
import type { Scrutin, Senator, SenatorStatusFilter, Stats, View } from './types';

// The Statistics view carries the chart library (ECharts): load it on the first visit only.
const StatsView = lazy(() => import('./StatsView'));
// The map view carries the department outlines (~85 KB): same, first visit only.
const MapView = lazy(() => import('./MapView'));

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'scrutins', label: 'Scrutins' },
  { id: 'senateurs', label: 'Sénateurs' },
  { id: 'groupes', label: 'Groupes' },
  { id: 'carte', label: 'Carte' },
  { id: 'stats', label: 'Statistiques' },
  { id: 'about', label: 'À propos' },
];

interface LoadedData {
  senators: Senator[];
  scrutins: Scrutin[];
  stats: Stats | null;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty'; data: LoadedData }
  | { kind: 'ready'; data: LoadedData };

type ActiveDialog =
  | { kind: 'scrutin'; scrutin: Scrutin }
  | { kind: 'senator'; senator: Senator }
  | null;

function readViewFromHash(): View {
  const hash = window.location.hash.slice(1);
  return VIEWS.some(view => view.id === hash) ? hash as View : 'scrutins';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('HTTP ')) {
    return `Le serveur a répondu avec une erreur (${error.message.slice(5)}). Vérifiez que le backend et la base de données sont disponibles.`;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Impossible de charger les données. Vérifiez le backend puis réessayez.';
}

function App() {
  const [view, setView] = useState<View>(readViewFromHash);
  const [navOpen, setNavOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState('all');
  const [senatorGroupFilter, setSenatorGroupFilter] = useState('all');
  const [senatorStatusFilter, setSenatorStatusFilter] = useState<SenatorStatusFilter>('ACTIF');
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<{ src: string; name: string } | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [statsVisited, setStatsVisited] = useState(() => readViewFromHash() === 'stats');
  const [mapVisited, setMapVisited] = useState(() => readViewFromHash() === 'carte');

  useEffect(() => {
    const syncView = () => setView(readViewFromHash());
    window.addEventListener('hashchange', syncView);
    return () => window.removeEventListener('hashchange', syncView);
  }, []);

  useEffect(() => {
    if (view === 'stats') setStatsVisited(true);
    if (view === 'carte') setMapVisited(true);
    setNavOpen(false);
    setSearchOpen(false);
    setActiveDialog(null);
    setPhotoPreview(null);
    window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
  }, [view]);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeDialog = useCallback(() => setActiveDialog(null), []);
  const openScrutin = useCallback((scrutin: Scrutin) => setActiveDialog({ kind: 'scrutin', scrutin }), []);
  const openSenator = useCallback((senator: Senator) => setActiveDialog({ kind: 'senator', senator }), []);
  const openPhoto = useCallback((src: string, name: string) => setPhotoPreview({ src, name }), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState({ kind: 'loading' });

    async function load() {
      try {
        const status = await api.status(controller.signal);
        if (status.status !== 'online' || !status.hasData) {
          throw new Error('Le backend ne peut pas accéder aux données. Vérifiez sa connexion à la base de données.');
        }

        const [senators, scrutins, stats] = await Promise.all([
          api.senators(controller.signal),
          api.scrutins(controller.signal),
          api.stats(controller.signal).catch(() => null),
        ]);
        if (controller.signal.aborted) return;

        const data = { senators, scrutins, stats };
        setLoadState(senators.length === 0 && scrutins.length === 0
          ? { kind: 'empty', data }
          : { kind: 'ready', data });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadState({ kind: 'error', message: getErrorMessage(error) });
      }
    }

    void load();
    return () => controller.abort();
  }, [retryCount]);

  const currentView = VIEWS.find(item => item.id === view) ?? VIEWS[0];
  const loadedData = loadState.kind === 'ready' || loadState.kind === 'empty' ? loadState.data : null;
  const sessions = loadedData ? listSessions(loadedData.scrutins) : [];
  const activeSession = selectedSession === 'all' || sessions.includes(selectedSession) ? selectedSession : 'all';
  const coveredYearRange = sessions.length > 0
    ? `${Number(sessions[sessions.length - 1])}–${Number(sessions[0]) + 1}`
    : null;
  return (
    <>
      <header className="site-header" id="site-header">
        <div className="header-bg" />
        <div className="container header-inner">
          <a className="logo" href="#scrutins" onClick={() => setNavOpen(false)}>
            <div className="logo-icon" aria-hidden="true">
              <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="34" height="34" rx="11" fill="#151D30" stroke="currentColor" strokeOpacity=".36" />
                <path d="M4.8 24a13.2 13.2 0 0 1 26.4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M8 24a10 10 0 0 1 20 0" stroke="currentColor" strokeWidth="1" strokeOpacity=".32" strokeLinecap="round" />
                <circle cx="6.6" cy="20.3" r="1.8" fill="#8585F6" />
                <circle cx="9.3" cy="15.8" r="1.8" fill="#8585F6" />
                <circle cx="13.5" cy="12.6" r="1.8" fill="#8585F6" />
                <circle cx="18" cy="11" r="1.8" fill="#FFFFFF" />
                <circle cx="22.5" cy="12.6" r="1.8" fill="#F95C5E" />
                <circle cx="26.7" cy="15.8" r="1.8" fill="#F95C5E" />
                <circle cx="29.4" cy="20.3" r="1.8" fill="#F95C5E" />
                <path d="M5 24.5h26" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </div>
            <div className="logo-text">
              <span className="logo-title">Sénat Votes</span>
              <span className="logo-sub">Scrutins du Sénat Français</span>
            </div>
          </a>

          <nav className={`nav-links${navOpen ? ' open' : ''}${searchOpen ? ' is-searching' : ''}`} aria-label="Navigation principale">
            {VIEWS.map(item => (
              <a
                key={item.id}
                className={`nav-link${view === item.id ? ' active' : ''}`}
                href={`#${item.id}`}
                aria-current={view === item.id ? 'page' : undefined}
                onClick={() => setNavOpen(false)}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className={`header-actions${searchOpen ? ' search-open' : ''}`}>
            <HeaderSearch
              scrutins={loadedData?.scrutins ?? []}
              senators={loadedData?.senators ?? []}
              stats={loadedData?.stats ?? null}
              isOpen={searchOpen}
              disabled={!loadedData}
              onOpenChange={setSearchOpen}
              onOpenScrutin={openScrutin}
              onOpenSenator={openSenator}
            />
            <div className="year-selector">
              <label className="sr-only" htmlFor="session-select">Session parlementaire</label>
              <select
                id="session-select"
                aria-label="Session parlementaire"
                title="Session parlementaire"
                value={activeSession}
                disabled={!loadedData}
                onChange={event => setSelectedSession(event.target.value)}
              >
                <option value="all">Toutes les sessions</option>
                {sessions.map(session => (
                  <option key={session} value={session}>{formatSessionRange(session)}</option>
                ))}
              </select>
              {coveredYearRange && (
                <span className="year-selector-range" aria-label={`Période couverte : ${coveredYearRange}`}>
                  Période : {coveredYearRange}
                </span>
              )}
            </div>
            <button
              className="hamburger"
              type="button"
              aria-label={navOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
              aria-expanded={navOpen}
              onClick={() => setNavOpen(open => !open)}
            >
              <span /><span /><span />
            </button>
          </div>
        </div>
      </header>

      {loadState.kind === 'ready' && loadedData ? (
        <>
          <div
            aria-hidden={view !== 'scrutins'}
            style={{ display: view === 'scrutins' ? undefined : 'none' }}
          >
            <ScrutinsView
              isActive={view === 'scrutins'}
              scrutins={loadedData.scrutins}
              stats={loadedData.stats}
              selectedSession={activeSession}
              onOpenScrutin={openScrutin}
              onOpenSearch={openSearch}
            />
          </div>
          <div
            aria-hidden={view !== 'senateurs'}
            style={{ display: view === 'senateurs' ? undefined : 'none' }}
          >
            <SenatorsView
              senators={loadedData.senators}
              stats={loadedData.stats}
              groupFilter={senatorGroupFilter}
              onGroupFilterChange={setSenatorGroupFilter}
              statusFilter={senatorStatusFilter}
              onStatusFilterChange={setSenatorStatusFilter}
              onOpenSenator={openSenator}
              onOpenPhoto={openPhoto}
            />
          </div>
          <div
            aria-hidden={view !== 'groupes'}
            style={{ display: view === 'groupes' ? undefined : 'none' }}
          >
            <GroupsView
              senators={loadedData.senators}
              stats={loadedData.stats}
              onSelectGroup={code => {
                setSenatorGroupFilter(code);
                setSenatorStatusFilter('ACTIF');
                window.location.hash = 'senateurs';
              }}
              onOpenSenator={openSenator}
            />
          </div>
          <div
            aria-hidden={view !== 'carte'}
            style={{ display: view === 'carte' ? undefined : 'none' }}
          >
            {mapVisited && (
              <Suspense fallback={<MapLoading />}>
                <MapView senators={loadedData.senators} stats={loadedData.stats} onOpenSenator={openSenator} />
              </Suspense>
            )}
          </div>
          <div
            aria-hidden={view !== 'stats'}
            style={{ display: view === 'stats' ? undefined : 'none' }}
          >
            {statsVisited && (
              <Suspense fallback={<StatsLoading />}>
                <StatsView
                  scrutins={loadedData.scrutins}
                  stats={loadedData.stats}
                  selectedSession={activeSession}
                  onOpenScrutin={openScrutin}
                />
              </Suspense>
            )}
          </div>
        </>
      ) : view === 'about' ? null : (
        <main className="main-content view-panel react-shell-main">
          <div className="container react-shell-content">
            <p className="section-eyebrow">Sénat Votes · Application React</p>
            <h1 className="react-shell-title">{currentView.label}</h1>

            {loadState.kind === 'loading' && (
              <div className="react-shell-card" aria-live="polite" aria-busy="true">
                <div className="loading-state">
                  <div className="loading-spinner" />
                  <p>Chargement des données officielles du Sénat…</p>
                </div>
              </div>
            )}

            {loadState.kind === 'error' && (
              <div className="react-shell-card" role="alert">
                <div className="error-state">
                  <div className="error-icon" aria-hidden="true">⚠️</div>
                  <h2>Les données ne sont pas disponibles</h2>
                  <p>{loadState.message}</p>
                  <button className="btn-primary react-shell-action" type="button" onClick={() => setRetryCount(n => n + 1)}>
                    Réessayer
                  </button>
                </div>
              </div>
            )}

            {loadState.kind === 'empty' && (
              <div className="react-shell-card" role="status">
                <div className="error-state">
                  <h2>Aucune donnée disponible</h2>
                  <p>Le serveur répond, mais il n’a encore fourni aucun scrutin ni sénateur.</p>
                  <button className="btn-primary react-shell-action" type="button" onClick={() => setRetryCount(n => n + 1)}>
                    Actualiser
                  </button>
                </div>
              </div>
            )}

          </div>
        </main>
      )}

      {view === 'about' && <AboutView />}

      <footer className="site-footer">
        <div className="container footer-inner">
          <div className="footer-left">
            <div className="logo-text"><span className="logo-title">Sénat Votes</span></div>
            <p className="footer-desc">Données issues du portail officiel <a href="https://www.senat.fr" target="_blank" rel="noopener noreferrer">senat.fr</a> — Licence Ouverte Etalab v2.0</p>
            <nav className="footer-links footer-source-links" aria-label="Sources des données">
              <a href="https://www.senat.fr/scrutin-public/scr2026.html" target="_blank" rel="noopener noreferrer">Source officielle des scrutins</a>
              <a href="https://data.senat.fr" target="_blank" rel="noopener noreferrer">data.senat.fr</a>
            </nav>
          </div>
          <section className="footer-developer" aria-label="Développeur du site">
            <div className="footer-developer-header">
              {/* Decorative: the name is written right next to the photo. */}
              <img className="footer-developer-photo" src={developerPhoto} alt="" width={400} height={400} loading="lazy" decoding="async" />
              <div>
                <p className="footer-developer-label">Développé par</p>
                <h2 className="footer-developer-name">Mohamed Khalil Brik</h2>
              </div>
            </div>
            <div className="footer-contact-links">
              <a className="footer-contact-link" href="https://www.instagram.com/khalil.brik/" target="_blank" rel="noopener noreferrer">
                <span className="footer-contact-icon" aria-hidden="true">◎</span>
                <span className="footer-contact-copy"><span>Instagram</span><strong>@khalil.brik</strong></span>
                <span className="footer-contact-arrow" aria-hidden="true">↗</span>
              </a>
              <a className="footer-contact-link" href="https://www.linkedin.com/in/mohamed-khalil-brik-457164183/" target="_blank" rel="noopener noreferrer">
                <span className="footer-contact-icon footer-linkedin-icon" aria-hidden="true">in</span>
                <span className="footer-contact-copy"><span>LinkedIn</span><strong>Voir le profil</strong></span>
                <span className="footer-contact-arrow" aria-hidden="true">↗</span>
              </a>
              <a className="footer-contact-link" href="https://khalilbriktn.github.io/personal-website/" target="_blank" rel="noopener noreferrer">
                <span className="footer-contact-icon" aria-hidden="true">⌘</span>
                <span className="footer-contact-copy"><span>Site personnel</span><strong>khalilbriktn.github.io</strong></span>
                <span className="footer-contact-arrow" aria-hidden="true">↗</span>
              </a>
              <a className="footer-contact-link" href="mailto:mohamedkhalil.brik@aucegypt.edu">
                <span className="footer-contact-icon" aria-hidden="true">@</span>
                <span className="footer-contact-copy"><span>Email</span><strong>mohamedkhalil.brik@aucegypt.edu</strong></span>
                <span className="footer-contact-arrow" aria-hidden="true">↗</span>
              </a>
            </div>
          </section>
        </div>
        <div className="footer-bottom"><div className="container"><p>Sénat Votes · Transparence et suivi de l’activité parlementaire</p></div></div>
      </footer>

      {activeDialog?.kind === 'scrutin' && loadedData && (
        <ScrutinDetailDialog
          key={`${activeDialog.scrutin.session}-${activeDialog.scrutin.number}`}
          scrutin={activeDialog.scrutin}
          senators={loadedData.senators}
          stats={loadedData.stats}
          onClose={closeDialog}
          onOpenSenator={openSenator}
          onOpenPhoto={openPhoto}
        />
      )}
      {activeDialog?.kind === 'senator' && loadedData && (
        <SenatorDetailDialog
          key={activeDialog.senator.matricule}
          senator={activeDialog.senator}
          scrutins={loadedData.scrutins}
          stats={loadedData.stats}
          onClose={closeDialog}
          onOpenScrutin={openScrutin}
          onOpenPhoto={openPhoto}
        />
      )}
      {photoPreview && (
        <PhotoPreviewDialog
          src={photoPreview.src}
          name={photoPreview.name}
          onClose={() => setPhotoPreview(null)}
        />
      )}
    </>
  );
}

function StatsLoading() {
  return (
    <main className="main-content view-panel" id="view-stats" aria-busy="true">
      <div className="container">
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Chargement des statistiques…</p>
        </div>
      </div>
    </main>
  );
}

function MapLoading() {
  return (
    <main className="main-content view-panel" aria-busy="true">
      <div className="container">
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Chargement de la carte…</p>
        </div>
      </div>
    </main>
  );
}

export default App;
