import type { Scrutin } from '../types';

export type ResultFilter = 'all' | 'adopté' | 'rejeté';
export type ScrutinSort = 'date-desc' | 'date-asc' | 'numero-desc' | 'numero-asc';

// Scrutins of the selected parliamentary session (all of them when 'all').
export function getSessionScrutins(scrutins: Scrutin[], session: string): Scrutin[] {
  if (session === 'all') return scrutins;
  return scrutins.filter(s => String(s.session) === session);
}

// Sessions present in the data, newest first.
export function listSessions(scrutins: Scrutin[]): string[] {
  return [...new Set(scrutins.map(s => String(s.session ?? '')).filter(s => /^\d+$/.test(s)))]
    .sort((a, b) => parseInt(b) - parseInt(a));
}

// Vote numbers restart every session (October), so order by session before number.
const bySessionNumber = (a: Scrutin, b: Scrutin) =>
  (parseInt(a.session) || 0) - (parseInt(b.session) || 0) || (a.number || 0) - (b.number || 0);
const byDate = (a: Scrutin, b: Scrutin) => (a.date || '').localeCompare(b.date || '') || bySessionNumber(a, b);

export function filterScrutins(
  scrutins: Scrutin[], { result, search, sort }: { result: ResultFilter; search: string; sort: ScrutinSort },
): Scrutin[] {
  let data = [...scrutins];
  if (result !== 'all') data = data.filter(s => s.result === result);

  const q = search.toLowerCase().trim();
  if (q) {
    data = data.filter(s =>
      (s.title || '').toLowerCase().includes(q) ||
      (s.number || '').toString().includes(q) ||
      (s.date || '').toLowerCase().includes(q));
  }

  data.sort((a, b) => {
    switch (sort) {
      case 'date-desc': return byDate(b, a);
      case 'date-asc': return byDate(a, b);
      case 'numero-desc': return bySessionNumber(b, a);
      case 'numero-asc': return bySessionNumber(a, b);
      default: return 0;
    }
  });
  return data;
}

// Vote numbers restart every session (October), so a scrutin is only
// identified by session + number together.
export function findScrutin(scrutins: Scrutin[], session: string | number, number: string | number): Scrutin | undefined {
  const num = parseInt(String(number));
  return scrutins.find(s => String(s.session) === String(session) && s.number === num);
}

export function voteShares(scrutin: Pick<Scrutin, 'pour' | 'contre' | 'abstention'>) {
  const total = scrutin.pour + scrutin.contre + scrutin.abstention;
  const pct = (n: number) => (total > 0 ? (n / total * 100).toFixed(1) : '0');
  return { total, pour: pct(scrutin.pour), contre: pct(scrutin.contre), abstention: pct(scrutin.abstention) };
}
