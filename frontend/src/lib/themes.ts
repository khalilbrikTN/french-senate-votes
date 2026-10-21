// Votes by theme. The theme of each vote is an automatic, approximate classification of its
// title, made by the backend (backend/app/themes.py, the single source of the rules and labels):
// this module only groups, counts and filters what the API returns.
import type { GroupStats, Scrutin, ThemeStats } from '../types';
import { GROUP_ANALYSIS_ORDER, groupAnalysisScope, isAdopted, type GroupAnalysisScope } from './statsCharts';

export const OTHER_THEME = 'autres';
export const ALL_THEMES = 'all';
// A group × theme cell of the heatmap needs this many votes (group with ≥ minGroupVoters
// expressed members) to show a rate; the per-theme samples of one session are small.
export const THEME_MIN_VOTES = 5;

export const themeOf = (scrutin: Pick<Scrutin, 'theme'>) => scrutin.theme || OTHER_THEME;
export const themeLabelOf = (scrutin: Pick<Scrutin, 'theme' | 'themeLabel'>) =>
  scrutin.themeLabel || (scrutin.theme ? scrutin.theme : 'Autres');

// "Sécurité sociale & santé" → "Sécurité sociale", "Culture, médias & sport" → "Culture".
export const shortThemeLabel = (label: string) => label.split(/\s*[&,]\s*/)[0] || label;

export function hasThemes(scrutins: Scrutin[]): boolean {
  return scrutins.some(scrutin => Boolean(scrutin.theme));
}

export function filterByTheme(scrutins: Scrutin[], theme: string): Scrutin[] {
  if (theme === ALL_THEMES) return scrutins;
  return scrutins.filter(scrutin => themeOf(scrutin) === theme);
}

export interface ThemeCount {
  id: string;
  label: string;
  count: number; // votes in the counted list
}

// Every theme present in `all` (so the choice survives a session change), counted in `counted`;
// most frequent first, "Autres" last.
export function themeCounts(all: Scrutin[], counted: Scrutin[] = all): ThemeCount[] {
  const labels = new Map<string, string>();
  for (const scrutin of all) labels.set(themeOf(scrutin), themeLabelOf(scrutin));
  const counts = new Map<string, number>();
  for (const scrutin of counted) counts.set(themeOf(scrutin), (counts.get(themeOf(scrutin)) ?? 0) + 1);
  return [...labels.entries()]
    .map(([id, label]) => ({ id, label, count: counts.get(id) ?? 0 }))
    .sort((a, b) => Number(a.id === OTHER_THEME) - Number(b.id === OTHER_THEME)
      || b.count - a.count || a.label.localeCompare(b.label, 'fr'));
}

export interface ThemeAdoption {
  id: string;
  label: string;
  total: number;
  adopted: number;
  rejected: number;
  rate: number; // % adopted, one decimal
}

export function themeAdoption(scrutins: Scrutin[]): ThemeAdoption[] {
  const rows = new Map<string, ThemeAdoption>();
  for (const scrutin of scrutins) {
    const id = themeOf(scrutin);
    const row = rows.get(id) ?? { id, label: themeLabelOf(scrutin), total: 0, adopted: 0, rejected: 0, rate: 0 };
    row.total += 1;
    if (isAdopted(scrutin)) row.adopted += 1; else row.rejected += 1;
    rows.set(id, row);
  }
  return [...rows.values()]
    .map(row => ({ ...row, rate: Math.round(row.adopted / row.total * 1000) / 10 }))
    .sort((a, b) => Number(a.id === OTHER_THEME) - Number(b.id === OTHER_THEME)
      || b.total - a.total || a.label.localeCompare(b.label, 'fr'));
}

// Same coverage rules as the group charts (COVERAGE_MIN / COVERAGE_RELIABLE): the selected
// session, or every reliable session for 'all'.
export function themeAnalysisScope(data: ThemeStats, selectedSession: string): GroupAnalysisScope {
  const asGroupStats: GroupStats = {
    scope: data.scope, minGroupVoters: data.minGroupVoters, sessions: data.sessions,
    cohesion: [], agreement: [], generatedAt: data.generatedAt,
  };
  return groupAnalysisScope(asGroupStats, selectedSession);
}

export interface ThemeGroupCell {
  theme: string;
  group: string;
  votes: number;
  pour: number;
  contre: number;
  abstention: number;
  pct: number | null; // % of those votes where the group's majority voted pour; null below THEME_MIN_VOTES
}

export interface ThemeGroupMatrix {
  themes: Array<{ id: string; label: string }>;
  groups: string[];
  cells: ThemeGroupCell[]; // every theme × group pair of the matrix
}

export function themeGroupMatrix(data: ThemeStats, sessions: string[]): ThemeGroupMatrix {
  const inScope = new Set(sessions);
  const sums = new Map<string, Omit<ThemeGroupCell, 'pct'>>();
  for (const row of data.groups) {
    // The non-inscrits are not a group (no common line), as in the other group charts.
    if (!inScope.has(row.session) || row.group === 'NI') continue;
    const key = `${row.theme}|${row.group}`;
    const entry = sums.get(key) ?? { theme: row.theme, group: row.group, votes: 0, pour: 0, contre: 0, abstention: 0 };
    entry.votes += row.votes;
    entry.pour += row.pour;
    entry.contre += row.contre;
    entry.abstention += row.abstention;
    sums.set(key, entry);
  }
  const shown = [...sums.values()].filter(entry => entry.votes >= THEME_MIN_VOTES);
  const groupSet = new Set(shown.map(entry => entry.group));
  const themeSet = new Set(shown.map(entry => entry.theme));
  const groups = [
    ...GROUP_ANALYSIS_ORDER.filter(code => groupSet.has(code)),
    ...[...groupSet].filter(code => !GROUP_ANALYSIS_ORDER.includes(code)).sort(),
  ];
  const themes = data.themes.filter(theme => themeSet.has(theme.id));
  const cells: ThemeGroupCell[] = [];
  for (const theme of themes) {
    for (const group of groups) {
      const entry = sums.get(`${theme.id}|${group}`) ?? { theme: theme.id, group, votes: 0, pour: 0, contre: 0, abstention: 0 };
      cells.push({
        ...entry,
        pct: entry.votes >= THEME_MIN_VOTES ? Math.round(entry.pour / entry.votes * 1000) / 10 : null,
      });
    }
  }
  return { themes, groups, cells };
}
