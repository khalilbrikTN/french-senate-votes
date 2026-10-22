import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { HttpError, RequestTimeoutError } from './api/client';
import { api } from './api/endpoints';
import { loadInitialData } from './api/initialLoad';
import AboutView from './AboutView';
import developerPhoto from './assets/developer.jpg';
import AccessibleDialog from './components/AccessibleDialog';
import ErrorBoundary, { ErrorFallback } from './components/ErrorBoundary';
import PhotoPreviewDialog from './components/PhotoPreviewDialog';
import RouteNotice from './components/RouteNotice';
import HeaderSearch from './HeaderSearch';
import GroupsView from './GroupsView';
import IndependenceView from './IndependenceView';
import { formatSessionRange } from './lib/format';
import { preferredScrollBehavior } from './lib/motion';
import { dialogHash, parseHash, readDialogHistoryState, scrutinHash, senatorHash, type DialogHistoryState, type DialogRoute } from './lib/routes';
import { findScrutin, listSessions } from './lib/scrutins';
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
  { id: 'independance', label: 'Indépendance' },
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
  | { kind: 'loading'; slow?: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'empty'; data: LoadedData }
  | { kind: 'ready'; data: LoadedData };

type ActiveDialog =
  | { kind: 'scrutin'; scrutin: Scrutin }
  | { kind: 'senator'; senator: Senator };

// Where the dialog named by the address stands: shown, waiting for data, or unknown.
type DialogResolution =
  | { status: 'none' }
  | { status: 'pending' }
  | { status: 'open'; dialog: ActiveDialog }
  | { status: 'missing'; message: string };

type FormerSenatorsState =
  | { kind: 'idle' | 'loading' | 'error' }
  | { kind: 'ready'; senators: Senator[] };

// The address plus what the app stored in history.state for the dialog entries it pushed.
interface RouteSnapshot {
  hash: string;
  depth: number;
  baseView: View | undefined;
}

function readRouteSnapshot(): RouteSnapshot {
  const { svDialogDepth, svBaseView } = readDialogHistoryState(window.history.state);
  return { hash: window.location.hash, depth: svDialogDepth ?? 0, baseView: svBaseView };
}

// View shown for an address: a dialog keeps the view it was opened over, or else its own default view.
function viewOfRoute(route: RouteSnapshot): View {
  const parsed = parseHash(route.hash);
  return parsed.dialog ? route.baseView ?? parsed.view : parsed.view;
}

const NOTICE_SCRUTIN_MISSING = 'Ce scrutin est introuvable.';
const NOTICE_SENATOR_MISSING = 'Ce sénateur est introuvable.';
const NOTICE_SENATOR_UNAVAILABLE = 'Cette fiche n’a pas pu être chargée. Réessayez dans un instant.';

// After this delay the loading screen explains that the (sleeping) server is waking up.
const SLOW_START_NOTICE_MS = 3000;

// Views mounted lazily: they render nothing until first visited, then stay mounted to keep their filters.
type LazyView = Exclude<View, 'scrutins' | 'about'>;

function getErrorMessage(error: unknown): string {
  if (error instanceof TypeError || error instanceof RequestTimeoutError) {
    return 'Le serveur n’a pas répondu à temps. Il est peut-être en cours de démarrage : réessayez dans un instant.';
  }
  if (error instanceof HttpError || (error instanceof Error && error.message.startsWith('HTTP '))) {
    return `Le serveur a répondu avec une erreur (${error.message.slice(5)}). Vérifiez que le backend et la base de données sont disponibles.`;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Impossible de charger les données. Vérifiez le backend puis réessayez.';
}

function App() {
  const [route, setRoute] = useState<RouteSnapshot>(readRouteSnapshot);
  const view = viewOfRoute(route);
  const dialogRoute = parseHash(route.hash).dialog;
  const [navOpen, setNavOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState('all');
  const [senatorGroupFilter, setSenatorGroupFilter] = useState('all');
  const [senatorStatusFilter, setSenatorStatusFilter] = useState<SenatorStatusFilter>('ACTIF');
  // Dialogs opened in the app, by route hash, so that Back/Forward can show them again
  // (including former senators, who are not in the initially loaded list).
  const openedDialogs = useRef(new Map<string, ActiveDialog>());
  const [formerSenators, setFormerSenators] = useState<FormerSenatorsState>({ kind: 'idle' });
  // Hash of a dialog being closed through history.go(): hidden at once, gone after the popstate.
  const [closingHash, setClosingHash] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<{ src: string; name: string } | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [visitedViews, setVisitedViews] = useState<ReadonlySet<View>>(() => new Set([viewOfRoute(readRouteSnapshot())]));

  const syncRoute = useCallback(() => {
    const next = readRouteSnapshot();
    setRoute(current => current.hash === next.hash && current.depth === next.depth && current.baseView === next.baseView
      ? current
      : next);
    setClosingHash(null);
  }, []);

  useEffect(() => {
    // A shared dialog link opened directly gets a list entry under it, so Back closes the dialog
    // instead of leaving the site. Idempotent: the pushed entry carries its depth in history.state.
    const parsed = parseHash(window.location.hash);
    if (parsed.dialog && !readDialogHistoryState(window.history.state).svDialogDepth) {
      const dialogEntry = window.location.hash;
      window.history.replaceState(null, '', `#${parsed.view}`);
      const state: DialogHistoryState = { svDialogDepth: 1, svBaseView: parsed.view };
      window.history.pushState(state, '', dialogEntry);
    }
    syncRoute();
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, [syncRoute]);

  // Only a change of view resets the page; opening or closing a dialog leaves the view as it is.
  useEffect(() => {
    setVisitedViews(visited => visited.has(view) ? visited : new Set(visited).add(view));
    setNavOpen(false);
    setSearchOpen(false);
    window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
  }, [view]);

  useEffect(() => { setPhotoPreview(null); }, [route.hash]);

  // Opening a dialog pushes a history entry: Back closes it, or returns to the previous dialog.
  const pushDialog = useCallback((hash: string, dialog: ActiveDialog) => {
    openedDialogs.current.set(hash, dialog);
    const current = readRouteSnapshot();
    if (current.hash === hash) return;
    const currentRoute = parseHash(current.hash);
    const state: DialogHistoryState = currentRoute.dialog
      ? { svDialogDepth: current.depth + 1, svBaseView: current.baseView ?? currentRoute.view }
      : { svDialogDepth: 1, svBaseView: currentRoute.view };
    window.history.pushState(state, '', hash);
    syncRoute();
  }, [syncRoute]);

  // Closing goes back to the list entry the dialogs were opened from, without adding entries.
  const closeDialog = useCallback(() => {
    const current = readRouteSnapshot();
    const currentRoute = parseHash(current.hash);
    if (!currentRoute.dialog) return;
    if (current.depth > 0) {
      setClosingHash(current.hash);
      window.history.go(-current.depth);
    } else {
      window.history.replaceState(null, '', `#${current.baseView ?? currentRoute.view}`);
      syncRoute();
    }
  }, [syncRoute]);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const openScrutin = useCallback((scrutin: Scrutin) => pushDialog(scrutinHash(scrutin), { kind: 'scrutin', scrutin }), [pushDialog]);
  const openSenator = useCallback((senator: Senator) => pushDialog(senatorHash(senator), { kind: 'senator', senator }), [pushDialog]);
  const openPhoto = useCallback((src: string, name: string) => setPhotoPreview({ src, name }), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState({ kind: 'loading' });
    const slowTimer = window.setTimeout(() => {
      setLoadState(state => state.kind === 'loading' ? { kind: 'loading', slow: true } : state);
    }, SLOW_START_NOTICE_MS);

    async function load() {
      try {
        const data = await loadInitialData(controller.signal);
        if (controller.signal.aborted) return;
        setLoadState(data.senators.length === 0 && data.scrutins.length === 0
          ? { kind: 'empty', data }
          : { kind: 'ready', data });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadState({ kind: 'error', message: getErrorMessage(error) });
      } finally {
        window.clearTimeout(slowTimer);
      }
    }

    void load();
    return () => {
      window.clearTimeout(slowTimer);
      controller.abort();
    };
  }, [retryCount]);

  const settledData = loadState.kind === 'ready' || loadState.kind === 'empty' ? loadState.data : null;
  const resolution = resolveDialog(dialogRoute, settledData, formerSenators, openedDialogs.current);
  const needsFormerSenators = resolution.status === 'pending' && settledData !== null && dialogRoute?.kind === 'senator';

  // A senator link may point to a former senator: they are only in the ANCIEN list, fetched on demand.
  useEffect(() => {
    if (!needsFormerSenators) return;
    const controller = new AbortController();
    setFormerSenators({ kind: 'loading' });
    api.senatorsByStatus('ANCIEN', controller.signal)
      .then(senators => { if (!controller.signal.aborted) setFormerSenators({ kind: 'ready', senators }); })
      .catch(() => { if (!controller.signal.aborted) setFormerSenators({ kind: 'error' }); });
    return () => controller.abort();
  }, [needsFormerSenators]);

  // Unknown vote or senator: show the underlying view with a short notice instead of an error page.
  const missingMessage = resolution.status === 'missing' ? resolution.message : null;
  useEffect(() => {
    if (!missingMessage) return;
    setNotice(missingMessage);
    // A failed former-senator list is fetched again for the next link.
    setFormerSenators(state => state.kind === 'error' ? { kind: 'idle' } : state);
    closeDialog();
  }, [missingMessage, route.hash, closeDialog]);

  const shownDialog = resolution.status === 'open' && route.hash !== closingHash ? resolution.dialog : null;
  const currentView = VIEWS.find(item => item.id === view) ?? VIEWS[0];
  // Also true on the render that first shows a view, before the effect records the visit.
  const isMounted = (id: LazyView) => view === id || visitedViews.has(id);
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
              <span className="logo-title">Regard Sénat</span>
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
            <ErrorBoundary resetKey={view}>
              <ScrutinsView
                isActive={view === 'scrutins'}
                scrutins={loadedData.scrutins}
                stats={loadedData.stats}
                selectedSession={activeSession}
                onOpenScrutin={openScrutin}
                onOpenSearch={openSearch}
              />
            </ErrorBoundary>
          </div>
          <div
            aria-hidden={view !== 'senateurs'}
            style={{ display: view === 'senateurs' ? undefined : 'none' }}
          >
            {isMounted('senateurs') && (
              <ErrorBoundary resetKey={view}>
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
              </ErrorBoundary>
            )}
          </div>
          <div
            aria-hidden={view !== 'groupes'}
            style={{ display: view === 'groupes' ? undefined : 'none' }}
          >
            {isMounted('groupes') && (
              <ErrorBoundary resetKey={view}>
                <GroupsView
                  senators={loadedData.senators}
                  stats={loadedData.stats}
                  onSelectGroup={code => {
                    setSenatorGroupFilter(code);
                    setSenatorStatusFilter('ACTIF');
                    window.location.hash = 'senateurs';
                  }}
                />
              </ErrorBoundary>
            )}
          </div>
          <div
            aria-hidden={view !== 'independance'}
            style={{ display: view === 'independance' ? undefined : 'none' }}
          >
            {isMounted('independance') && (
              <ErrorBoundary resetKey={view}>
                <IndependenceView
                  senators={loadedData.senators}
                  scrutins={loadedData.scrutins}
                  stats={loadedData.stats}
                  onOpenSenator={openSenator}
                  onOpenScrutin={openScrutin}
                />
              </ErrorBoundary>
            )}
          </div>
          <div
            aria-hidden={view !== 'carte'}
            style={{ display: view === 'carte' ? undefined : 'none' }}
          >
            {isMounted('carte') && (
              <ErrorBoundary resetKey={view}>
                <Suspense fallback={<MapLoading />}>
                  <MapView senators={loadedData.senators} stats={loadedData.stats} onOpenSenator={openSenator} />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>
          <div
            aria-hidden={view !== 'stats'}
            style={{ display: view === 'stats' ? undefined : 'none' }}
          >
            {isMounted('stats') && (
              <ErrorBoundary resetKey={view}>
                <Suspense fallback={<StatsLoading />}>
                  <StatsView
                    scrutins={loadedData.scrutins}
                    stats={loadedData.stats}
                    selectedSession={activeSession}
                    onOpenScrutin={openScrutin}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>
        </>
      ) : view === 'about' ? null : (
        <main className="main-content view-panel react-shell-main">
          <div className="container react-shell-content">
            <p className="section-eyebrow">Regard Sénat</p>
            <h1 className="react-shell-title">{currentView.label}</h1>

            {loadState.kind === 'loading' && (
              <div className="react-shell-card" aria-live="polite" aria-busy="true">
                <div className="loading-state">
                  <div className="loading-spinner" />
                  <p>Chargement des données officielles du Sénat…</p>
                  {loadState.slow && (
                    <p className="loading-slow-notice">Le serveur démarre… cela peut prendre jusqu’à une minute.</p>
                  )}
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

      {view === 'about' && <ErrorBoundary resetKey={view}><AboutView /></ErrorBoundary>}

      <footer className="site-footer">
        <div className="container footer-inner">
          <div className="footer-left">
            <div className="logo-text"><span className="logo-title">Regard Sénat</span></div>
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
        <div className="footer-bottom"><div className="container"><p>Regard Sénat · Projet indépendant, non affilié au Sénat · Transparence et suivi de l’activité parlementaire</p></div></div>
      </footer>

      {/* Keyed boundaries: opening another scrutin/senator remounts the dialog and clears a caught error. */}
      {shownDialog?.kind === 'scrutin' && loadedData && (
        <ErrorBoundary
          key={`scrutin-${shownDialog.scrutin.session}-${shownDialog.scrutin.number}`}
          fallback={reload => <DialogErrorFallback onClose={closeDialog} onReload={reload} />}
        >
          <ScrutinDetailDialog
            scrutin={shownDialog.scrutin}
            senators={loadedData.senators}
            stats={loadedData.stats}
            onClose={closeDialog}
            onOpenSenator={openSenator}
            onOpenPhoto={openPhoto}
          />
        </ErrorBoundary>
      )}
      {shownDialog?.kind === 'senator' && loadedData && (
        <ErrorBoundary
          key={`senator-${shownDialog.senator.matricule}`}
          fallback={reload => <DialogErrorFallback onClose={closeDialog} onReload={reload} />}
        >
          <SenatorDetailDialog
            senator={shownDialog.senator}
            scrutins={loadedData.scrutins}
            stats={loadedData.stats}
            onClose={closeDialog}
            onOpenScrutin={openScrutin}
            onOpenPhoto={openPhoto}
          />
        </ErrorBoundary>
      )}
      {notice && <RouteNotice message={notice} onDismiss={dismissNotice} />}
      {photoPreview && (
        <ErrorBoundary
          key={photoPreview.src}
          fallback={reload => <DialogErrorFallback onClose={() => setPhotoPreview(null)} onReload={reload} />}
        >
          <PhotoPreviewDialog
            src={photoPreview.src}
            name={photoPreview.name}
            onClose={() => setPhotoPreview(null)}
          />
        </ErrorBoundary>
      )}
    </>
  );
}

function resolveDialog(
  route: DialogRoute | null,
  data: LoadedData | null,
  former: FormerSenatorsState,
  opened: ReadonlyMap<string, ActiveDialog>,
): DialogResolution {
  if (!route) return { status: 'none' };
  const known = opened.get(dialogHash(route));
  if (known) return { status: 'open', dialog: known };
  if (!data) return { status: 'pending' };

  if (route.kind === 'scrutin') {
    const scrutin = route.session ? findScrutin(data.scrutins, route.session, route.number) : undefined;
    return scrutin ? { status: 'open', dialog: { kind: 'scrutin', scrutin } } : { status: 'missing', message: NOTICE_SCRUTIN_MISSING };
  }

  if (!route.matricule) return { status: 'missing', message: NOTICE_SENATOR_MISSING };
  const sitting = data.senators.find(senator => senator.matricule === route.matricule);
  if (sitting) return { status: 'open', dialog: { kind: 'senator', senator: sitting } };
  if (former.kind === 'error') return { status: 'missing', message: NOTICE_SENATOR_UNAVAILABLE };
  if (former.kind !== 'ready') return { status: 'pending' };
  const formerSenator = former.senators.find(senator => senator.matricule === route.matricule);
  return formerSenator
    ? { status: 'open', dialog: { kind: 'senator', senator: formerSenator } }
    : { status: 'missing', message: NOTICE_SENATOR_MISSING };
}

function DialogErrorFallback({ onClose, onReload }: { onClose: () => void; onReload: () => void }) {
  return (
    <AccessibleDialog label="Une erreur est survenue" onClose={onClose}>
      <ErrorFallback onReload={onReload} />
    </AccessibleDialog>
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
