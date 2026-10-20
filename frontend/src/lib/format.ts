const FRENCH_MONTHS: Record<string, number> = {
  'janvier': 0, 'février': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5, 'juillet': 6,
  'août': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11,
};

export function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const match1 = dateStr.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (match1) return new Date(parseInt(match1[3]), parseInt(match1[2]) - 1, parseInt(match1[1]));
  const match2 = dateStr.match(/(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (match2) return new Date(parseInt(match2[1]), parseInt(match2[2]) - 1, parseInt(match2[3]));
  const match3 = dateStr.match(/(\d{1,2})\s+([a-zéûôù]+)\s+(\d{4})/i);
  if (match3) {
    const m = FRENCH_MONTHS[match3[2].toLowerCase()];
    if (m !== undefined) return new Date(parseInt(match3[3]), m, parseInt(match3[1]));
  }
  return null;
}

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  if (typeof date === 'string') {
    const d = parseDate(date);
    if (!d) return date;
    return DATE_FORMAT.format(d);
  }
  return DATE_FORMAT.format(date);
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return '??';
  return name.split(' ').filter(w => w.length > 1).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

export function getYear(isoDate: string | null | undefined): string | null {
  return isoDate ? isoDate.slice(0, 4) : null;
}

// Session "2016" = parliamentary year 2016-2017.
export function formatSessionRange(session: string | number | null | undefined): string {
  const y = parseInt(String(session));
  return Number.isFinite(y) ? `${y}-${y + 1}` : '';
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n !== 1 ? 's' : ''}`;
}
