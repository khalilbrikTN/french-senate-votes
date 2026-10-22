import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { parseHash, scrutinHash, senatorHash } from '../lib/routes';
import type { ApiStatus, Scrutin, ScrutinDetail, Senator, SenatorVotesPage, Stats } from '../types';

const apiMock = vi.hoisted(() => ({
  status: vi.fn(),
  senators: vi.fn(),
  senatorsByStatus: vi.fn(),
  scrutins: vi.fn(),
  stats: vi.fn(),
  groupStats: vi.fn(),
  themeStats: vi.fn(),
  senatorVotes: vi.fn(),
  senatorDetail: vi.fn(),
  scrutinDetail: vi.fn(),
  compareSenators: vi.fn(),
  loyalty: vi.fn(),
  senatorRebels: vi.fn(),
}));

vi.mock('../api/endpoints', () => ({ api: apiMock }));

const scrutin: Scrutin = {
  session: '2024', number: 17, date: '2024-10-21', title: 'Projet de loi sur l’égalité',
  result: 'adopté', url: null, pour: 10, contre: 5, abstention: 3, total: 18, groups: [],
};

const senator: Senator = {
  matricule: 'SEN-1', name: 'Élisabeth Martin', prenom: 'Élisabeth', nom: 'Martin', slug: null,
  civilite: 'Mme', status: 'ACTIF', group: 'SER', groupFullName: 'Socialiste, Écologiste et Républicain',
  lastGroupEndDate: null, serviceStart: '2020-10-01', serviceEnd: null, dept: 'Paris', deptCode: '75',
  commission: null, avatar: null, url: null, profession: null, social: null,
  stats: { pour: 5, contre: 2, abstention: 1, total: 8 },
};

const formerSenator: Senator = {
  ...senator, matricule: 'OLD-9', name: 'Jean Ancien', prenom: 'Jean', nom: 'Ancien', status: 'ANCIEN',
  serviceEnd: '2017-09-30',
};

const stats: Stats = {
  totalScrutins: 1, adoptes: 1, rejetes: 0, adoptionRate: 100, totalSenateurs: 1,
  groups: {}, groupColors: {}, generatedAt: '2026-10-20T00:00:00Z', source: 'test fixture',
};

const online: ApiStatus = { status: 'online', backend: 'test backend', database: 'ok', hasData: true };
const emptyVotesPage: SenatorVotesPage = { total: 0, offset: 0, limit: 50, items: [] };
const detailWithVoter: ScrutinDetail = {
  session: scrutin.session, number: scrutin.number, votersScope: 'sitting_senators', listedVoters: 1, corrections: [],
  senateurs: {
    pour: [{ id: senator.matricule, name: senator.name, group: 'SER', specialStatus: null, delegatedBy: null, hasCorrection: false }],
    contre: [], abstention: [], non_votant: [],
  },
};

function startAt(hash: string) {
  window.history.replaceState(null, '', `/${hash}`);
}

function navLink(name: string) {
  return screen.getByRole('link', { name });
}

async function searchAndOpen(user: ReturnType<typeof userEvent.setup>, query: string, result: RegExp) {
  await user.click(screen.getByRole('button', { name: 'Rechercher un scrutin ou un sénateur' }));
  await user.type(screen.getByRole('searchbox', { name: 'Rechercher un scrutin ou un sénateur' }), query);
  await user.click(screen.getByRole('button', { name: result }));
}

describe('route parsing', () => {
  it('reads views, scrutin and senator routes, and builds stable hashes', () => {
    expect(parseHash('#groupes')).toEqual({ view: 'groupes', dialog: null });
    expect(parseHash('#nimporte')).toEqual({ view: 'scrutins', dialog: null });
    expect(parseHash('#scrutin/2025/123')).toEqual({ view: 'scrutins', dialog: { kind: 'scrutin', session: '2025', number: 123 } });
    expect(parseHash('#senateur/19123L')).toEqual({ view: 'senateurs', dialog: { kind: 'senator', matricule: '19123L' } });
    expect(parseHash('#scrutin/abc').dialog).toEqual({ kind: 'scrutin', session: '', number: NaN });
    expect(scrutinHash(scrutin)).toBe('#scrutin/2024/17');
    expect(senatorHash({ matricule: 'A B' })).toBe('#senateur/A%20B');
    expect(parseHash(senatorHash({ matricule: 'A B' })).dialog).toEqual({ kind: 'senator', matricule: 'A B' });
  });
});

describe('shareable dialog links', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    startAt('');
    apiMock.status.mockResolvedValue(online);
    apiMock.senators.mockResolvedValue([senator]);
    apiMock.senatorsByStatus.mockResolvedValue([formerSenator]);
    apiMock.scrutins.mockResolvedValue([scrutin]);
    apiMock.stats.mockResolvedValue(stats);
    apiMock.senatorVotes.mockResolvedValue(emptyVotesPage);
    apiMock.senatorDetail.mockResolvedValue({ id: senator.matricule, group_memberships: [] });
    apiMock.scrutinDetail.mockResolvedValue(detailWithVoter);
    apiMock.loyalty.mockResolvedValue({ scope: 'sitting_senators', minGroupVoters: 3, minRankedVotes: 100, senators: [], groups: [], generatedAt: '' });
    apiMock.senatorRebels.mockResolvedValue({ matricule: senator.matricule, minGroupVoters: 3, minRankedVotes: 100, follows: 0, rebels: 0, ties: 0, loyalty: null, ranked: false, group: null, groupAvgLoyalty: null, total: 0, limit: 50, items: [] });
  });

  it('opens a deep-linked scrutin once the data is loaded, and Back returns to the list', async () => {
    startAt('#scrutin/2024/17');
    render(<App />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const dialog = await screen.findByRole('dialog', { name: scrutin.title }, { timeout: 4000 });
    expect(within(dialog).getByText('Scrutin public n°17')).toBeTruthy();
    expect(navLink('Scrutins').getAttribute('aria-current')).toBe('page');
    expect(window.location.hash).toBe('#scrutin/2024/17');

    // The direct link got a list entry underneath: Back closes the dialog instead of leaving the site.
    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.hash).toBe('#scrutins');
    expect(screen.getAllByText(scrutin.title).length).toBeGreaterThan(0);
  });

  it('opens a deep-linked senator over the Sénateurs view, including a former senator', async () => {
    startAt('#senateur/SEN-1');
    const { unmount } = render(<App />);
    expect(await screen.findByRole('dialog', { name: senator.name }, { timeout: 4000 })).toBeTruthy();
    expect(navLink('Sénateurs').getAttribute('aria-current')).toBe('page');
    expect(apiMock.senatorsByStatus).not.toHaveBeenCalled();
    unmount();

    startAt('#senateur/OLD-9');
    render(<App />);
    expect(await screen.findByRole('dialog', { name: formerSenator.name }, { timeout: 4000 })).toBeTruthy();
    expect(apiMock.senatorsByStatus).toHaveBeenCalledWith('ANCIEN', expect.anything());
  });

  it('puts an opened dialog in the address and restores the view hash on close', async () => {
    const user = userEvent.setup();
    startAt('#scrutins');
    render(<App />);
    await screen.findAllByText(scrutin.title);
    const historyLength = window.history.length;

    await searchAndOpen(user, 'égalité', /Scrutin n°17/);
    expect(await screen.findByRole('dialog', { name: scrutin.title }, { timeout: 4000 })).toBeTruthy();
    expect(window.location.hash).toBe('#scrutin/2024/17');
    expect(window.history.length).toBe(historyLength + 1);

    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(window.location.hash).toBe('#scrutins'));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Closing went back to the list entry: no extra entry was added.
    expect(window.history.length).toBe(historyLength + 1);
    expect(window.history.state).toBeNull();
    // The view was not reset to the top for a dialog.
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('keeps the underlying view when a dialog opens from another view', async () => {
    const user = userEvent.setup();
    startAt('#groupes');
    render(<App />);
    await waitFor(() => expect(navLink('Groupes').getAttribute('aria-current')).toBe('page'));
    await searchAndOpen(user, 'Martin', /Élisabeth Martin/);
    expect(await screen.findByRole('dialog', { name: senator.name }, { timeout: 4000 })).toBeTruthy();
    expect(window.location.hash).toBe('#senateur/SEN-1');
    expect(navLink('Groupes').getAttribute('aria-current')).toBe('page');

    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(window.location.hash).toBe('#groupes'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('navigates back from a dialog opened inside another dialog, then closes on Back', async () => {
    const user = userEvent.setup();
    startAt('#scrutins');
    render(<App />);
    await screen.findAllByText(scrutin.title);
    await searchAndOpen(user, 'égalité', /Scrutin n°17/);
    const voter = await screen.findByTitle(`Voir la fiche de ${senator.name}`);
    await user.click(voter);
    expect(await screen.findByRole('dialog', { name: senator.name }, { timeout: 4000 })).toBeTruthy();
    expect(window.location.hash).toBe('#senateur/SEN-1');

    window.history.back();
    expect(await screen.findByRole('dialog', { name: scrutin.title }, { timeout: 4000 })).toBeTruthy();
    expect(window.location.hash).toBe('#scrutin/2024/17');

    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.hash).toBe('#scrutins');

    // Closing a nested dialog with the button returns straight to the list.
    await searchAndOpen(user, 'égalité', /Scrutin n°17/);
    await user.click(await screen.findByTitle(`Voir la fiche de ${senator.name}`));
    await screen.findByRole('dialog', { name: senator.name }, { timeout: 4000 });
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(window.location.hash).toBe('#scrutins'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the list with a short notice for an unknown scrutin or senator', async () => {
    startAt('#scrutin/2024/999');
    const { unmount } = render(<App />);
    expect(await screen.findByText('Ce scrutin est introuvable.')).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe('#scrutins'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByText(scrutin.title).length).toBeGreaterThan(0);
    unmount();

    startAt('#senateur/NOBODY');
    render(<App />);
    expect(await screen.findByText('Ce sénateur est introuvable.')).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe('#senateurs'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(navLink('Sénateurs').getAttribute('aria-current')).toBe('page');
  });

  it('copies the link with the share button and reports a clipboard failure', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    startAt('#scrutin/2024/17');
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: scrutin.title }, { timeout: 4000 });

    await user.click(within(dialog).getByRole('button', { name: /Partager/ }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/#scrutin/2024/17`);
    expect(await within(dialog).findByRole('button', { name: /Lien copié/ })).toBeTruthy();

    writeText.mockRejectedValueOnce(new Error('denied'));
    await user.click(within(dialog).getByRole('button', { name: /Lien copié/ }));
    expect(await within(dialog).findByRole('button', { name: /Copie impossible/ })).toBeTruthy();
  });
});
