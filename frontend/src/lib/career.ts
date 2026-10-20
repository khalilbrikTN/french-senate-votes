import type { GroupMembership } from '../types';

const CAREER_MAX_GAP_DAYS = 7; // renewals leave gaps of a few days between memberships

function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86400000;
}

// Two memberships are "contiguous" when the second starts at most a few days after the first ends.
function isContiguous(prev: GroupMembership | undefined, next: GroupMembership | undefined): boolean {
  return !!(prev && next && prev.end_date && next.start_date &&
    daysBetween(prev.end_date, next.start_date) <= CAREER_MAX_GAP_DAYS);
}

export function cleanGroupMemberships(memberships: GroupMembership[]): GroupMembership[] {
  // 1. Drop the technical "no group" entries of a few days that the Senate records at renewals,
  //    right before or after another membership. Genuine longer AUCUN periods are kept.
  const kept = memberships.filter((m, i) => {
    const isTechnical = m.group_code === 'AUCUN' && m.start_date && m.end_date &&
      daysBetween(m.start_date, m.end_date) <= CAREER_MAX_GAP_DAYS;
    return !(isTechnical && (isContiguous(memberships[i - 1], m) || isContiguous(m, memberships[i + 1])));
  });

  // 2. Merge consecutive memberships in the same group (groups are re-formed at each renewal).
  //    Gaps longer than a few days (e.g. the senator left the Senate) remain separate periods.
  const periods: GroupMembership[] = [];
  kept.forEach(m => {
    const last = periods[periods.length - 1];
    const gapOk = last && last.end_date && m.start_date &&
      daysBetween(last.end_date, m.start_date) <= CAREER_MAX_GAP_DAYS;
    if (last && last.group_code === m.group_code && gapOk) last.end_date = m.end_date;
    else periods.push({ ...m });
  });
  return periods;
}

export function careerPeriodLabel(p: GroupMembership): string {
  const today = new Date().toISOString().slice(0, 10);
  const startYear = p.start_date ? p.start_date.slice(0, 4) : null;
  // An end date in the future (published by the Senate) is treated as ongoing.
  const endYear = p.end_date && p.end_date <= today ? p.end_date.slice(0, 4) : null;
  if (!startYear && !endYear) return p.end_date ? 'en cours' : 'dates non renseignées';
  if (!startYear) return `jusqu'en ${endYear}`;
  if (!endYear) return `depuis ${startYear}`;
  return startYear === endYear ? startYear : `${startYear}–${endYear}`;
}
