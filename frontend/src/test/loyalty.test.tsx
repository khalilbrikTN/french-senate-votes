import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoyaltyRanking from '../components/LoyaltyRanking';
import SenatorLoyalty, { REBELS_PAGE_SIZE } from '../components/SenatorLoyalty';
import { averageLoyalty, formatLoyalty, loyaltyTone, rankByIndependence } from '../lib/loyalty';
import type { LoyaltyOverview, RebelVote, Scrutin, Senator, SenatorLoyalty as SenatorLoyaltyEntry, SenatorRebels } from '../types';

const apiMock = vi.hoisted(() => ({
  loyalty: vi.fn(),
  senatorRebels: vi.fn(),
  senatorVotes: vi.fn(),
  senatorDetail: vi.fn(),
  senators: vi.fn(),
  compareSenators: vi.fn(),
}));

vi.mock('../api/endpoints', () => ({ api: apiMock }));

function entry(matricule: string, name: string, group: string, follows: number, rebels: number): SenatorLoyaltyEntry {
  const counted = follows + rebels;
  return {
    matricule, name, group, follows, rebels, ties: 0,
    loyalty: counted ? Math.round(follows / counted * 1000) / 10 : null, ranked: counted >= 100,
  };
}

function senator(matricule: string, name: string, group: string, status: Senator['status'] = 'ACTIF'): Senator {
  return {
    matricule, name, prenom: name.split(' ')[0], nom: name.split(' ')[1] || name, slug: null, civilite: 'M.',
    status, group, groupFullName: null, lastGroupEndDate: null, serviceStart: null, serviceEnd: null,
    dept: null, deptCode: null, commission: null, avatar: null, url: null, profession: null, social: null,
    stats: { pour: 0, contre: 0, abstention: 0, total: 0 },
  };
}

const entries = [
  entry('A', 'Alice Rebelle', 'RDSE', 800, 200), // 80 %
  entry('B', 'Bruno Fidèle', 'LR', 990, 10), // 99 %
  entry('C', 'Chloé Centre', 'UC', 450, 50), // 90 %
  entry('D', 'David Nouveau', 'LR', 10, 2), // 12 votes: below every threshold
  entry('E', 'Emma Libre', 'NI', 0, 0), // non-inscrite: never measured
  entry('F', 'Fanny Radicale', 'RDSE', 190, 10), // 95 %, 200 votes
];

const overview: LoyaltyOverview = {
  scope: 'sitting_senators', minGroupVoters: 3, minRankedVotes: 100, senators: entries, groups: [], generatedAt: '',
};

const scrutin: Scrutin = {
  session: '2025', number: 338, date: '2026-07-21', title: 'Projet de loi sur l’ordre public', result: 'adopté',
  url: null, pour: 200, contre: 100, abstention: 20, total: 320, groups: [],
};

const rebel: RebelVote = {
  scrutinSession: '2025', scrutinNumber: 338, scrutinTitle: scrutin.title, scrutinDate: '2026-07-21',
  scrutinResult: 'adopté', vote: 'pour', groupPosition: 'abstention', group: 'RDSE',
  groupPour: 5, groupContre: 0, groupAbstention: 7, specialStatus: null, delegatedBy: null,
};

function rebels(overrides: Partial<SenatorRebels> = {}): SenatorRebels {
  return {
    matricule: 'A', minGroupVoters: 3, minRankedVotes: 100, follows: 800, rebels: 200, ties: 4, loyalty: 80,
    ranked: true, group: 'RDSE', groupAvgLoyalty: 93.7, total: 1, limit: REBELS_PAGE_SIZE, items: [rebel],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('loyalty helpers', () => {
  it('ranks the most independent first, honouring the group filter and the vote threshold', () => {
    expect(rankByIndependence(entries, { minVotes: 100 }).map(e => e.matricule)).toEqual(['A', 'C', 'F', 'B']);
    expect(rankByIndependence(entries, { minVotes: 500 }).map(e => e.matricule)).toEqual(['A', 'C', 'B']);
    expect(rankByIndependence(entries, { group: 'RDSE', minVotes: 100 }).map(e => e.matricule)).toEqual(['A', 'F']);
    // Non-inscrits and senators without counted votes are never ranked.
    expect(rankByIndependence(entries, { minVotes: 0 }).map(e => e.matricule)).not.toContain('E');
  });

  it('breaks loyalty ties by the larger sample, then by name', () => {
    const tied = [entry('X', 'Zoé', 'LR', 90, 10), entry('Y', 'Yves', 'LR', 900, 100), entry('Z', 'Anne', 'LR', 90, 10)];
    expect(rankByIndependence(tied, { minVotes: 0 }).map(e => e.matricule)).toEqual(['Y', 'Z', 'X']);
  });

  it('averages, formats and grades loyalty values', () => {
    expect(averageLoyalty(rankByIndependence(entries, { group: 'RDSE', minVotes: 100 }))).toBe(87.5);
    expect(averageLoyalty([])).toBeNull();
    expect(formatLoyalty(96.25).replace(/\s/g, ' ')).toBe('96,3 %');
    expect(formatLoyalty(100).replace(/\s/g, ' ')).toBe('100,0 %');
    expect(formatLoyalty(null)).toBe('—');
    expect([loyaltyTone(99), loyaltyTone(92), loyaltyTone(80), loyaltyTone(null)]).toEqual(['high', 'medium', 'low', 'none']);
  });
});

describe('SenatorLoyalty (senator panel)', () => {
  it('shows the loyalty, the group average and a collapsible list of rebel votes that open the scrutin', async () => {
    const user = userEvent.setup();
    const onOpenScrutin = vi.fn();
    apiMock.senatorRebels.mockResolvedValue(rebels());
    render(<SenatorLoyalty senator={senator('A', 'Alice Rebelle', 'RDSE')} scrutins={[scrutin]} onOpenScrutin={onOpenScrutin} />);

    expect(screen.getByText('Calcul de la loyauté…')).toBeTruthy();
    expect(await screen.findByText(/80,0\s%/)).toBeTruthy();
    expect(apiMock.senatorRebels).toHaveBeenCalledWith('A', REBELS_PAGE_SIZE, expect.any(AbortSignal));
    expect(screen.getByText(/Moyenne du groupe RDSE/).textContent).toMatch(/93,7\s%/);
    expect(screen.getByText(/sans majorité de groupe/)).toBeTruthy();
    expect(screen.queryByText(/Échantillon limité/)).toBeNull();

    const toggle = screen.getByRole('button', { name: /Voir les votes contre la ligne du groupe \(1\)/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(scrutin.title)).toBeNull();
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const row = screen.getByRole('button', { name: /Ouvrir le scrutin 338, session 2025\. Son vote : Pour, majorité du groupe : Abstention/ });
    expect(within(row).getByText('RDSE : Abstention')).toBeTruthy();
    expect(within(row).getByText(/5 pour · 0 contre · 7 abst\./)).toBeTruthy();
    await user.click(row);
    expect(onOpenScrutin).toHaveBeenCalledWith(scrutin);
  });

  it('loads the full list on demand when there are more rebel votes than the first page', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: REBELS_PAGE_SIZE }, (_, i) => ({ ...rebel, scrutinNumber: i + 1 }));
    apiMock.senatorRebels
      .mockResolvedValueOnce(rebels({ total: 120, items: many }))
      .mockResolvedValueOnce(rebels({ total: 120, limit: 120, items: Array.from({ length: 120 }, (_, i) => ({ ...rebel, scrutinNumber: i + 1 })) }));
    render(<SenatorLoyalty senator={senator('A', 'Alice Rebelle', 'RDSE')} scrutins={[]} onOpenScrutin={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /Voir les votes contre la ligne du groupe \(120\)/ }));
    await user.click(screen.getByRole('button', { name: `Tout afficher (${REBELS_PAGE_SIZE} sur 120)` }));
    await waitFor(() => expect(apiMock.senatorRebels).toHaveBeenLastCalledWith('A', 120, expect.any(AbortSignal)));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Tout afficher/ })).toBeNull());
    // Without the scrutin in the loaded list, the rows are not buttons.
    expect(screen.queryByRole('button', { name: /Ouvrir le scrutin/ })).toBeNull();
  });

  it('flags small samples and explains senators without comparable votes', async () => {
    apiMock.senatorRebels.mockResolvedValueOnce(rebels({ follows: 11, rebels: 1, loyalty: 91.7, ranked: false }));
    const { unmount } = render(<SenatorLoyalty senator={senator('D', 'David Nouveau', 'LR')} scrutins={[]} onOpenScrutin={vi.fn()} />);
    expect(await screen.findByText(/Échantillon limité \(moins de 100 votes comparés\)/)).toBeTruthy();
    unmount();

    apiMock.senatorRebels.mockResolvedValueOnce(rebels({ follows: 0, rebels: 0, loyalty: null, ranked: false, group: null, total: 0, items: [] }));
    render(<SenatorLoyalty senator={senator('E', 'Emma Libre', 'NI')} scrutins={[]} onOpenScrutin={vi.fn()} />);
    expect(await screen.findByText(/Aucun vote comparable/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Voir les votes/ })).toBeNull();
  });

  it('retries after an error and does not query the API for a former senator', async () => {
    const user = userEvent.setup();
    apiMock.senatorRebels.mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce(rebels());
    const { unmount } = render(<SenatorLoyalty senator={senator('A', 'Alice Rebelle', 'RDSE')} scrutins={[]} onOpenScrutin={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Impossible de charger la loyauté/);
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText(/80,0\s%/)).toBeTruthy();
    unmount();

    apiMock.senatorRebels.mockClear();
    render(<SenatorLoyalty senator={senator('O', 'Olga Ancienne', 'LR', 'ANCIEN')} scrutins={[]} onOpenScrutin={vi.fn()} />);
    expect(screen.getByText(/Non calculée/)).toBeTruthy();
    expect(apiMock.senatorRebels).not.toHaveBeenCalled();
  });
});

describe('LoyaltyRanking (Groups page)', () => {
  const senators = entries.map(e => senator(e.matricule, e.name, e.group));

  it('lists the most independent senators, filters by group and threshold, and opens a senator', async () => {
    const user = userEvent.setup();
    const onOpenSenator = vi.fn();
    apiMock.loyalty.mockResolvedValue(overview);
    render(<LoyaltyRanking senators={senators} stats={null} onOpenSenator={onOpenSenator} />);

    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('button').map(b => b.getAttribute('aria-label')?.split(',')[0]))
      .toEqual(['1. Alice Rebelle', '2. Chloé Centre', '3. Fanny Radicale', '4. Bruno Fidèle']);
    expect(screen.getByText('4', { selector: 'strong' })).toBeTruthy();

    // Group chips show the mean of the ranked members (RDSE: 80 and 95) and filter the list.
    const rdse = screen.getByRole('button', { name: /RDSE/, pressed: false });
    expect(rdse.textContent).toMatch(/87,5\s%/);
    await user.click(rdse);
    expect(within(screen.getByRole('list')).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText(/moyenne du groupe RDSE/).textContent).toMatch(/87,5\s%/);
    await user.click(screen.getByRole('button', { name: /RDSE/, pressed: true }));

    await user.click(screen.getByRole('button', { name: /Seuil de classement/ }));
    await user.click(screen.getByRole('menuitemradio', { name: /500 votes comparés ou plus/ }));
    expect(within(screen.getByRole('list')).getAllByRole('button')).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: /^1\. Alice Rebelle/ }));
    expect(onOpenSenator).toHaveBeenCalledWith(senators[0]);
  });

  it('pages long rankings and recovers from an error', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 25 }, (_, i) => entry(`M${i}`, `Sénateur ${String(i).padStart(2, '0')}`, 'LR', 900 + i, 100));
    apiMock.loyalty.mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce({ ...overview, senators: many });
    render(<LoyaltyRanking senators={many.map(e => senator(e.matricule, e.name, e.group))} stats={null} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Impossible de charger le classement/);
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(20);
    await user.click(screen.getByRole('button', { name: 'Afficher plus (20 sur 25)' }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(25);
  });

  it('opens its own senator panel when no onOpenSenator callback is given', async () => {
    const user = userEvent.setup();
    apiMock.loyalty.mockResolvedValue(overview);
    apiMock.senatorRebels.mockResolvedValue(rebels());
    apiMock.senatorVotes.mockResolvedValue({ total: 0, offset: 0, limit: 50, items: [] });
    apiMock.senatorDetail.mockResolvedValue({ id: 'A', group_memberships: [] });
    apiMock.senators.mockResolvedValue([]);
    render(<LoyaltyRanking senators={senators} stats={null} />);
    await user.click(await screen.findByRole('button', { name: /^1\. Alice Rebelle/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(await screen.findByText(/80,0\s%/, { selector: '.loyalty-score-value' })).toBeTruthy();
  });
});
