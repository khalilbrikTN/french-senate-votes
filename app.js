/**
 * Sénat Votes — Main Application
 * Integrates with official Python Backend & open data JSON:
 * - 348 Official French Senators with official photos from senat.fr
 * - Roll-call votes directly parsed from French Senate journals
 * - Real political groups & parliamentary statistics
 */

'use strict';

// ============================================================
// Configuration
// ============================================================
const CONFIG = {
  API_BASE: 'http://localhost:8000',
  DATA_FALLBACK_BASE: './data',
  BASE_URL: 'https://www.senat.fr',
  PAGE_SIZE: 18,
};

// Political groups metadata (seats: static fallback, live counts come from /api/stats)
// Group presidents: data.senat.fr ODSEN_HISTOGROUPES (file dated 20 Oct 2026)
// Colours: the group colours of the hemicycle on the senat.fr home page (<hemicycle-groups>, Oct 2026),
// lightened (same hue) where needed to reach a 4.5:1 contrast on the dark cards (#141929):
// LR #2E70D1, CRCE-K #D90001, RDSE #814A97, UNT #173680, NI #000000. UNT is also shifted
// slightly towards indigo and LR lightened a little more so that the two blues stay distinct.
const POLITICAL_GROUPS = {
  'LR': { 
    name: 'Les Républicains', 
    short: 'LR',
    color: '#6092dc', 
    seats: 124, 
    leader: 'Mathieu Darnaud',
    orientation: 'Droite républicaine',
    desc: 'Premier groupe du Sénat, formant la majorité sénatoriale avec l\'Union centriste et indépendants. Gérard Larcher (LR) a été réélu président du Sénat le 1er octobre 2026.'
  },
  'SER': { 
    name: 'Socialiste, Écologiste et Républicain', 
    short: 'SER',
    color: '#fb6f99', 
    seats: 62, 
    leader: 'Patrick Kanner',
    orientation: 'Gauche républicaine & social-démocratie',
    desc: 'Troisième groupe du Sénat par ses effectifs depuis octobre 2026 et principal groupe de gauche.'
  },
  'UC': { 
    name: 'Union Centriste et Indépendants',
    short: 'UC',
    color: '#7accea', 
    seats: 63, 
    leader: 'Hervé Marseille',
    orientation: 'Centre droit & centrisme pro-européen',
    desc: 'Deuxième groupe du Sénat depuis octobre 2026, formant la majorité sénatoriale avec Les Républicains.'
  },
  'RDPI': { 
    name: 'Rassemblement des démocrates, progressistes et indépendants', 
    short: 'RDPI',
    color: '#f1b608', 
    seats: 16, 
    leader: 'Xavier Iacovelli',
    orientation: 'Centre & sensibilité macroniste',
    desc: 'Groupe réunissant des sénateurs se réclamant d\'Emmanuel Macron, présidé depuis le 30 septembre 2026 par Xavier Iacovelli.'
  },
  'CRCE-K': { 
    name: 'Communiste Républicain Citoyen et Écologiste – Kanaky', 
    short: 'CRCE-K',
    color: '#ff1a1b', 
    seats: 18, 
    leader: 'Cécile Cukierman',
    orientation: 'Gauche communiste & antilibérale',
    desc: 'Groupe défendant les services publics, le pouvoir d\'achat et les droits des territoires ultramarins.'
  },
  'GEST': { 
    name: 'Écologiste – Solidarité et Territoires', 
    short: 'GEST',
    color: '#5cb88d', 
    seats: 15, 
    leader: 'Mélanie Vogel',
    orientation: 'Écologie politique & transition énergétique',
    desc: 'Promeut la bifurcation écologique, la justice sociale et la préservation de la biodiversité.'
  },
  'RDSE': { 
    name: 'Rassemblement Démocratique et Social Européen', 
    short: 'RDSE',
    color: '#a36eb8', 
    seats: 18, 
    leader: 'Maryse Carrère',
    orientation: 'Radicalisme & centre-gauche laïque',
    desc: 'Le plus ancien groupe parlementaire de l\'histoire républicaine, d\'inspiration radicale.'
  },
  'LIRT': { 
    name: 'Les Indépendants – République et Territoires', 
    short: 'LIRT',
    color: '#c7dde2', 
    seats: 15, 
    leader: 'Claude Malhuret',
    orientation: 'Libéral-conservateur & centre-droit',
    desc: 'Groupe d\'inspiration libérale et décentralisatrice.'
  },
  'UNT': {
    name: 'Union Nationale pour les Territoires',
    short: 'UNT',
    color: '#7575eb',
    seats: 15,
    leader: 'Edwige Diaz',
    orientation: 'Nouveau groupe (octobre 2026)',
    desc: ''
  },
  'NI': { 
    name: 'Non-Inscrits', 
    short: 'NI',
    color: '#828282', 
    seats: 2, 
    leader: 'Aucun (Indépendants)',
    orientation: 'Sans groupe',
    desc: 'Sénateurs ne figurant sur la liste d\'aucun groupe (Gabriel Amard et Paul Mougenot en octobre 2026).'
  },
};

// ============================================================
// State
// ============================================================
const state = {
  currentView: 'scrutins', // 'scrutins' | 'senateurs' | 'groupes' | 'stats'
  scrutins: [],
  filteredScrutins: [],
  currentFilter: 'all',
  currentSort: 'date-desc',
  searchTerm: '',
  currentPage: 0,
  selectedSession: 'all',  // parliamentary session filter ('all' or e.g. '2025' = 2025-2026)
  isLoading: false,
  error: null,
  isBackendConnected: false,
  
  // Senators
  senators: [],
  filteredSenators: [],
  senatorGroupFilter: 'all',
  senatorStatusFilter: 'ACTIF', // 'ACTIF' | 'ANCIEN' | 'all'
  formerSenators: null,         // loaded on demand from /api/senateurs?status=ANCIEN
  formerSenatorsLoading: false,
  formerSenatorsFailed: false,
  senatorSearch: '',
  senatorSort: 'nom-asc',
  statsData: null,
};

// ============================================================
// Data Loading Engine
// ============================================================
async function fetchJSON(url, timeoutMs = 4000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

async function loadOfficialData() {
  const statusEl = document.getElementById('backend-status-text');
  
  // 1. Try local Backend API (http://localhost:8000)
  try {
    const status = await fetchJSON(`${CONFIG.API_BASE}/api/status`, 1500);
    if (status && status.status === 'online') {
      state.isBackendConnected = true;
      if (statusEl) statusEl.textContent = 'Backend connecté (port 8000)';

      const [sens, scrs, stats] = await Promise.all([
        fetchJSON(`${CONFIG.API_BASE}/api/senateurs`),
        fetchJSON(`${CONFIG.API_BASE}/api/scrutins`),
        fetchJSON(`${CONFIG.API_BASE}/api/stats`).catch(() => null)
      ]);

      if (sens && scrs) {
        showToast(`Connecté au serveur officiel local (${sens.length} sénateurs)`, 'success');
        return { senators: sens, scrutins: scrs, stats };
      }
    }
  } catch (e) {
    // Backend server not running, fallback to data/ directory
  }

  // 2. Try loading from ./data/*.json
  try {
    const [sens, scrs, stats] = await Promise.all([
      fetchJSON(`${CONFIG.DATA_FALLBACK_BASE}/senateurs.json`, 2500),
      fetchJSON(`${CONFIG.DATA_FALLBACK_BASE}/scrutins.json`, 2500),
      fetchJSON(`${CONFIG.DATA_FALLBACK_BASE}/stats.json`, 2500).catch(() => null)
    ]);

    if (sens && scrs) {
      if (statusEl) statusEl.textContent = 'Données officielles (data/)';
      showToast(`Données officielles du Sénat chargées (${sens.length} sénateurs)`, 'success');
      return { senators: sens, scrutins: scrs, stats };
    }
  } catch (e) {
    console.warn('Could not load data/ JSON files directly:', e.message);
  }

  // 3. Fallback: generate and notify
  if (statusEl) statusEl.textContent = 'Serveur non démarré (start_server.bat)';
  showToast('Démarrez le backend avec start_server.bat pour les données temps réel', 'info');
  return null;
}

// Formatters & helpers
function parseDate(dateStr) {
  if (!dateStr) return null;
  const match1 = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (match1) return new Date(parseInt(match1[3]), parseInt(match1[2])-1, parseInt(match1[1]));
  const match2 = dateStr.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
  if (match2) return new Date(parseInt(match2[1]), parseInt(match2[2])-1, parseInt(match2[3]));
  const months = {'janvier':0,'février':1,'mars':2,'avril':3,'mai':4,'juin':5,'juillet':6,'août':7,'septembre':8,'octobre':9,'novembre':10,'décembre':11};
  const match3 = dateStr.match(/(\d{1,2})\s+([a-zéûôù]+)\s+(\d{4})/i);
  if (match3) {
    const m = months[match3[2].toLowerCase()];
    if (m !== undefined) return new Date(parseInt(match3[3]), m, parseInt(match3[1]));
  }
  return null;
}

function formatDate(date) {
  if (!date) return '—';
  if (typeof date === 'string') {
    const d = parseDate(date);
    if (!d) return date;
    date = d;
  }
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function getInitials(name) {
  if (!name) return '??';
  return name.split(' ').filter(w => w.length > 1).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

// Seats per group: live count from /api/stats when available, static fallback otherwise.
function getGroupSeats(code) {
  const live = state.statsData && state.statsData.groups && state.statsData.groups[code];
  if (live && typeof live.seats === 'number') return live.seats;
  return POLITICAL_GROUPS[code] ? POLITICAL_GROUPS[code].seats : 0;
}

// Total seats used for percentages: sum of the live group counts, or of the static values.
function getTotalSeats() {
  const liveGroups = state.statsData && state.statsData.groups;
  const codes = liveGroups ? Object.keys(liveGroups) : Object.keys(POLITICAL_GROUPS);
  return codes.reduce((acc, code) => acc + getGroupSeats(code), 0) || 348;
}

// Former Senate group codes (career timelines). Predecessor groups reuse their successor's colour;
// the others follow French Wikipedia's party colours ({{Infobox Parti politique français/couleurs}}).
// Codes without a reliable convention (CRARS, GDSRG, RP) keep the hashed fallback below.
const HISTORICAL_GROUP_COLORS = {
  RPR: '#6092dc', UNR: '#6092dc', UDR: '#6092dc',            // gaullists, LR lineage (Wikipedia #0066cc)
  RI: '#26c4ec', UREI: '#26c4ec', CNIP: '#26c4ec', RIAS: '#26c4ec', // Républicains indépendants / CNIP
  UCDP: '#7accea', RPCD: '#7accea',                           // predecessors of the Union centriste group
  MRP: '#00ffff',                                             // Christian democrats (Wikipedia)
  GD: '#a36eb8', RDE: '#a36eb8',                              // former names of the RDSE group
  C: '#ff1a1b',                                               // communists, CRCE-K lineage
  ECO: '#5cb88d',                                             // Groupe écologiste 2012-2017, GEST lineage
};

// Colours come from the database (/api/stats → groupColors, keyed by app code, former groups
// included); the hardcoded colours above and in POLITICAL_GROUPS are the offline fallback.
function getGroupColor(code) {
  const liveColors = state.statsData && state.statsData.groupColors;
  if (liveColors && liveColors[code]) return liveColors[code];
  const grp = POLITICAL_GROUPS[code];
  if (grp) return grp.color;
  if (HISTORICAL_GROUP_COLORS[code]) return HISTORICAL_GROUP_COLORS[code];
  const colors = ['#3b82f6','#ec4899','#f59e0b','#34d399','#a78bfa','#fb923c','#64748b','#14b8a6'];
  const idx = Math.abs((code || 'X').split('').reduce((a,c) => a + c.charCodeAt(0), 0)) % colors.length;
  return colors[idx];
}

// Current group president: from /api/stats (database, ODSEN_HISTOGROUPES) when the backend
// answered, the hardcoded POLITICAL_GROUPS leader otherwise.
function getGroupLeader(code) {
  const grp = POLITICAL_GROUPS[code];
  const live = state.statsData && state.statsData.groups && state.statsData.groups[code];
  if (live && 'leader' in live) {
    if (live.leader) return live.leader;
    return code === 'NI' && grp ? grp.leader : 'Aucun';
  }
  return grp ? grp.leader : '—';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function animateNumber(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const duration = 500;
  const startTime = performance.now();
  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✓', error: '✗', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span> ${escapeHtml(message)}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ============================================================
// Multi-View Navigation Router
// ============================================================
function switchView(viewName) {
  state.currentView = viewName;
  
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.dataset.view === viewName) link.classList.add('active');
    else link.classList.remove('active');
  });

  const panels = {
    'scrutins': document.getElementById('view-scrutins'),
    'senateurs': document.getElementById('view-senateurs'),
    'groupes': document.getElementById('view-groupes'),
    'stats': document.getElementById('view-stats'),
  };

  const hero = document.getElementById('hero-section');
  if (hero) hero.style.display = viewName === 'scrutins' ? 'block' : 'none';

  Object.keys(panels).forEach(key => {
    const panel = panels[key];
    if (!panel) return;
    if (key === viewName) {
      panel.style.display = 'block';
      panel.style.opacity = '0';
      requestAnimationFrame(() => panel.style.opacity = '1');
    } else {
      panel.style.display = 'none';
    }
  });

  if (viewName === 'scrutins') renderScrutins();
  else if (viewName === 'senateurs') renderSenators();
  else if (viewName === 'groupes') renderGroups();
  else if (viewName === 'stats') renderStats();

  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (window.location.hash !== `#${viewName}`) {
    history.pushState(null, '', `#${viewName}`);
  }
}

// ============================================================
// Scrutins View
// ============================================================
function createScrutinCard(scrutin, index) {
  const total = scrutin.pour + scrutin.contre + scrutin.abstention;
  const pourPct = total > 0 ? (scrutin.pour / total * 100).toFixed(1) : 0;
  const contrePct = total > 0 ? (scrutin.contre / total * 100).toFixed(1) : 0;
  const resultClass = scrutin.result === 'adopté' ? 'adopté' : 'rejeté';
  const resultLabel = scrutin.result === 'adopté' ? 'Adopté' : 'Rejeté';

  const card = document.createElement('div');
  card.className = `scrutin-card ${resultClass}`;
  card.style.animationDelay = `${Math.min(index * 0.04, 0.4)}s`;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  card.innerHTML = `
    <div class="card-header">
      <div class="card-meta">
        <div class="card-number">Scrutin n°${scrutin.number}</div>
        <div class="card-date">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${formatDate(scrutin.date) || scrutin.date || '—'}
        </div>
      </div>
      <div class="result-badge ${resultClass}">${resultLabel}</div>
    </div>
    <div class="card-title">${escapeHtml(scrutin.title) || '(sans titre)'}</div>
    <div class="vote-bar-container">
      <div class="vote-bar">
        <div class="vote-bar-pour" style="width:${pourPct}%"></div>
        <div class="vote-bar-contre" style="width:${contrePct}%"></div>
      </div>
      <div class="vote-counts">
        <div class="vote-count"><div class="vote-count-dot pour"></div> <strong>${scrutin.pour}</strong> Pour</div>
        <div class="vote-count"><div class="vote-count-dot contre"></div> <strong>${scrutin.contre}</strong> Contre</div>
        ${scrutin.abstention > 0 ? `<div class="vote-count"><div class="vote-count-dot abstention"></div> <strong>${scrutin.abstention}</strong> Abs.</div>` : ''}
      </div>
    </div>
    <div class="card-footer">
      <div class="card-tag">Session ${scrutin.session || '2024'}</div>
      <div class="card-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>
  `;

  card.addEventListener('click', () => openScrutinModal(scrutin));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openScrutinModal(scrutin); }
  });

  return card;
}

function renderScrutins() {
  const grid = document.getElementById('scrutins-grid');
  const count = document.getElementById('results-count');
  if (!grid) return;

  applyScrutinsFilters();

  const start = 0;
  const end = Math.min((state.currentPage + 1) * CONFIG.PAGE_SIZE, state.filteredScrutins.length);
  const visible = state.filteredScrutins.slice(start, end);

  grid.innerHTML = '';
  if (visible.length === 0) {
    grid.innerHTML = `
      <div class="error-state">
        <div class="error-icon">🔍</div>
        <h3>Aucun scrutin trouvé</h3>
        <p>Essayez de modifier vos filtres ou vos termes de recherche.</p>
      </div>
    `;
  } else {
    visible.forEach((s, i) => grid.appendChild(createScrutinCard(s, i)));
  }

  if (count) {
    const n = state.filteredScrutins.length;
    const sessionLabel = state.selectedSession !== 'all' ? ` · session ${formatSessionRange(state.selectedSession)}` : '';
    count.textContent = `${n} scrutin${n !== 1 ? 's' : ''}${sessionLabel}`;
  }

  // Section heading follows the session selector.
  const headingSession = document.getElementById('session-label');
  if (headingSession) {
    headingSession.textContent = state.selectedSession === 'all'
      ? '— Toutes les sessions'
      : `— Session ${formatSessionRange(state.selectedSession)}`;
  }

  // Hero figures follow the session filter only (not the result chips / search).
  const sessionScrutins = getSessionScrutins();
  const adoptes = sessionScrutins.filter(s => s.result === 'adopté').length;
  animateNumber('stat-scrutins', sessionScrutins.length);
  animateNumber('stat-adoptes', adoptes);
  animateNumber('stat-senateurs', state.senators.length || 348);

  const loadMoreContainer = document.getElementById('load-more-container');
  if (loadMoreContainer) {
    loadMoreContainer.style.display = state.filteredScrutins.length > end ? 'block' : 'none';
  }
}

// Scrutins of the selected parliamentary session (all of them when 'all').
function getSessionScrutins() {
  if (state.selectedSession === 'all') return state.scrutins;
  return state.scrutins.filter(s => String(s.session) === state.selectedSession);
}

// Fill the header session selector from the sessions present in the data.
function populateSessionSelect() {
  const select = document.getElementById('year-select');
  if (!select) return;
  const sessions = [...new Set(state.scrutins.map(s => String(s.session ?? '')).filter(s => /^\d+$/.test(s)))]
    .sort((a, b) => parseInt(b) - parseInt(a));
  if (state.selectedSession !== 'all' && !sessions.includes(state.selectedSession)) {
    state.selectedSession = 'all';
  }
  select.innerHTML = `<option value="all">Toutes les sessions</option>` +
    sessions.map(s => `<option value="${s}">${formatSessionRange(s)}</option>`).join('');
  select.value = state.selectedSession;
}

function applyScrutinsFilters() {
  let data = [...getSessionScrutins()];

  if (state.currentFilter !== 'all') {
    data = data.filter(s => s.result === state.currentFilter);
  }

  const q = state.searchTerm.toLowerCase().trim();
  if (q) {
    data = data.filter(s => 
      (s.title || '').toLowerCase().includes(q) ||
      (s.number || '').toString().includes(q) ||
      (s.date || '').toLowerCase().includes(q)
    );
  }

  // Vote numbers restart every session (October), so order by session before number.
  const bySessionNumber = (a, b) =>
    (parseInt(a.session) || 0) - (parseInt(b.session) || 0) || (a.number || 0) - (b.number || 0);
  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || bySessionNumber(a, b);

  data.sort((a, b) => {
    switch (state.currentSort) {
      case 'date-desc': return byDate(b, a);
      case 'date-asc': return byDate(a, b);
      case 'numero-desc': return bySessionNumber(b, a);
      case 'numero-asc': return bySessionNumber(a, b);
      default: return 0;
    }
  });

  state.filteredScrutins = data;
}

// ============================================================
// SÉNATEURS VIEW
// ============================================================
async function loadFormerSenators() {
  if (!state.isBackendConnected) {
    state.formerSenatorsFailed = true;
    showToast('Les anciens sénateurs nécessitent le serveur (start_backend.bat)', 'info');
    return;
  }
  state.formerSenatorsLoading = true;
  try {
    state.formerSenators = await fetchJSON(`${CONFIG.API_BASE}/api/senateurs?status=ANCIEN`, 20000);
  } catch (e) {
    state.formerSenatorsFailed = true;
    showToast('Impossible de charger les anciens sénateurs', 'error');
  } finally {
    state.formerSenatorsLoading = false;
  }
}

function getSenatorsForStatus() {
  const former = state.formerSenators || [];
  if (state.senatorStatusFilter === 'ANCIEN') return former;
  if (state.senatorStatusFilter === 'all') return [...state.senators, ...former];
  return state.senators;
}

function isFormerSenator(senator) {
  return senator.status === 'ANCIEN';
}

function getYear(isoDate) {
  return isoDate ? isoDate.slice(0, 4) : null;
}

// The Senate records the title (civilité) as M., Mme or Mlle.
function isWoman(senator) {
  return senator.civilite === 'Mme' || senator.civilite === 'Mlle';
}

function senatorTitle(senator) {
  return isWoman(senator) ? 'Sénatrice' : 'Sénateur';
}

function formerTag(senator) {
  return isWoman(senator) ? 'Ancienne' : 'Ancien';
}

// "Ancienne sénatrice · 1983 – 2001", from the official mandate dates when published.
function formerSenatorLabel(senator) {
  const start = getYear(senator.serviceStart);
  const end = getYear(senator.serviceEnd);
  const period = start && end ? ` · ${start} – ${end}` : end ? ` · jusqu'en ${end}` : '';
  return `${formerTag(senator)} ${senatorTitle(senator).toLowerCase()}${period}`;
}

// Social accounts as published by senat.fr: X handles are bare; Facebook is a URL or a numeric profile id.
function socialLinks(senator) {
  const social = senator.social || {};
  const links = [];
  const twitter = (social.twitter || '').trim().replace(/^@/, '');
  if (/^[A-Za-z0-9_]{1,30}$/.test(twitter)) {
    links.push({ label: `@${twitter}`, network: 'X', url: `https://x.com/${twitter}` });
  }
  const facebook = (social.facebook || '').trim();
  if (/^https?:\/\/([a-z0-9-]+\.)*facebook\.com\//i.test(facebook)) {
    links.push({ label: 'Facebook', network: 'Facebook', url: facebook });
  } else if (/^\d+$/.test(facebook)) {
    links.push({ label: 'Facebook', network: 'Facebook', url: `https://www.facebook.com/profile.php?id=${facebook}` });
  }
  return links;
}

const SOCIAL_ICONS = {
  X: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-7.6 8.7L23 22h-6.8l-5.3-6.9L4.8 22H1.7l8.1-9.3L1 2h7l4.8 6.3L18.9 2zm-1.2 18h1.7L6.4 3.9H4.6L17.7 20z"/></svg>',
  Facebook: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 8h3V4h-3c-2.8 0-5 2.2-5 5v2H7v4h2v7h4v-7h3l1-4h-4V9c0-.6.4-1 1-1z"/></svg>',
};

function renderSocialLinks(senator) {
  const links = socialLinks(senator);
  if (links.length === 0) return '';
  return `<div class="senator-social-links">${links.map(link => `
    <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="senator-social-link"
       title="${escapeHtml(link.network)}" onclick="event.stopPropagation()">
      ${SOCIAL_ICONS[link.network]}<span>${escapeHtml(link.label)}</span>
    </a>`).join('')}</div>`;
}

// Former senators show their last recorded group, as the Senate's history publishes it.
function senatorGroupLabel(senator, groupInfo) {
  if (!senator.group) return 'Groupe non renseigné';
  if (!isFormerSenator(senator)) return `${senator.group} — ${escapeHtml(groupInfo.name)}`;
  const until = getYear(senator.lastGroupEndDate);
  return `Dernier groupe : ${escapeHtml(senator.groupFullName || senator.group)}${until ? ` (jusqu'en ${until})` : ''}`;
}

function renderSenators() {
  const grid = document.getElementById('senators-grid');
  const countEl = document.getElementById('senator-count');
  if (!grid) return;

  if (state.senatorStatusFilter !== 'ACTIF' && !state.formerSenators) {
    if (countEl) countEl.textContent = '';
    if (state.formerSenatorsFailed) {
      grid.innerHTML = `
        <div class="error-state" style="grid-column: 1 / -1;">
          <div class="error-icon">⚠️</div>
          <h3>Anciens sénateurs indisponibles</h3>
          <p>Le serveur n'a pas pu fournir la liste. Vérifiez que le backend est démarré, puis sélectionnez à nouveau le statut.</p>
        </div>
      `;
      return;
    }
    grid.innerHTML = '<div class="loading-state" style="grid-column: 1 / -1;"><div class="loading-spinner"></div><p>Chargement des anciens sénateurs…</p></div>';
    if (!state.formerSenatorsLoading) loadFormerSenators().then(renderSenators);
    return;
  }

  let data = [...getSenatorsForStatus()];

  if (state.senatorGroupFilter !== 'all') {
    data = data.filter(s => s.group === state.senatorGroupFilter);
  }

  const q = state.senatorSearch.toLowerCase().trim();
  if (q) {
    data = data.filter(s => 
      (s.name || '').toLowerCase().includes(q) ||
      (s.dept || '').toLowerCase().includes(q) ||
      (s.commission || '').toLowerCase().includes(q) ||
      (s.groupFullName || '').toLowerCase().includes(q)
    );
  }

  data.sort((a, b) => {
    switch (state.senatorSort) {
      case 'nom-asc': return a.name.localeCompare(b.name, 'fr');
      case 'nom-desc': return b.name.localeCompare(a.name, 'fr');
      case 'group': return (a.group || '').localeCompare(b.group || '', 'fr') || a.name.localeCompare(b.name, 'fr');
      default: return 0;
    }
  });

  state.filteredSenators = data;
  if (countEl) countEl.textContent = `${data.length} sénateur${data.length !== 1 ? 's' : ''}`;

  grid.innerHTML = '';
  if (data.length === 0) {
    grid.innerHTML = `
      <div class="error-state" style="grid-column: 1 / -1;">
        <div class="error-icon">👤</div>
        <h3>Aucun sénateur trouvé</h3>
        <p>Essayez un autre nom de sénateur, département ou groupe politique.</p>
      </div>
    `;
    return;
  }

  data.forEach((senator) => {
    const card = document.createElement('div');
    const former = isFormerSenator(senator);
    card.className = former ? 'senator-card is-former' : 'senator-card';
    const groupColor = getGroupColor(senator.group);
    const groupInfo = POLITICAL_GROUPS[senator.group] || { name: senator.groupFullName || senator.group };
    const initials = senator.initials || getInitials(senator.name);

    const stats = senator.stats || {
      pour: senator.votes ? senator.votes.filter(v => v.vote === 'pour').length : 0,
      contre: senator.votes ? senator.votes.filter(v => v.vote === 'contre').length : 0,
      abstention: senator.votes ? senator.votes.filter(v => v.vote === 'abstention').length : 0
    };

    const hasAvatar = !!senator.avatar;

    card.innerHTML = `
      <div class="senator-card-top">
        <div class="senator-avatar-large" style="border-color:${groupColor}55">
          ${hasAvatar ? `
            <img src="${senator.avatar}" alt="${escapeHtml(senator.name)}" class="senator-photo-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
            <span style="display:none;font-weight:700;color:${groupColor}">${initials}</span>
          ` : `<span style="font-weight:700;color:${groupColor}">${initials}</span>`}
          <div class="senator-avatar-dot" style="background:${groupColor}"></div>
        </div>
        <div class="senator-card-meta">
          <div class="senator-card-name">${escapeHtml(senator.name)}</div>
          <div class="senator-card-dept">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            ${escapeHtml(senator.dept || 'Sénat')}
          </div>
        </div>
      </div>

      <div class="senator-card-group-badge" style="background:${groupColor}18; color:${groupColor}; border-color:${groupColor}33">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${groupColor}"></span>
        ${senatorGroupLabel(senator, groupInfo)}
      </div>

      ${former
        ? `<div class="senator-card-role senator-former-label"><span class="senator-former-tag">${formerTag(senator)}</span>${escapeHtml(formerSenatorLabel(senator))}</div>`
        : `<div class="senator-card-role" title="${escapeHtml(senator.commission || '')}">${escapeHtml(senator.commission || senatorTitle(senator))}</div>`}

      <div class="senator-stats-row">
        <div class="senator-stat-mini">
          <div class="senator-stat-mini-val pour">${stats.pour}</div>
          <div class="senator-stat-mini-label">Pour</div>
        </div>
        <div class="senator-stat-mini">
          <div class="senator-stat-mini-val contre">${stats.contre}</div>
          <div class="senator-stat-mini-label">Contre</div>
        </div>
        <div class="senator-stat-mini">
          <div class="senator-stat-mini-val abst">${stats.abstention}</div>
          <div class="senator-stat-mini-label">Abst.</div>
        </div>
        <div class="senator-card-action">
          Voir votes
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
    `;

    card.addEventListener('click', () => openSenatorModal(senator));
    grid.appendChild(card);
  });
}

// Senator detail modal
function openSenatorModal(senator) {
  const overlay = document.getElementById('senator-modal-overlay');
  const content = document.getElementById('senator-modal-content');
  if (!overlay || !content) return;

  const former = isFormerSenator(senator);
  const groupColor = getGroupColor(senator.group);
  const groupInfo = POLITICAL_GROUPS[senator.group] || { name: senator.groupFullName || senator.group };
  const initials = senator.initials || getInitials(senator.name);
  const stats = senator.stats || { pour: 0, contre: 0, abstention: 0, total: 0 };

  const hasAvatar = !!senator.avatar;

  content.innerHTML = `
    <div class="senator-profile-header">
      <div class="senator-profile-avatar" style="border-color:${groupColor}66; color:${groupColor}">
        ${hasAvatar ? `
          <img src="${senator.avatar}" alt="${escapeHtml(senator.name)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
          <span style="display:none">${initials}</span>
        ` : `<span>${initials}</span>`}
      </div>
      <div class="senator-profile-info">
        <h2 class="senator-profile-name">${escapeHtml(senator.name)}</h2>
        <div class="senator-profile-group" style="background:${groupColor}20; color:${groupColor}; border:1px solid ${groupColor}40">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${groupColor}"></span>
          ${former ? senatorGroupLabel(senator, groupInfo) : `Groupe ${senatorGroupLabel(senator, groupInfo)}`}
        </div>
        ${former
          ? `<div class="senator-profile-status"><span class="senator-former-tag">${formerTag(senator)}</span>${escapeHtml(formerSenatorLabel(senator))}</div>`
          : `<div class="senator-profile-status">${senatorTitle(senator)} en exercice</div>`}
        <div class="senator-profile-dept">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${escapeHtml(senator.dept || 'Sénat')}${former ? '' : ` · <span style="color:var(--color-gold)">${escapeHtml(senator.commission || 'Sénat')}</span>`}
        </div>
        <div class="senator-profile-dept senator-profile-profession">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
          ${senator.profession ? escapeHtml(senator.profession) : '<span style="color:var(--color-text-muted)">Profession non renseignée</span>'}
        </div>
        ${renderSocialLinks(senator)}
      </div>
    </div>

    <div class="senator-detail-metrics">
      <div class="senator-metric-box total">
        <div class="senator-metric-val">${stats.total}</div>
        <div class="senator-metric-label">Votes enregistrés</div>
      </div>
      <div class="senator-metric-box pour">
        <div class="senator-metric-val">${stats.pour}</div>
        <div class="senator-metric-label">Pour</div>
      </div>
      <div class="senator-metric-box contre">
        <div class="senator-metric-val">${stats.contre}</div>
        <div class="senator-metric-label">Contre</div>
      </div>
      <div class="senator-metric-box abstention">
        <div class="senator-metric-val">${stats.abstention}</div>
        <div class="senator-metric-label">Abstention</div>
      </div>
    </div>

    <div class="senator-votes-history-title">
      <span>Parcours politique</span>
    </div>
    <div class="senator-career" id="senator-career">
      <div class="senator-career-message">Chargement du parcours…</div>
    </div>

    <div class="senator-votes-history-title">
      <span>Historique des votes officiels (<span id="senator-history-count">…</span>)</span>
      <span style="font-size:12px;font-weight:400;color:var(--color-text-muted)">Cliquez sur un vote pour afficher le scrutin</span>
    </div>

    <div class="senator-history-list" id="senator-history-list">
      <div class="loading-state"><div class="loading-spinner"></div><p>Chargement de l'historique…</p></div>
    </div>
    <div style="display:flex;justify-content:center;margin-top:12px">
      <button class="btn-secondary" id="senator-history-more" style="display:none">Afficher plus</button>
    </div>

    <div style="margin-top:20px;display:flex;justify-content:flex-end">
      ${senator.url ? `
      <a href="${escapeHtml(senator.url)}" target="_blank" rel="noopener" class="modal-link">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Fiche officielle sur senat.fr
      </a>` : `
      <span class="modal-link is-disabled" aria-disabled="true">Pas de fiche officielle</span>`}
    </div>
  `;

  // Vote numbers restart every session, so a history row identifies its scrutin by both.
  content.querySelector('#senator-history-list').addEventListener('click', (e) => {
    const row = e.target.closest('.history-vote-row');
    if (!row) return;
    const scrutin = state.scrutins.find(s =>
      String(s.session) === row.dataset.scrutinSession && s.number === parseInt(row.dataset.scrutinNum));
    if (scrutin) {
      closeSenatorModal();
      openScrutinModal(scrutin);
    }
  });

  const token = ++senatorHistoryToken;
  content.querySelector('#senator-history-more').addEventListener('click', (e) => {
    loadSenatorHistory(senator, parseInt(e.currentTarget.dataset.offset) || 0, token);
  });
  loadSenatorHistory(senator, 0, token);
  loadSenatorCareer(senator, token);

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

// ============================================================
// Senator voting history (fetched page by page when the panel opens)
// ============================================================
const HISTORY_PAGE_SIZE = 50;
let senatorHistoryToken = 0; // ignores responses for a panel that was closed or replaced

const VOTE_BADGES = {
  pour: ['pour', '✓ Pour'],
  contre: ['contre', '✗ Contre'],
  abstention: ['abstention', '∅ Abs.'],
  non_votant: ['non-votant', '— N.V.'],
};

function voteNotes(v) {
  const notes = [];
  if (v.specialStatus) notes.push(escapeHtml(v.specialStatus));
  if (v.delegatedBy) notes.push(`A aussi voté pour ${escapeHtml(v.delegatedBy)} (délégation)`);
  if (v.hasCorrection) notes.push('A ensuite indiqué une autre intention de vote');
  return notes;
}

function renderHistoryRow(v) {
  const [badgeClass, badgeLabel] = VOTE_BADGES[v.vote] || ['abstention', escapeHtml(v.vote)];
  const notes = voteNotes(v);
  const result = v.scrutinResult === 'adopté'
    ? '<span style="color:var(--color-green)">Adopté</span>'
    : '<span style="color:var(--color-red)">Rejeté</span>';
  return `
    <div class="history-vote-row" data-scrutin-session="${escapeHtml(v.scrutinSession)}" data-scrutin-num="${v.scrutinNumber}">
      <div class="history-vote-badge ${badgeClass}">${badgeLabel}</div>
      <div class="history-scrutin-info">
        <div class="history-scrutin-num">Scrutin n°${v.scrutinNumber} · ${result}</div>
        <div class="history-scrutin-title">${escapeHtml(v.scrutinTitle)}</div>
        ${notes.length ? `<div class="history-vote-note">${notes.join(' · ')}</div>` : ''}
      </div>
      <div class="history-scrutin-date">${formatDate(v.scrutinDate) || '—'}</div>
    </div>
  `;
}

async function loadSenatorHistory(senator, offset, token) {
  const list = document.getElementById('senator-history-list');
  const more = document.getElementById('senator-history-more');
  const countEl = document.getElementById('senator-history-count');
  if (!list) return;
  const message = (text) => `<div style="padding:24px;text-align:center;color:var(--color-text-muted)">${text}</div>`;

  if (!state.isBackendConnected) {
    list.innerHTML = message("L'historique des votes nécessite le serveur (start_backend.bat).");
    if (countEl) countEl.textContent = '—';
    return;
  }
  if (more) more.disabled = true;
  try {
    const page = await fetchJSON(
      `${CONFIG.API_BASE}/api/senateurs/${encodeURIComponent(senator.matricule)}/votes?offset=${offset}&limit=${HISTORY_PAGE_SIZE}`, 15000);
    if (token !== senatorHistoryToken) return;
    if (countEl) countEl.textContent = page.total;
    if (page.total === 0) {
      list.innerHTML = message(isFormerSenator(senator)
        ? 'Les votes individuels ne sont chargés que pour les sénateurs en exercice.'
        : 'Aucun vote individuel enregistré pour ce sénateur.');
      if (more) more.style.display = 'none';
      return;
    }
    if (offset === 0) list.innerHTML = '';
    list.insertAdjacentHTML('beforeend', page.items.map(renderHistoryRow).join(''));
    const loaded = offset + page.items.length;
    if (more) {
      more.dataset.offset = loaded;
      more.textContent = `Afficher plus (${loaded} sur ${page.total})`;
      more.style.display = loaded < page.total ? '' : 'none';
      more.disabled = false;
    }
  } catch (e) {
    if (token !== senatorHistoryToken) return;
    if (offset === 0) list.innerHTML = message("Impossible de charger l'historique des votes.");
    else showToast("Impossible de charger plus de votes", 'error');
    if (more) more.disabled = false;
  }
}

// ============================================================
// Senator political career (group memberships, cleaned for display)
// ============================================================
// The Senate files use internal group codes; map them to the short codes of POLITICAL_GROUPS for colours.
const SENATE_GROUP_CODE_ALIASES = { UMP: 'LR', SOC: 'SER', CRC: 'CRCE-K', LREM: 'RDPI', RTLI: 'LIRT', AUCUN: 'NI' };
const CAREER_MAX_GAP_DAYS = 7; // renewals leave gaps of a few days between memberships

function daysBetween(fromIso, toIso) {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86400000;
}

// Two memberships are "contiguous" when the second starts at most a few days after the first ends.
function isContiguous(prev, next) {
  return !!(prev && next && prev.end_date && next.start_date &&
    daysBetween(prev.end_date, next.start_date) <= CAREER_MAX_GAP_DAYS);
}

function cleanGroupMemberships(memberships) {
  // 1. Drop the technical "no group" entries of a few days that the Senate records at renewals,
  //    right before or after another membership. Genuine longer AUCUN periods are kept.
  const kept = memberships.filter((m, i) => {
    const isTechnical = m.group_code === 'AUCUN' && m.start_date && m.end_date &&
      daysBetween(m.start_date, m.end_date) <= CAREER_MAX_GAP_DAYS;
    return !(isTechnical && (isContiguous(memberships[i - 1], m) || isContiguous(m, memberships[i + 1])));
  });

  // 2. Merge consecutive memberships in the same group (groups are re-formed at each renewal).
  //    Gaps longer than a few days (e.g. the senator left the Senate) remain separate periods.
  const periods = [];
  kept.forEach(m => {
    const last = periods[periods.length - 1];
    const gapOk = last && last.end_date && m.start_date &&
      daysBetween(last.end_date, m.start_date) <= CAREER_MAX_GAP_DAYS;
    if (last && last.group_code === m.group_code && gapOk) last.end_date = m.end_date;
    else periods.push({ ...m });
  });
  return periods;
}

function careerPeriodLabel(p) {
  const today = new Date().toISOString().slice(0, 10);
  const startYear = p.start_date ? p.start_date.slice(0, 4) : null;
  // An end date in the future (published by the Senate) is treated as ongoing.
  const endYear = p.end_date && p.end_date <= today ? p.end_date.slice(0, 4) : null;
  if (!startYear && !endYear) return p.end_date ? 'en cours' : 'dates non renseignées';
  if (!startYear) return `jusqu'en ${endYear}`;
  if (!endYear) return `depuis ${startYear}`;
  return startYear === endYear ? startYear : `${startYear}–${endYear}`;
}

function renderCareerPeriod(p) {
  const color = getGroupColor(SENATE_GROUP_CODE_ALIASES[p.group_code] || p.group_code);
  const exact = `${p.start_date ? formatDate(p.start_date) : 'début non renseigné'} → ${p.end_date ? formatDate(p.end_date) : 'en cours'}`;
  return `
    <li class="senator-career-item" title="${escapeHtml(exact)}">
      <span class="senator-career-dot" style="background:${color}"></span>
      <span class="senator-career-code" style="background:${color}20; color:${color}; border-color:${color}40">${escapeHtml(p.group_code)}</span>
      <span class="senator-career-name">${escapeHtml(p.group_name || p.group_code)}</span>
      <span class="senator-career-years">${escapeHtml(careerPeriodLabel(p))}</span>
    </li>
  `;
}

async function loadSenatorCareer(senator, token) {
  const box = document.getElementById('senator-career');
  if (!box) return;
  const message = (text) => `<div class="senator-career-message">${text}</div>`;

  if (!state.isBackendConnected) {
    box.innerHTML = message('Le parcours politique nécessite le serveur (start_backend.bat).');
    return;
  }
  try {
    const detail = await fetchJSON(`${CONFIG.API_BASE}/api/v1/senators/${encodeURIComponent(senator.matricule)}`, 15000);
    if (token !== senatorHistoryToken) return;
    const periods = cleanGroupMemberships(detail.group_memberships || []);
    if (!periods.length) {
      box.innerHTML = message('Aucune appartenance à un groupe enregistrée.');
      return;
    }
    box.innerHTML = `
      <ol class="senator-career-list">${periods.map(renderCareerPeriod).join('')}</ol>
      <div class="senator-career-note">Les noms sont les noms actuels des groupes, tels que publiés par le Sénat pour chaque code.</div>
    `;
  } catch (e) {
    if (token !== senatorHistoryToken) return;
    box.innerHTML = message('Impossible de charger le parcours politique.');
  }
}

function closeSenatorModal() {
  const overlay = document.getElementById('senator-modal-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

// ============================================================
// Scrutin Modal Details
// ============================================================
function openScrutinModal(scrutin) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  if (!overlay || !content) return;

  const total = scrutin.pour + scrutin.contre + scrutin.abstention;
  const pourPct = total > 0 ? (scrutin.pour / total * 100).toFixed(1) : 0;
  const contrePct = total > 0 ? (scrutin.contre / total * 100).toFixed(1) : 0;
  const abstPct = total > 0 ? (scrutin.abstention / total * 100).toFixed(1) : 0;
  const resultClass = scrutin.result === 'adopté' ? 'adopté' : 'rejeté';
  const resultLabel = scrutin.result === 'adopté' ? '✓ Adopté' : '✗ Rejeté';

  const hasGroups = scrutin.groups && scrutin.groups.length > 0;

  content.innerHTML = `
    <div class="modal-header">
      <div class="modal-badge-row">
        <div class="card-number">Scrutin public n°${scrutin.number}</div>
        <div class="result-badge ${resultClass}">${resultLabel}</div>
        <div class="result-badge unknown" style="background:rgba(34,197,94,0.15);color:var(--color-green)">Données officielles sénat.fr</div>
      </div>
      <h2 class="modal-title" id="modal-title">${escapeHtml(scrutin.title) || '(sans titre)'}</h2>
      <div class="modal-meta">
        <div class="modal-meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${formatDate(scrutin.date) || scrutin.date || '—'}
        </div>
        <div class="modal-meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
          Session ${scrutin.session || '2024'}
        </div>
        <div class="modal-meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          ${scrutin.total || total} votants
        </div>
      </div>
    </div>

    <div class="modal-vote-summary">
      <div class="vote-summary-title">Résultats officiels du vote</div>
      <div class="vote-summary-grid">
        <div class="vote-summary-item">
          <div class="vote-summary-num pour">${scrutin.pour}</div>
          <div class="vote-summary-label">Pour (${pourPct}%)</div>
        </div>
        <div class="vote-summary-item">
          <div class="vote-summary-num contre">${scrutin.contre}</div>
          <div class="vote-summary-label">Contre (${contrePct}%)</div>
        </div>
        <div class="vote-summary-item">
          <div class="vote-summary-num abstention">${scrutin.abstention}</div>
          <div class="vote-summary-label">Abstentions</div>
        </div>
        <div class="vote-summary-item">
          <div class="vote-summary-num total">${scrutin.total || total}</div>
          <div class="vote-summary-label">Votants</div>
        </div>
      </div>
      <div class="vote-big-bar">
        <div class="vote-big-bar-pour" style="width:${pourPct}%"></div>
        <div class="vote-big-bar-contre" style="width:${contrePct}%"></div>
        <div class="vote-big-bar-abstention" style="width:${abstPct}%"></div>
      </div>
    </div>

    ${hasGroups ? `
    <div class="modal-section">
      <div class="modal-section-title">Votes ventilés par groupe politique</div>
      <div class="groups-list">
        ${scrutin.groups.map(g => {
          const gTotal = g.pour + g.contre + g.abstention;
          const gPourPct = gTotal > 0 ? (g.pour / gTotal * 100).toFixed(0) : 0;
          const color = getGroupColor(g.code);
          return `
          <div class="group-row">
            <div class="group-dot" style="background:${color}"></div>
            <div class="group-name" title="${escapeHtml(g.name || g.code)}">${escapeHtml(g.name || g.code)}</div>
            <div class="group-bar">
              <div class="group-bar-pour" style="width:${gPourPct}%; background:${color}"></div>
              <div class="group-bar-contre" style="width:${100-parseInt(gPourPct)}%"></div>
            </div>
            <div class="group-votes">
              ${g.pour > 0 ? `<div class="group-vote-item pour">✓ ${g.pour}</div>` : ''}
              ${g.contre > 0 ? `<div class="group-vote-item contre">✗ ${g.contre}</div>` : ''}
              ${g.abstention > 0 ? `<div class="group-vote-item abstention">∅ ${g.abstention}</div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
    ` : ''}

    <div id="scrutin-voters-section">
      <div class="modal-section"><div class="loading-state"><div class="loading-spinner"></div><p>Chargement des votes nominatifs…</p></div></div>
    </div>

    <a href="${scrutin.url || '#'}" target="_blank" rel="noopener" class="modal-link">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      Consulter ce scrutin sur senat.fr
    </a>
  `;

  loadScrutinVoters(scrutin, ++scrutinVotersToken);

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

// ============================================================
// Scrutin voters and corrections (fetched when the panel opens)
// ============================================================
let scrutinVotersToken = 0; // ignores responses for a panel that was closed or replaced

const VOTER_TABS = [
  ['pour', '✓ Pour'],
  ['contre', '✗ Contre'],
  ['abstention', '∅ Abstentions'],
  ['non_votant', '— Non-votants'],
];

function renderScrutinVoters(detail) {
  const senateurs = detail.senateurs;
  const corrections = detail.corrections || [];
  const correctionsHtml = corrections.length === 0 ? '' : `
    <div class="modal-section">
      <div class="modal-section-title">Mises au point après le vote</div>
      <ul class="vote-corrections">
        ${corrections.map(c => `
          <li>${escapeHtml(c.text)}${c.url && /^https?:\/\//.test(c.url)
            ? ` <a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">compte rendu</a>` : ''}</li>`).join('')}
      </ul>
    </div>`;

  if (detail.listedVoters === 0) {
    return `
      <div class="modal-section">
        <div class="modal-section-title">Votes nominatifs</div>
        <div class="voters-scope-note">Aucun vote individuel chargé pour ce scrutin : seuls les votes des sénateurs actuellement en exercice sont disponibles.</div>
      </div>${correctionsHtml}`;
  }
  return `
    <div class="modal-section">
      <div class="modal-section-title">Votes des sénateurs actuellement en exercice (cliquez pour ouvrir la fiche)</div>
      <div class="voters-scope-note">${detail.listedVoters} sénateurs en exercice aujourd'hui figurent dans ce scrutin. Les autres votants ne sont pas chargés, la liste est donc partielle.</div>
      <div class="vote-tabs" id="vote-tabs">
        ${VOTER_TABS.map(([type, label], i) => `
          <button class="vote-tab ${type}${i === 0 ? ' active' : ''}" data-tab="${type}">
            ${label} <span class="vote-tab-count">${senateurs[type].length}</span>
          </button>`).join('')}
      </div>
      <div class="senators-list" id="senators-list">
        ${renderVotersList(senateurs.pour, 'pour')}
      </div>
    </div>${correctionsHtml}`;
}

async function loadScrutinVoters(scrutin, token) {
  const section = document.getElementById('scrutin-voters-section');
  if (!section) return;
  if (!state.isBackendConnected) {
    section.innerHTML = '';
    return;
  }
  let detail;
  try {
    detail = await fetchJSON(
      `${CONFIG.API_BASE}/api/scrutins/${encodeURIComponent(scrutin.session)}/${scrutin.number}`, 15000);
    if (token !== scrutinVotersToken) return;
    section.innerHTML = renderScrutinVoters(detail);
  } catch (e) {
    if (token !== scrutinVotersToken) return;
    section.innerHTML = '<div class="modal-section"><div class="voters-scope-note">Impossible de charger les votes nominatifs.</div></div>';
    return;
  }

  const tabs = section.querySelector('#vote-tabs');
  const senList = section.querySelector('#senators-list');
  if (!tabs || !senList) return;
  tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (!tab) return;
    tabs.querySelectorAll('.vote-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    senList.innerHTML = renderVotersList(detail.senateurs[tab.dataset.tab] || [], tab.dataset.tab);
    attachVoterClickListeners(senList);
  });
  attachVoterClickListeners(senList);
}

function normalizeName(str) {
  if (!str) return '';
  return str.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
}

function findSenatorByName(voterName) {
  if (!voterName || !state.senators || state.senators.length === 0) return null;
  const targetNorm = normalizeName(voterName);

  // 1. Direct exact normalized name match
  let match = state.senators.find(s => normalizeName(s.name) === targetNorm);
  if (match) return match;

  // 2. Normalized contains match
  match = state.senators.find(s => {
    const sNorm = normalizeName(s.name);
    return sNorm.includes(targetNorm) || targetNorm.includes(sNorm);
  });
  if (match) return match;

  // 3. Match by last name
  const words = voterName.trim().split(/\s+/);
  if (words.length > 0) {
    const lastNameNorm = normalizeName(words[words.length - 1]);
    if (lastNameNorm.length >= 3) {
      match = state.senators.find(s => normalizeName(s.nom) === lastNameNorm);
      if (match) return match;
    }
  }

  return null;
}

function renderVotersList(voters, type) {
  if (!voters || voters.length === 0) {
    return '<div class="vote-count" style="padding:24px;color:var(--color-text-muted);text-align:center">Aucun sénateur enregistré dans cette position</div>';
  }
  const icons = { pour: '✓', contre: '✗', abstention: '∅', non_votant: '—' };
  return voters.map(s => {
    const senator = findVoterSenator(s);
    const grp = s.group || senator?.group || 'NI';
    const grpColor = getGroupColor(grp);
    const avatar = senator?.avatar;
    const initials = senator?.initials || getInitials(s.name);
    const notes = voteNotes(s);

    return `
      <div class="senator-item" data-senator-id="${escapeHtml(s.id || '')}" data-senator-name="${escapeHtml(s.name)}" style="cursor:pointer" title="Voir la fiche de ${escapeHtml(s.name)}">
        <div class="senator-avatar" style="background:${grpColor}20; color:${grpColor}; border:1px solid ${grpColor}44">
          ${avatar ? `
            <img src="${avatar}" alt="${escapeHtml(s.name)}" class="voter-photo-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
            <span style="display:none">${initials}</span>
          ` : `<span>${initials}</span>`}
        </div>
        <div class="senator-info">
          <div class="senator-name">${escapeHtml(s.name)}${s.hasCorrection ? ' *' : ''}</div>
          <div class="senator-group" style="color:${grpColor}">${escapeHtml(grp)}</div>
          ${notes.length ? `<div class="voter-note">${notes.join(' · ')}</div>` : ''}
        </div>
        <div class="vote-icon">${icons[type] || ''}</div>
      </div>
    `;
  }).join('');
}

// Voters from the API carry the senator's matricule; fall back to the name for older data.
function findVoterSenator(voter) {
  return (voter.id && state.senators.find(s => s.matricule === voter.id)) || findSenatorByName(voter.name);
}

function attachVoterClickListeners(container) {
  container.querySelectorAll('.senator-item').forEach(item => {
    item.addEventListener('click', () => {
      const senator = findVoterSenator({ id: item.dataset.senatorId, name: item.dataset.senatorName });
      if (senator) {
        closeScrutinModal();
        openSenatorModal(senator);
      }
    });
  });
}


function closeScrutinModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

// ============================================================
// Groupes View
// ============================================================
function renderGroups() {
  const container = document.getElementById('groups-grid');
  if (!container) return;

  const totalSenateSeats = getTotalSeats();
  const groupsKeys = Object.keys(POLITICAL_GROUPS);

  container.innerHTML = groupsKeys.map(code => {
    const grp = POLITICAL_GROUPS[code];
    const color = getGroupColor(code);
    const seats = getGroupSeats(code);
    const pct = ((seats / totalSenateSeats) * 100).toFixed(1);
    const countInCatalog = state.senators.filter(s => s.group === code).length;

    return `
      <div class="group-card">
        <div class="group-card-stripe" style="background:${color}"></div>
        <div class="group-card-header">
          <div class="group-card-badge" style="background:${color}20; color:${color}; border:1px solid ${color}40">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}"></span>
            ${code}
          </div>
          <div class="group-card-seats">
            <div class="group-card-seats-num">${seats}</div>
            <div class="group-card-seats-label">sièges (${pct}%)</div>
          </div>
        </div>

        <h3 class="group-card-title">${escapeHtml(grp.name)}</h3>
        ${grp.desc ? `<p class="group-card-desc">${escapeHtml(grp.desc)}</p>` : ''}

        <div class="group-card-leader">
          <span>Président(e) de groupe :</span>
          <strong>${escapeHtml(getGroupLeader(code))}</strong>
        </div>

        <div class="group-cohesion-box">
          <div class="group-cohesion-header">
            <span>Poids officiel dans l'hémicycle</span>
            <span style="color:${color}">${pct}%</span>
          </div>
          <div class="group-cohesion-bar">
            <div class="group-cohesion-fill" style="width:${pct}%; background:${color}"></div>
          </div>
        </div>

        <div class="group-card-footer">
          <span style="font-size:12px;color:var(--color-text-muted)">${escapeHtml(grp.orientation)}</span>
          <button class="btn-view-group-senators" data-group="${code}">
            Voir les sénateurs (${countInCatalog})
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-view-group-senators').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupCode = btn.dataset.group;
      const select = document.getElementById('senator-group-filter');
      if (select) select.value = groupCode;
      state.senatorGroupFilter = groupCode;
      switchView('senateurs');
    });
  });
}

// ============================================================
// Statistiques View
// ============================================================
function renderStats() {
  const container = document.getElementById('stats-content');
  if (!container) return;

  const scrutins = getSessionScrutins();
  const sessionLabel = state.selectedSession === 'all'
    ? 'Toutes les sessions'
    : `Session ${formatSessionRange(state.selectedSession)}`;
  const totalScrutins = scrutins.length;
  const adoptes = scrutins.filter(s => s.result === 'adopté').length;
  const rejetes = scrutins.filter(s => s.result === 'rejeté').length;
  const adoptionRate = totalScrutins > 0 ? Math.round((adoptes / totalScrutins) * 100) : 0;

  const totalVotesCast = scrutins.reduce((acc, s) => acc + (s.total || s.pour + s.contre + s.abstention), 0);
  const avgVoters = totalScrutins > 0 ? Math.round(totalVotesCast / totalScrutins) : 340;

  const totalSenateSeats = getTotalSeats();

  const closestVotes = [...scrutins]
    .filter(s => s.pour > 0 && s.contre > 0)
    .sort((a, b) => Math.abs(a.pour - a.contre) - Math.abs(b.pour - b.contre))
    .slice(0, 6);

  container.innerHTML = `
    <div class="stats-dashboard">
      <div class="stats-summary-grid">
        <div class="stat-summary-card" style="--stat-accent: var(--color-blue)">
          <div class="stat-summary-label">Scrutins publics analysés</div>
          <div class="stat-summary-num">${totalScrutins}</div>
          <div class="stat-summary-sub">${sessionLabel}</div>
        </div>
        <div class="stat-summary-card" style="--stat-accent: var(--color-green)">
          <div class="stat-summary-label">Textes & amendements adoptés</div>
          <div class="stat-summary-num">${adoptes}</div>
          <div class="stat-summary-sub">${adoptionRate}% de taux d'adoption</div>
        </div>
        <div class="stat-summary-card" style="--stat-accent: var(--color-red)">
          <div class="stat-summary-label">Textes rejetés</div>
          <div class="stat-summary-num">${rejetes}</div>
          <div class="stat-summary-sub">${100 - adoptionRate}% de rejets ou motions</div>
        </div>
        <div class="stat-summary-card" style="--stat-accent: var(--color-gold)">
          <div class="stat-summary-label">Moyenne de votants</div>
          <div class="stat-summary-num">${avgVoters}</div>
          <div class="stat-summary-sub">Sur ${totalSenateSeats} sénateurs en exercice</div>
        </div>
      </div>

      <div class="stats-charts-row">
        <div class="stats-chart-card">
          <div class="stats-chart-title">
            <span>Issue des scrutins au Sénat</span>
            <span style="font-size:12px;color:var(--color-text-muted)">Pourcentage officiel</span>
          </div>
          <div class="chart-distribution-bars">
            <div class="chart-bar-group">
              <div class="chart-bar-label-row">
                <span class="chart-bar-name">Textes et amendements adoptés</span>
                <span class="chart-bar-value" style="color:var(--color-green)">${adoptes} (${adoptionRate}%)</span>
              </div>
              <div class="chart-bar-track">
                <div class="chart-bar-fill" style="width:${adoptionRate}%; background:var(--color-green)"></div>
              </div>
            </div>
            <div class="chart-bar-group">
              <div class="chart-bar-label-row">
                <span class="chart-bar-name">Textes rejetés</span>
                <span class="chart-bar-value" style="color:var(--color-red)">${rejetes} (${100 - adoptionRate}%)</span>
              </div>
              <div class="chart-bar-track">
                <div class="chart-bar-fill" style="width:${100 - adoptionRate}%; background:var(--color-red)"></div>
              </div>
            </div>
          </div>

          <div style="margin-top:28px;padding-top:20px;border-top:1px solid var(--color-border-subtle)">
            <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:8px">Majorité et répartition politique</div>
            <div style="display:flex;height:12px;border-radius:6px;overflow:hidden;gap:2px">
              ${Object.keys(POLITICAL_GROUPS).filter(code => getGroupSeats(code) > 0).map(code => {
                const seats = getGroupSeats(code);
                const pct = ((seats / totalSenateSeats) * 100).toFixed(1);
                // Grow by seats from a zero basis: segments share the width left after
                // the 2px gaps, so the bar fits exactly and the last group stays visible.
                return `<div style="flex:${seats} 1 0;min-width:0;background:${getGroupColor(code)}" title="${code}: ${seats} sièges (${pct}%)"></div>`;
              }).join('')}
            </div>
          </div>
        </div>

        <div class="stats-chart-card">
          <div class="stats-chart-title">
            <span>Votes les plus disputés</span>
            <span style="font-size:12px;color:var(--color-text-muted)">Plus faible écart de voix</span>
          </div>
          <div class="close-votes-list">
            ${closestVotes.map(v => {
              const diff = Math.abs(v.pour - v.contre);
              return `
                <div class="close-vote-item" data-scrutin-session="${escapeHtml(String(v.session ?? ''))}" data-scrutin-num="${v.number}">
                  <span style="font-size:11px;font-weight:700;color:var(--color-gold);flex-shrink:0;min-width:64px;white-space:nowrap;line-height:1.3">n°${v.number}<span style="display:block;font-size:10px;font-weight:500;color:var(--color-text-muted)">${formatSessionRange(v.session)}</span></span>
                  <span class="close-vote-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</span>
                  <span class="close-vote-margin tight">± ${diff} voix</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('.close-vote-item').forEach(item => {
    item.addEventListener('click', () => {
      const scrutin = findScrutin(item.dataset.scrutinSession, item.dataset.scrutinNum);
      if (scrutin) openScrutinModal(scrutin);
    });
  });
}

// Vote numbers restart every session (October), so a scrutin is only
// identified by session + number together.
function findScrutin(session, number) {
  const num = parseInt(number);
  return state.scrutins.find(s => String(s.session) === String(session) && s.number === num);
}

// Session "2016" = parliamentary year 2016-2017.
function formatSessionRange(session) {
  const y = parseInt(session);
  return Number.isFinite(y) ? `${y}-${y + 1}` : '';
}

// ============================================================
// Global Search
// ============================================================
function performSearch(query) {
  const container = document.getElementById('search-results');
  if (!container) return;

  if (!query.trim()) {
    container.innerHTML = '';
    return;
  }
  const q = query.toLowerCase();

  const matchedScrutins = state.scrutins.filter(s =>
    (s.title || '').toLowerCase().includes(q) ||
    (s.number || '').toString().includes(q)
  ).slice(0, 5);

  const matchedSenators = state.senators.filter(s =>
    (s.name || '').toLowerCase().includes(q) ||
    (s.dept || '').toLowerCase().includes(q) ||
    (s.group || '').toLowerCase().includes(q)
  ).slice(0, 5);

  if (matchedScrutins.length === 0 && matchedSenators.length === 0) {
    container.innerHTML = `<div class="search-no-results">Aucun résultat trouvé pour « ${escapeHtml(query)} »</div>`;
    return;
  }

  let html = '';
  if (matchedScrutins.length > 0) {
    html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--color-gold);padding:8px 16px;">Scrutins officiels</div>`;
    html += matchedScrutins.map(s => {
      const rc = s.result === 'adopté' ? '#22c55e' : '#ef4444';
      const rl = s.result === 'adopté' ? 'Adopté' : 'Rejeté';
      return `
        <div class="search-result-item" data-scrutin-session="${escapeHtml(String(s.session ?? ''))}" data-scrutin-num="${s.number}">
          <div style="flex:1">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:4px">
              <span style="font-size:12px;font-weight:700;color:var(--color-gold)">Scrutin n°${s.number}</span>
              <span style="font-size:11px;color:var(--color-text-muted)">Session ${formatSessionRange(s.session)}</span>
              <span style="font-size:11px;color:${rc};font-weight:600">${rl}</span>
            </div>
            <div style="font-size:13px;color:var(--color-text-secondary);line-height:1.4">${escapeHtml(s.title).slice(0, 110)}…</div>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:var(--color-text-muted)"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      `;
    }).join('');
  }

  if (matchedSenators.length > 0) {
    html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--color-blue);padding:14px 16px 8px;">Sénateurs</div>`;
    html += matchedSenators.map(sen => {
      const grpColor = getGroupColor(sen.group);
      const initials = getInitials(sen.name);
      return `
        <div class="search-result-item" data-senator-name="${escapeHtml(sen.name)}">
          <div style="width:32px;height:32px;border-radius:8px;background:${grpColor}20;color:${grpColor};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;margin-right:12px;overflow:hidden;flex-shrink:0">
            ${sen.avatar ? `
              <img src="${escapeHtml(sen.avatar)}" alt="${escapeHtml(sen.name)}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
              <span style="display:none">${initials}</span>
            ` : initials}
          </div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:var(--color-text-primary)">${escapeHtml(sen.name)}</div>
            <div style="font-size:11px;color:var(--color-text-muted)">${sen.group} · ${escapeHtml(sen.dept || '')}</div>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:var(--color-text-muted)"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      `;
    }).join('');
  }

  container.innerHTML = html;

  container.querySelectorAll('[data-scrutin-num]').forEach(item => {
    item.addEventListener('click', () => {
      const scrutin = findScrutin(item.dataset.scrutinSession, item.dataset.scrutinNum);
      if (scrutin) {
        closeSearch();
        openScrutinModal(scrutin);
      }
    });
  });

  container.querySelectorAll('[data-senator-name]').forEach(item => {
    item.addEventListener('click', () => {
      const name = item.dataset.senatorName.toLowerCase().trim();
      const senator = state.senators.find(s => s.name.toLowerCase() === name);
      if (senator) {
        closeSearch();
        openSenatorModal(senator);
      }
    });
  });
}

function openSearch() {
  document.getElementById('search-overlay')?.classList.add('open');
  document.getElementById('search-input')?.focus();
  document.body.style.overflow = 'hidden';
}
function closeSearch() {
  document.getElementById('search-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  const results = document.getElementById('search-results');
  if (results) results.innerHTML = '';
}

function createParticles() {
  const container = document.getElementById('hero-particles');
  if (!container) return;
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 3 + 1;
    p.style.cssText = `
      width: ${size}px; height: ${size}px;
      background: ${Math.random() > 0.5 ? '#c9a84c' : '#3b82f6'};
      left: ${Math.random() * 100}%;
      bottom: -${size}px;
      animation-duration: ${Math.random() * 15 + 10}s;
      animation-delay: ${Math.random() * 10}s;
    `;
    container.appendChild(p);
  }
}

function populateSenatorGroupFilter() {
  const select = document.getElementById('senator-group-filter');
  if (!select) return;
  select.innerHTML = '<option value="all">Tous les groupes</option>';
  Object.keys(POLITICAL_GROUPS).forEach(code => {
    const grp = POLITICAL_GROUPS[code];
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${code} — ${grp.name}`;
    select.appendChild(opt);
  });
}

// ============================================================
// Main Bootstrap
// ============================================================
async function init() {
  createParticles();
  populateSenatorGroupFilter();

  window.addEventListener('scroll', () => {
    const header = document.getElementById('site-header');
    if (header) {
      if (window.scrollY > 60) header.classList.add('scrolled');
      else header.classList.remove('scrolled');
    }
  }, { passive: true });

  const hamburger = document.getElementById('hamburger-btn');
  const navLinks = document.getElementById('nav-links');
  hamburger?.addEventListener('click', () => navLinks?.classList.toggle('open'));

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.currentFilter = chip.dataset.filter;
      state.currentPage = 0;
      renderScrutins();
    });
  });

  document.getElementById('year-select')?.addEventListener('change', (e) => {
    state.selectedSession = e.target.value || 'all';
    state.currentPage = 0;
    if (state.currentView === 'scrutins') renderScrutins();
    else if (state.currentView === 'stats') renderStats();
  });

  document.getElementById('sort-select')?.addEventListener('change', (e) => {
    state.currentSort = e.target.value;
    state.currentPage = 0;
    renderScrutins();
  });

  let searchDebounce;
  document.getElementById('inline-search')?.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.searchTerm = e.target.value;
      state.currentPage = 0;
      renderScrutins();
    }, 250);
  });

  let senSearchDebounce;
  document.getElementById('senator-search')?.addEventListener('input', (e) => {
    clearTimeout(senSearchDebounce);
    senSearchDebounce = setTimeout(() => {
      state.senatorSearch = e.target.value;
      renderSenators();
    }, 200);
  });

  document.getElementById('senator-status-filter')?.addEventListener('change', (e) => {
    state.senatorStatusFilter = e.target.value;
    state.formerSenatorsFailed = false; // choosing a status again retries a failed load
    renderSenators();
  });

  document.getElementById('senator-group-filter')?.addEventListener('change', (e) => {
    state.senatorGroupFilter = e.target.value;
    renderSenators();
  });

  document.getElementById('senator-sort')?.addEventListener('change', (e) => {
    state.senatorSort = e.target.value;
    renderSenators();
  });

  document.getElementById('refresh-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('refresh-btn');
    btn?.classList.add('spinning');
    await loadData();
    btn?.classList.remove('spinning');
  });

  document.getElementById('load-more-btn')?.addEventListener('click', () => {
    state.currentPage++;
    renderScrutins();
  });

  document.getElementById('explore-btn')?.addEventListener('click', () => {
    document.getElementById('view-scrutins')?.scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('header-search-btn')?.addEventListener('click', openSearch);
  document.getElementById('hero-search-btn')?.addEventListener('click', openSearch);
  document.getElementById('search-close-btn')?.addEventListener('click', closeSearch);

  let globalSearchDebounce;
  document.getElementById('search-input')?.addEventListener('input', (e) => {
    clearTimeout(globalSearchDebounce);
    globalSearchDebounce = setTimeout(() => performSearch(e.target.value), 200);
  });

  document.getElementById('search-overlay')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
  });

  document.getElementById('modal-close-btn')?.addEventListener('click', closeScrutinModal);
  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeScrutinModal();
  });

  document.getElementById('senator-modal-close-btn')?.addEventListener('click', closeSenatorModal);
  document.getElementById('senator-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSenatorModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeScrutinModal();
      closeSenatorModal();
      closeSearch();
    }
  });

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const view = link.dataset.view;
      if (view) {
        switchView(view);
        navLinks?.classList.remove('open');
      }
    });
  });

  document.getElementById('logo-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchView('scrutins');
  });

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (['scrutins', 'senateurs', 'groupes', 'stats'].includes(hash)) {
      switchView(hash);
    }
  });

  await loadData();

  const initialHash = window.location.hash.replace('#', '');
  if (['scrutins', 'senateurs', 'groupes', 'stats'].includes(initialHash)) {
    switchView(initialHash);
  }
}

async function loadData() {
  const grid = document.getElementById('scrutins-grid');
  if (grid) grid.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p>Chargement des données officielles du Sénat…</p></div>`;

  const data = await loadOfficialData();
  if (data && data.senators && data.scrutins) {
    state.senators = data.senators;
    state.filteredSenators = [...state.senators];
    state.scrutins = data.scrutins;
    state.filteredScrutins = [...state.scrutins];
    state.statsData = data.stats;
    state.currentPage = 0;
    populateSessionSelect();

    if (state.currentView === 'scrutins') renderScrutins();
    else if (state.currentView === 'senateurs') renderSenators();
    else if (state.currentView === 'groupes') renderGroups();
    else if (state.currentView === 'stats') renderStats();
  }
}

document.addEventListener('DOMContentLoaded', init);
