import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import ScrutinDetailDialog from '../ScrutinDetailDialog';
import ScrutinsView from '../ScrutinsView';
import SenatorDetailDialog from '../SenatorDetailDialog';
import { cleanGroupMemberships } from '../lib/career';
import { formatDate, parseDate } from '../lib/format';
import { findSenatorByName, findVoterSenator } from '../lib/senators';
import { filterScrutins, findScrutin, listSessions } from '../lib/scrutins';
import type { ApiStatus, Senator, SenatorDetail, SenatorVotesPage, Scrutin, ScrutinDetail, Stats } from '../types';

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

const firstScrutin: Scrutin = {
  session: '2024', number: 17, date: '2024-10-21', title: 'Projet de loi sur l’égalité',
  result: 'adopté', url: null, pour: 10, contre: 5, abstention: 3, total: 18, groups: [],
};

const secondScrutin: Scrutin = {
  ...firstScrutin, session: '2023', date: '2023-09-12', title: 'Motion relative au budget',
  result: 'rejeté',
};

const senator: Senator = {
  matricule: 'SEN-1', name: 'Élisabeth Martin', prenom: 'Élisabeth', nom: 'Martin', slug: null,
  civilite: 'Mme', status: 'ACTIF', group: 'SER', groupFullName: 'Socialiste, Écologiste et Républicain',
  lastGroupEndDate: null, serviceStart: '2020-10-01', serviceEnd: null, dept: 'Paris', deptCode: '75',
  commission: null, avatar: null, url: null, profession: null, social: null,
  stats: { pour: 5, contre: 2, abstention: 1, total: 8 },
};

const stats: Stats = {
  totalScrutins: 2, adoptes: 1, rejetes: 1, adoptionRate: 50, totalSenateurs: 1,
  groups: {}, groupColors: {}, generatedAt: '2026-10-20T00:00:00Z', source: 'test fixture',
};

const online: ApiStatus = {
  status: 'online', backend: 'test backend', database: 'ok', hasData: true,
};

const emptyScrutinDetail: ScrutinDetail = {
  session: firstScrutin.session, number: firstScrutin.number,
  senateurs: { pour: [], contre: [], abstention: [], non_votant: [] },
  votersScope: 'sitting_senators', listedVoters: 0, corrections: [],
};

const emptyVotesPage: SenatorVotesPage = { total: 0, offset: 0, limit: 50, items: [] };
const emptySenatorDetail: SenatorDetail = { id: senator.matricule, group_memberships: [] };

function voteDetail(voterName: string): ScrutinDetail {
  return {
    ...emptyScrutinDetail,
    listedVoters: 1,
    senateurs: {
      pour: [{ id: 'V-1', name: voterName, group: 'SER', specialStatus: null, delegatedBy: null, hasCorrection: false }],
      contre: [], abstention: [], non_votant: [],
    },
  };
}

function makeScrutin(number: number): Scrutin {
  return { ...firstScrutin, number, title: `Projet ${number}` };
}

describe('data regression helpers', () => {
  it('filters by result and keyword, sorts chronologically, and lists sessions newest first', () => {
    expect(filterScrutins([firstScrutin, secondScrutin], { result: 'adopté', search: 'ÉGALITÉ', sort: 'date-desc' }))
      .toEqual([firstScrutin]);
    expect(filterScrutins([secondScrutin, firstScrutin], { result: 'all', search: '', sort: 'date-asc' }))
      .toEqual([secondScrutin, firstScrutin]);
    expect(listSessions([firstScrutin, secondScrutin, { ...firstScrutin, session: 'invalid' }]))
      .toEqual(['2024', '2023']);
  });

  it('uses session plus number as the scrutin identity', () => {
    const sameNumberDifferentSession = { ...firstScrutin, session: '2023' };
    expect(findScrutin([sameNumberDifferentSession, firstScrutin], '2024', '17')).toBe(firstScrutin);
    expect(findScrutin([sameNumberDifferentSession, firstScrutin], '2022', 17)).toBeUndefined();
  });

  it('parses and formats supported French date forms without shifting the day', () => {
    expect(parseDate('21/10/2024')?.getDate()).toBe(21);
    expect(parseDate('2024-10-21')?.getDate()).toBe(21);
    expect(parseDate('21 octobre 2024')?.getDate()).toBe(21);
    expect(parseDate('not a date')).toBeNull();
    expect(formatDate('2024-10-21')).toBe('21 octobre 2024');
    expect(formatDate(null)).toBe('—');
  });

  it('removes short technical no-group entries, merges renewal rows, and keeps real gaps', () => {
    const memberships = [
      { group_code: 'LR', group_name: 'Les Républicains', start_date: '2012-10-01', end_date: '2016-10-02', source_url: '' },
      { group_code: 'AUCUN', group_name: 'Non-inscrits', start_date: '2016-10-04', end_date: '2016-10-05', source_url: '' },
      { group_code: 'LR', group_name: 'Les Républicains', start_date: '2016-10-06', end_date: '2020-10-01', source_url: '' },
      { group_code: 'AUCUN', group_name: 'Non-inscrits', start_date: '2021-01-01', end_date: '2021-03-01', source_url: '' },
      { group_code: 'NI', group_name: 'Non-inscrits', start_date: '2021-03-02', end_date: null, source_url: '' },
    ];
    const cleaned = cleanGroupMemberships(memberships);
    expect(cleaned.map(membership => membership.group_code)).toEqual(['LR', 'AUCUN', 'NI']);
    expect(cleaned[0].start_date).toBe('2012-10-01');
    expect(cleaned[0].end_date).toBe('2020-10-01');
  });

  it('matches voters by matricule first and by normalized name as a fallback', () => {
    const alternate = { ...senator, name: 'Wrong Display Name' };
    expect(findVoterSenator([alternate], { id: senator.matricule, name: senator.name })).toBe(alternate);
    expect(findVoterSenator([senator], { id: null, name: 'Elisabeth Martin' })).toBe(senator);
    expect(findSenatorByName([senator], 'unknown person')).toBeNull();
  });
});

describe('React UI regression states and interactions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.replaceState(null, '', '/');
    apiMock.status.mockResolvedValue(online);
    apiMock.senators.mockResolvedValue([senator]);
    apiMock.senatorsByStatus.mockResolvedValue([]);
    apiMock.scrutins.mockResolvedValue([firstScrutin, secondScrutin]);
    apiMock.stats.mockResolvedValue(stats);
    apiMock.groupStats.mockResolvedValue({ scope: 'sitting_senators', minGroupVoters: 3, sessions: [], cohesion: [], agreement: [], generatedAt: '' });
    apiMock.senatorVotes.mockResolvedValue(emptyVotesPage);
    apiMock.senatorDetail.mockResolvedValue(emptySenatorDetail);
    apiMock.scrutinDetail.mockResolvedValue(emptyScrutinDetail);
    apiMock.loyalty.mockResolvedValue({ scope: 'sitting_senators', minGroupVoters: 3, minRankedVotes: 100, senators: [], groups: [], generatedAt: '' });
    apiMock.senatorRebels.mockResolvedValue({ matricule: senator.matricule, minGroupVoters: 3, minRankedVotes: 100, follows: 0, rebels: 0, ties: 0, loyalty: null, ranked: false, group: null, groupAvgLoyalty: null, total: 0, limit: 50, items: [] });
  });

  it('loads populated views and follows both hash navigation and an initial hash after refresh', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    expect(await screen.findAllByText(firstScrutin.title)).not.toHaveLength(0);

    await user.click(screen.getByRole('link', { name: 'Groupes' }));
    await waitFor(() => expect(window.location.hash).toBe('#groupes'));
    expect(screen.getByRole('link', { name: 'Groupes' }).getAttribute('aria-current')).toBe('page');

    unmount();
    window.location.hash = '#stats';
    render(<App />);
    await screen.findAllByText(firstScrutin.title);
    expect(screen.getByRole('link', { name: 'Statistiques' }).getAttribute('aria-current')).toBe('page');
  });

  it('shows an empty state when successful API responses contain no records', async () => {
    apiMock.senators.mockResolvedValueOnce([]);
    apiMock.scrutins.mockResolvedValueOnce([]);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Aucune donnée disponible' })).toBeTruthy();
  });

  it('shows a failed API state and retries successfully', async () => {
    const user = userEvent.setup();
    apiMock.status.mockRejectedValueOnce(new Error('backend unavailable'));
    render(<App />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findAllByText(firstScrutin.title)).not.toHaveLength(0);
    expect(apiMock.status).toHaveBeenCalledTimes(2);
  });

  it('supports keyboard search, reports results, closes on Escape, and restores focus', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText(firstScrutin.title);
    const openSearch = screen.getByRole('button', { name: 'Rechercher un scrutin ou un sénateur' });
    await user.click(openSearch);
    const input = screen.getByRole('searchbox', { name: 'Rechercher un scrutin ou un sénateur' });
    expect(document.activeElement).toBe(input);
    await user.type(input, 'égalité');
    expect(screen.getByRole('button', { name: /Scrutin n°17/ })).toBeTruthy();
    await user.tab();
    const closeSearch = screen.getByRole('button', { name: 'Fermer la recherche' });
    expect(document.activeElement).toBe(closeSearch);
    const result = screen.getByRole('button', { name: /Scrutin n°17/ });
    await user.tab();
    expect(document.activeElement).toBe(result);
    await user.tab();
    expect(document.activeElement).toBe(input);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(openSearch);
  });

  it('filters the list and reveals the next page on demand', async () => {
    const user = userEvent.setup();
    const scrutins = Array.from({ length: 20 }, (_, index) => ({
      ...makeScrutin(index + 1), result: index === 19 ? 'rejeté' : 'adopté',
    }));
    render(<ScrutinsView scrutins={scrutins} stats={null} selectedSession="all" onOpenScrutin={vi.fn()} onOpenSearch={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /Ouvrir le scrutin/ })).toHaveLength(18);
    await user.click(screen.getByRole('button', { name: 'Adoptés' }));
    expect(screen.getAllByRole('button', { name: /Ouvrir le scrutin/ })).toHaveLength(18);
    await user.click(screen.getByRole('button', { name: 'Charger plus de scrutins' }));
    expect(screen.getAllByRole('button', { name: /Ouvrir le scrutin/ })).toHaveLength(19);
  });

  it('shows the empty and failed states for scrutin details, with a working retry', async () => {
    const user = userEvent.setup();
    const props = { scrutin: firstScrutin, senators: [senator], stats, onClose: vi.fn(), onOpenSenator: vi.fn() };
    const { rerender } = render(<ScrutinDetailDialog {...props} />);
    expect(await screen.findByText(/Aucun vote individuel chargé/)).toBeTruthy();

    apiMock.scrutinDetail.mockRejectedValueOnce(new Error('temporary failure'));
    rerender(<ScrutinDetailDialog {...props} scrutin={{ ...firstScrutin, number: 18 }} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText(/Aucun vote individuel chargé/)).toBeTruthy();
  });

  it('aborts replaced scrutin-detail requests and ignores their late responses', async () => {
    const pending: Array<{ number: number; signal?: AbortSignal; resolve: (detail: ScrutinDetail) => void }> = [];
    apiMock.scrutinDetail.mockImplementation((_session: string, number: number, signal?: AbortSignal) =>
      new Promise<ScrutinDetail>(resolve => pending.push({ number, signal, resolve })));
    const props = { senators: [], stats: null, onClose: vi.fn(), onOpenSenator: vi.fn() };
    const { rerender } = render(<ScrutinDetailDialog {...props} scrutin={firstScrutin} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender(<ScrutinDetailDialog {...props} scrutin={{ ...firstScrutin, number: 18 }} />);
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0].signal?.aborted).toBe(true);

    await act(async () => { pending[0].resolve(voteDetail('Old response')); });
    expect(screen.queryByText('Old response')).toBeNull();
    await act(async () => { pending[1].resolve(voteDetail('Current response')); });
    expect(await screen.findByText('Current response')).toBeTruthy();
  });

  it('keeps voter filters across position tabs and resets them only when the scrutin is left', async () => {
    const user = userEvent.setup();
    const voter = (id: string, name: string, group: string) =>
      ({ id, name, group, specialStatus: null, delegatedBy: null, hasCorrection: false });
    apiMock.scrutinDetail.mockResolvedValue({
      ...emptyScrutinDetail,
      listedVoters: 4,
      senateurs: {
        pour: [voter('V-1', 'Anne Pour', 'SER'), voter('V-2', 'Bruno Pour', 'LR')],
        contre: [voter('V-3', 'Carl Contre', 'LR'), voter('V-4', 'Dana Contre', 'SER')],
        abstention: [], non_votant: [],
      },
    });
    const props = { senators: [], stats: null, onClose: vi.fn(), onOpenSenator: vi.fn() };
    // The app remounts the dialog per scrutin (key = session-number), which is what "leaving" means.
    const { rerender } = render(<ScrutinDetailDialog key="2024-17" {...props} scrutin={firstScrutin} />);
    await screen.findByText('Anne Pour');

    await user.type(screen.getByLabelText('Rechercher un sénateur'), 'Carl');
    expect(screen.queryByText('Anne Pour')).toBeNull();
    // Counts on the tabs follow the active filter.
    expect(screen.getByRole('button', { name: /^Pour\s*0$/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Contre\s*1$/ }));
    expect((screen.getByLabelText('Rechercher un sénateur') as HTMLInputElement).value).toBe('Carl');
    expect(screen.getByText('Carl Contre')).toBeTruthy();
    expect(screen.queryByText('Dana Contre')).toBeNull();

    rerender(<ScrutinDetailDialog key="2024-18" {...props} scrutin={{ ...firstScrutin, number: 18 }} />);
    await screen.findByText('Anne Pour');
    expect((screen.getByLabelText('Rechercher un sénateur') as HTMLInputElement).value).toBe('');
  });

  it('aborts both senator-detail requests when the selected senator changes', async () => {
    const secondSenator = { ...senator, matricule: 'SEN-2', name: 'Camille Durand', nom: 'Durand' };
    const pendingHistory: Array<{ signal?: AbortSignal; resolve: (page: SenatorVotesPage) => void }> = [];
    const pendingCareer: Array<{ signal?: AbortSignal; resolve: (detail: SenatorDetail) => void }> = [];
    apiMock.senatorVotes.mockImplementation((_id: string, _offset: number, _limit: number, signal?: AbortSignal) =>
      new Promise<SenatorVotesPage>(resolve => pendingHistory.push({ signal, resolve })));
    apiMock.senatorDetail.mockImplementation((_id: string, signal?: AbortSignal) =>
      new Promise<SenatorDetail>(resolve => pendingCareer.push({ signal, resolve })));

    const props = { scrutins: [firstScrutin], stats: null, onClose: vi.fn(), onOpenScrutin: vi.fn() };
    const { rerender } = render(<SenatorDetailDialog {...props} senator={senator} />);
    await waitFor(() => {
      expect(pendingHistory).toHaveLength(1);
      expect(pendingCareer).toHaveLength(1);
    });
    rerender(<SenatorDetailDialog {...props} senator={secondSenator} />);
    await waitFor(() => {
      expect(pendingHistory).toHaveLength(2);
      expect(pendingCareer).toHaveLength(2);
    });
    expect(pendingHistory[0].signal?.aborted).toBe(true);
    expect(pendingCareer[0].signal?.aborted).toBe(true);

    await act(async () => {
      pendingHistory[0].resolve({ ...emptyVotesPage, items: [{
        scrutinSession: '2024', scrutinNumber: 90, scrutinTitle: 'Ancien résultat', scrutinDate: null,
        scrutinResult: 'adopté', vote: 'pour', specialStatus: null, delegatedBy: null, hasCorrection: false,
      }] });
      pendingCareer[0].resolve({ id: senator.matricule, group_memberships: [{
        group_code: 'OLD', group_name: 'Ancien groupe', start_date: '1990-01-01', end_date: '1991-01-01', source_url: '',
      }] });
    });
    await act(async () => {
      pendingHistory[1].resolve(emptyVotesPage);
      pendingCareer[1].resolve({ ...emptySenatorDetail, id: secondSenator.matricule });
    });
    expect(await screen.findByText('Aucun vote individuel enregistré pour ce sénateur.')).toBeTruthy();
    expect(screen.queryByText('Ancien résultat')).toBeNull();
    expect(screen.queryByText('Ancien groupe')).toBeNull();
  });

  it('renders empty senator history and career states', async () => {
    render(<SenatorDetailDialog senator={senator} scrutins={[firstScrutin]} stats={stats} onClose={vi.fn()} onOpenScrutin={vi.fn()} />);
    expect(await screen.findByText('Aucun vote individuel enregistré pour ce sénateur.')).toBeTruthy();
    expect(screen.getByText('Aucune appartenance à un groupe enregistrée.')).toBeTruthy();
  });
});
