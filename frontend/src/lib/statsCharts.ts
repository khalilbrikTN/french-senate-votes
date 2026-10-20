// Pure data shaping for the Statistics charts (no React, no ECharts): easy to test.
import type { GroupStats, Scrutin } from '../types';

// Left → right as the groups sit politically. RDSE (radical, centre-left) is placed left of
// RDPI (macronist centre): in 2025-2026 RDSE voted like SER on 70 % of the votes and like UC
// on 44 %, RDPI 47 % and 67 % (see /api/stats/groups). UNT (created in October 2026, allied
// with the RN) sits right of LR; the non-inscrits close the arc.
export const HEMICYCLE_ORDER = ['CRCE-K', 'GEST', 'SER', 'RDSE', 'RDPI', 'UC', 'LIRT', 'LR', 'UNT', 'NI'];
// Same order for the group analyses; ECO (groupe écologiste 2012-2017) sits with GEST.
// The non-inscrits are not a group (no common line), so they are left out there.
export const GROUP_ANALYSIS_ORDER = ['CRCE-K', 'ECO', 'GEST', 'SER', 'RDSE', 'RDPI', 'UC', 'LIRT', 'LR', 'UNT'];

// Individual votes exist only for the senators sitting today. Below COVERAGE_MIN of the
// official voters the group figures of a session are not shown; between COVERAGE_MIN and
// COVERAGE_RELIABLE they are shown and flagged as partial.
export const COVERAGE_RELIABLE = 0.7;
export const COVERAGE_MIN = 0.5;
export const CLOSE_VOTE_MARGIN = 10;
// A pair (agreement) or a group-session (cohesion) needs this many votes to be shown.
export const MIN_VOTES_FOR_RATE = 10;

export const isAdopted = (scrutin: Pick<Scrutin, 'result'>) => scrutin.result === 'adopté';

// ---------- Activity per month ----------

export interface MonthlyActivity {
  months: string[]; // 'YYYY-MM', every month between the first and the last vote
  adopted: number[];
  rejected: number[];
}

export function monthKey(date: string | null | undefined): string | null {
  const match = date?.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function nextMonth(key: string): string {
  let [y, m] = key.split('-').map(Number);
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function monthlyActivity(scrutins: Scrutin[]): MonthlyActivity {
  const counts = new Map<string, { adopted: number; rejected: number }>();
  for (const scrutin of scrutins) {
    const key = monthKey(scrutin.date);
    if (!key) continue;
    const entry = counts.get(key) ?? { adopted: 0, rejected: 0 };
    if (isAdopted(scrutin)) entry.adopted += 1; else entry.rejected += 1;
    counts.set(key, entry);
  }
  const keys = [...counts.keys()].sort();
  const result: MonthlyActivity = { months: [], adopted: [], rejected: [] };
  if (!keys.length) return result;
  const last = keys[keys.length - 1];
  for (let key = keys[0]; key <= last; key = nextMonth(key)) {
    const entry = counts.get(key);
    result.months.push(key);
    result.adopted.push(entry?.adopted ?? 0);
    result.rejected.push(entry?.rejected ?? 0);
  }
  return result;
}

const MONTH_LONG = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const MONTH_SHORT = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

export function formatMonth(key: string, style: 'long' | 'short' = 'long'): string {
  const [y, m] = key.split('-').map(Number);
  const date = new Date(y, m - 1, 1);
  return style === 'long' ? MONTH_LONG.format(date) : MONTH_SHORT.format(date);
}

// ---------- Adoption per session ----------

export interface SessionAdoption {
  session: string;
  total: number;
  adopted: number;
  rejected: number;
  rate: number; // % adopted, one decimal
}

export function adoptionBySession(scrutins: Scrutin[]): SessionAdoption[] {
  const bySession = new Map<string, SessionAdoption>();
  for (const scrutin of scrutins) {
    const session = String(scrutin.session ?? '');
    if (!/^\d+$/.test(session)) continue;
    const entry = bySession.get(session) ?? { session, total: 0, adopted: 0, rejected: 0, rate: 0 };
    entry.total += 1;
    if (isAdopted(scrutin)) entry.adopted += 1; else entry.rejected += 1;
    bySession.set(session, entry);
  }
  return [...bySession.values()]
    .map(entry => ({ ...entry, rate: Math.round(entry.adopted / entry.total * 1000) / 10 }))
    .sort((a, b) => parseInt(a.session) - parseInt(b.session));
}

// ---------- Margins ----------

export interface MarginBin {
  from: number; // inclusive
  to: number; // exclusive
  adopted: number;
  rejected: number;
}

export interface MarginHistogram {
  bins: MarginBin[];
  binSize: number;
  close: number; // votes decided by fewer than CLOSE_VOTE_MARGIN votes
  total: number; // votes with at least one pour or contre
}

// Distribution of |pour − contre|. Votes without any pour/contre (no count published) are skipped.
export function marginHistogram(scrutins: Scrutin[], binSize = 10, closeMargin = CLOSE_VOTE_MARGIN): MarginHistogram {
  const margins: Array<{ margin: number; adopted: boolean }> = [];
  for (const scrutin of scrutins) {
    if (scrutin.pour + scrutin.contre <= 0) continue;
    margins.push({ margin: Math.abs(scrutin.pour - scrutin.contre), adopted: isAdopted(scrutin) });
  }
  if (!margins.length) return { bins: [], binSize, close: 0, total: 0 };
  const max = Math.max(...margins.map(m => m.margin));
  const bins: MarginBin[] = Array.from({ length: Math.floor(max / binSize) + 1 }, (_, i) => ({
    from: i * binSize, to: (i + 1) * binSize, adopted: 0, rejected: 0,
  }));
  for (const { margin, adopted } of margins) {
    const bin = bins[Math.floor(margin / binSize)];
    if (adopted) bin.adopted += 1; else bin.rejected += 1;
  }
  return { bins, binSize, close: margins.filter(m => m.margin < closeMargin).length, total: margins.length };
}

export function closestVotes(scrutins: Scrutin[], count = 6): Scrutin[] {
  return [...scrutins]
    .filter(scrutin => scrutin.pour > 0 && scrutin.contre > 0)
    .sort((a, b) => Math.abs(a.pour - a.contre) - Math.abs(b.pour - b.contre))
    .slice(0, count);
}

// ---------- Hemicycle ----------

export interface Seat {
  x: number; // unit semicircle: x in [-1, 1], y in [0, 1]
  y: number;
  row: number;
  angle: number; // radians, π = far left, 0 = far right
}

export interface HemicycleLayout {
  seats: Seat[]; // ordered left → right
  rows: number;
  dotRadius: number; // in the same unit as x/y
}

// Standard row-by-row parliament layout: concentric rows between innerRatio and 1, seats per
// row proportional to the row's length, the row count chosen so that the spacing along a row
// matches the spacing between rows. Seats are then sorted by angle so groups form wedges.
export function hemicycleLayout(total: number, innerRatio = 0.4): HemicycleLayout {
  if (total <= 0) return { seats: [], rows: 0, dotRadius: 0 };
  let best = { rows: 1, score: Infinity };
  for (let rows = 1; rows <= Math.min(40, total); rows += 1) {
    const radii = rowRadii(rows, innerRatio);
    const sum = radii.reduce((a, r) => a + r, 0);
    const along = Math.PI * sum / total;
    const across = rows === 1 ? 1 - innerRatio : (1 - innerRatio) / (rows - 1);
    const score = Math.abs(Math.log(along / across));
    if (score < best.score) best = { rows, score };
  }
  const radii = rowRadii(best.rows, innerRatio);
  const sum = radii.reduce((a, r) => a + r, 0);
  const perRow = radii.map(r => Math.max(1, Math.round(total * r / sum)));
  // Fix rounding on the outer rows, which have the most room.
  let diff = total - perRow.reduce((a, n) => a + n, 0);
  for (let i = perRow.length - 1; diff !== 0; i = i > 0 ? i - 1 : perRow.length - 1) {
    if (diff > 0) { perRow[i] += 1; diff -= 1; } else if (perRow[i] > 1) { perRow[i] -= 1; diff += 1; }
  }

  const seats: Seat[] = [];
  perRow.forEach((n, row) => {
    const r = radii[row];
    for (let k = 0; k < n; k += 1) {
      const angle = n === 1 ? Math.PI / 2 : Math.PI - Math.PI * k / (n - 1);
      seats.push({ x: r * Math.cos(angle), y: r * Math.sin(angle), row, angle });
    }
  });
  seats.sort((a, b) => b.angle - a.angle || a.row - b.row);

  const across = best.rows === 1 ? 1 - innerRatio : (1 - innerRatio) / (best.rows - 1);
  const along = Math.min(...perRow.map((n, i) => (n > 1 ? Math.PI * radii[i] / (n - 1) : Infinity)));
  return { seats, rows: best.rows, dotRadius: 0.42 * Math.min(across, along) };
}

function rowRadii(rows: number, innerRatio: number): number[] {
  if (rows === 1) return [1];
  return Array.from({ length: rows }, (_, i) => innerRatio + (1 - innerRatio) * i / (rows - 1));
}

export interface GroupSeats {
  code: string;
  seats: number;
}

// Groups in hemicycle order (unknown codes before the non-inscrits), empty groups dropped.
export function orderGroupsForHemicycle(groups: GroupSeats[]): GroupSeats[] {
  const rank = (code: string) => {
    const index = HEMICYCLE_ORDER.indexOf(code);
    if (index >= 0) return index;
    return HEMICYCLE_ORDER.indexOf('NI') - 0.5;
  };
  return groups.filter(g => g.seats > 0).sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code));
}

export function assignSeats(layout: HemicycleLayout, groups: GroupSeats[]): Array<Seat & { group: string }> {
  const result: Array<Seat & { group: string }> = [];
  let index = 0;
  for (const group of groups) {
    for (let i = 0; i < group.seats && index < layout.seats.length; i += 1) {
      result.push({ ...layout.seats[index], group: group.code });
      index += 1;
    }
  }
  return result;
}

// ---------- Group analyses (from /api/stats/groups) ----------

export type CoverageState = 'ok' | 'partial' | 'low' | 'empty';

export interface GroupAnalysisScope {
  sessions: string[];
  coverage: number; // pooled over the sessions, 0..1
  state: CoverageState;
}

// Sessions the agreement matrix uses: the selected one, or every reliable session for 'all'.
export function groupAnalysisScope(data: GroupStats, selectedSession: string): GroupAnalysisScope {
  const pooled = (rows: GroupStats['sessions']) => {
    const voters = rows.reduce((a, r) => a + r.officialVoters, 0);
    return voters ? rows.reduce((a, r) => a + r.individualCast, 0) / voters : 0;
  };
  if (selectedSession === 'all') {
    const rows = data.sessions.filter(s => s.coverage >= COVERAGE_RELIABLE);
    return { sessions: rows.map(r => r.session), coverage: pooled(rows), state: rows.length ? 'ok' : 'empty' };
  }
  const row = data.sessions.find(s => s.session === selectedSession);
  if (!row || row.votesWithIndividual === 0) return { sessions: [], coverage: 0, state: 'empty' };
  const state: CoverageState = row.coverage < COVERAGE_MIN ? 'low' : row.coverage < COVERAGE_RELIABLE ? 'partial' : 'ok';
  return { sessions: [row.session], coverage: row.coverage, state };
}

function orderGroups(codes: Iterable<string>): string[] {
  const set = new Set(codes);
  set.delete('NI');
  const known = GROUP_ANALYSIS_ORDER.filter(code => set.has(code));
  const unknown = [...set].filter(code => !GROUP_ANALYSIS_ORDER.includes(code)).sort();
  return [...known, ...unknown];
}

export interface AgreementCell {
  a: string;
  b: string;
  votes: number;
  agree: number;
  pct: number | null; // null when fewer than MIN_VOTES_FOR_RATE votes
}

export interface AgreementMatrix {
  groups: string[];
  cells: AgreementCell[]; // every ordered pair a ≠ b
  votes: number; // distinct votes in scope
}

export function agreementMatrix(data: GroupStats, sessions: string[]): AgreementMatrix {
  const inScope = new Set(sessions);
  const pairs = new Map<string, { votes: number; agree: number }>();
  for (const row of data.agreement) {
    if (!inScope.has(row.session) || row.groupA === 'NI' || row.groupB === 'NI') continue;
    const key = [row.groupA, row.groupB].sort().join('|');
    const entry = pairs.get(key) ?? { votes: 0, agree: 0 };
    entry.votes += row.votes;
    entry.agree += row.agree;
    pairs.set(key, entry);
  }
  const present = new Set<string>();
  for (const [key, entry] of pairs) {
    if (entry.votes >= MIN_VOTES_FOR_RATE) key.split('|').forEach(code => present.add(code));
  }
  const groups = orderGroups(present);
  const cells: AgreementCell[] = [];
  for (const a of groups) {
    for (const b of groups) {
      if (a === b) continue;
      const entry = pairs.get([a, b].sort().join('|')) ?? { votes: 0, agree: 0 };
      cells.push({
        a, b, votes: entry.votes, agree: entry.agree,
        pct: entry.votes >= MIN_VOTES_FOR_RATE ? Math.round(entry.agree / entry.votes * 1000) / 10 : null,
      });
    }
  }
  const votes = data.sessions.filter(s => inScope.has(s.session)).reduce((a, s) => a + s.votesWithIndividual, 0);
  return { groups, cells, votes };
}

export interface CohesionCell {
  session: string;
  group: string;
  value: number; // agreement index × 100, one decimal
  votes: number;
  avgVoters: number;
}

export interface CohesionGrid {
  sessions: Array<{ session: string; coverage: number; partial: boolean }>;
  groups: string[];
  cells: CohesionCell[];
  hiddenSessions: number; // sessions left out for low coverage
}

export function cohesionGrid(data: GroupStats): CohesionGrid {
  const shown = data.sessions
    .filter(s => s.coverage >= COVERAGE_MIN)
    .sort((a, b) => parseInt(a.session) - parseInt(b.session));
  const inScope = new Set(shown.map(s => s.session));
  const cells = data.cohesion
    .filter(row => inScope.has(row.session) && row.group !== 'NI' && row.votes >= MIN_VOTES_FOR_RATE)
    .map(row => ({
      session: row.session, group: row.group, votes: row.votes, avgVoters: row.avgVoters,
      value: Math.round(row.agreementIndex * 1000) / 10,
    }));
  return {
    sessions: shown.map(s => ({ session: s.session, coverage: s.coverage, partial: s.coverage < COVERAGE_RELIABLE })),
    groups: orderGroups(cells.map(c => c.group)),
    cells,
    hiddenSessions: data.sessions.length - shown.length,
  };
}

// Hix–Noury–Roland agreement index for one vote of one group (the server computes the same).
export function agreementIndex(pour: number, contre: number, abstention: number): number | null {
  const total = pour + contre + abstention;
  if (total <= 0) return null;
  const top = Math.max(pour, contre, abstention);
  return (top - 0.5 * (total - top)) / total;
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}
