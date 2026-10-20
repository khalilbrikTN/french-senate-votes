import { GROUP_CODES, HISTORICAL_GROUP_COLORS, POLITICAL_GROUPS } from '../data/politicalGroups';
import type { Stats } from '../types';

const FALLBACK_COLORS = ['#3b82f6', '#ec4899', '#f59e0b', '#34d399', '#a78bfa', '#fb923c', '#64748b', '#14b8a6'];

// Colours come from the database (/api/stats → groupColors, keyed by app code, former groups
// included); the hardcoded colours in POLITICAL_GROUPS and HISTORICAL_GROUP_COLORS are the offline fallback.
export function getGroupColor(code: string | null | undefined, stats: Stats | null): string {
  const live = stats?.groupColors;
  if (code && live?.[code]) return live[code];
  if (code && POLITICAL_GROUPS[code]) return POLITICAL_GROUPS[code].color;
  if (code && HISTORICAL_GROUP_COLORS[code]) return HISTORICAL_GROUP_COLORS[code];
  const idx = Math.abs((code || 'X').split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % FALLBACK_COLORS.length;
  return FALLBACK_COLORS[idx];
}

// Seats per group: live count from /api/stats when available, static fallback otherwise.
export function getGroupSeats(code: string, stats: Stats | null): number {
  const live = stats?.groups?.[code];
  if (live && typeof live.seats === 'number') return live.seats;
  return POLITICAL_GROUPS[code] ? POLITICAL_GROUPS[code].seats : 0;
}

// Total seats used for percentages: sum of the live group counts, or of the static values.
export function getTotalSeats(stats: Stats | null): number {
  const codes = stats?.groups ? Object.keys(stats.groups) : GROUP_CODES;
  return codes.reduce((acc, code) => acc + getGroupSeats(code, stats), 0) || 348;
}

// Current group president: from /api/stats (database, ODSEN_HISTOGROUPES) when the backend
// answered, the hardcoded POLITICAL_GROUPS leader otherwise.
export function getGroupLeader(code: string, stats: Stats | null): string {
  const grp = POLITICAL_GROUPS[code];
  const live = stats?.groups?.[code];
  if (live && 'leader' in live) {
    if (live.leader) return live.leader;
    return code === 'NI' && grp ? grp.leader : 'Aucun';
  }
  return grp ? grp.leader : '—';
}

export function getGroupName(code: string | null | undefined, fallback?: string | null): string {
  return (code && POLITICAL_GROUPS[code]?.name) || fallback || code || '';
}
