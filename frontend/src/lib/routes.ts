import type { Scrutin, Senator, View } from '../types';

// Hash routes. Views: #scrutins, #senateurs, … Shareable dialogs:
//   #scrutin/<session>/<number>   e.g. #scrutin/2024/17   (opens over the Scrutins view)
//   #senateur/<matricule>         e.g. #senateur/19123L   (opens over the Sénateurs view)
export const VIEW_IDS: readonly View[] = ['scrutins', 'senateurs', 'groupes', 'independance', 'carte', 'stats', 'about', 'mentions-legales'];

export type DialogRoute =
  | { kind: 'scrutin'; session: string; number: number }
  | { kind: 'senator'; matricule: string };

export interface ParsedHash {
  view: View;
  dialog: DialogRoute | null;
}

// What the app keeps in history.state for the entries it pushes when a dialog opens.
export interface DialogHistoryState {
  // Number of dialog entries stacked above the list entry (1 = first dialog opened from a view).
  svDialogDepth: number;
  // View shown under the dialog when it was opened in the app (e.g. a senator opened from the map).
  svBaseView: View;
}

const SCRUTIN_PREFIX = 'scrutin/';
const SENATOR_PREFIX = 'senateur/';

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseHash(hash: string): ParsedHash {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw.startsWith(SCRUTIN_PREFIX)) {
    const [session = '', number = ''] = raw.slice(SCRUTIN_PREFIX.length).split('/');
    // A malformed link still routes to a scrutin, which is then reported as not found.
    const valid = /^\d+$/.test(session) && /^\d+$/.test(number);
    return { view: 'scrutins', dialog: { kind: 'scrutin', session: valid ? session : '', number: valid ? Number(number) : NaN } };
  }
  if (raw.startsWith(SENATOR_PREFIX)) {
    const matricule = safeDecode(raw.slice(SENATOR_PREFIX.length).split('/')[0]) ?? '';
    return { view: 'senateurs', dialog: { kind: 'senator', matricule: matricule.trim() } };
  }
  return { view: VIEW_IDS.includes(raw as View) ? raw as View : 'scrutins', dialog: null };
}

export function scrutinHash(scrutin: Pick<Scrutin, 'session' | 'number'>): string {
  return `#scrutin/${encodeURIComponent(String(scrutin.session))}/${scrutin.number}`;
}

export function senatorHash(senator: Pick<Senator, 'matricule'>): string {
  return `#senateur/${encodeURIComponent(senator.matricule)}`;
}

export function dialogHash(dialog: DialogRoute): string {
  return dialog.kind === 'scrutin' ? scrutinHash(dialog) : senatorHash(dialog);
}

// Absolute address of a hash route on the current page (what the share button hands out).
export function shareUrl(hash: string): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${hash}`;
}

export function readDialogHistoryState(state: unknown): Partial<DialogHistoryState> {
  if (!state || typeof state !== 'object') return {};
  const { svDialogDepth, svBaseView } = state as Record<string, unknown>;
  return {
    svDialogDepth: typeof svDialogDepth === 'number' && svDialogDepth > 0 ? Math.floor(svDialogDepth) : undefined,
    svBaseView: VIEW_IDS.includes(svBaseView as View) ? svBaseView as View : undefined,
  };
}
