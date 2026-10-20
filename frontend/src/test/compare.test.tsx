import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SenatorCompare, { resetCompareSenatorsCache } from '../components/SenatorCompare';
import SenatorDetailDialog from '../SenatorDetailDialog';
import { breakdownSegments, compareCandidates, foldText, formatAgreement } from '../lib/compare';
import type { Scrutin, Senator, SenatorComparison, Stats } from '../types';

const apiMock = vi.hoisted(() => ({
  senators: vi.fn(),
  senatorVotes: vi.fn(),
  senatorDetail: vi.fn(),
  compareSenators: vi.fn(),
  senatorRebels: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('../api/endpoints', () => ({ api: apiMock }));

function makeSenator(matricule: string, prenom: string, nom: string, extra: Partial<Senator> = {}): Senator {
  return {
    matricule, name: `${prenom} ${nom}`, prenom, nom, slug: null, civilite: 'M.', status: 'ACTIF',
    group: 'LR', groupFullName: null, lastGroupEndDate: null, serviceStart: null, serviceEnd: null,
    dept: 'Paris (75)', deptCode: '75', commission: null, avatar: null, url: null, profession: null,
    social: null, stats: { pour: 1, contre: 1, abstention: 0, total: 2 }, ...extra,
  };
}

const larcher = makeSenator('86034E', 'Gérard', 'Larcher', { dept: 'Yvelines (78)' });
const retailleau = makeSenator('04033B', 'Bruno', 'Retailleau', { dept: 'Vendée (85)' });
const eloise = makeSenator('X1', 'Éloïse', 'Lemaire', { group: 'SER', dept: 'Nord (59)' });
const former = makeSenator('OLD1', 'Ancien', 'Sénateur', { status: 'ANCIEN' });
const senators = [larcher, retailleau, eloise, former];

const scrutin: Scrutin = {
  session: '2013', number: 160, date: '2014-02-27', title: 'Projet de loi formation professionnelle',
  result: 'adopté', url: null, pour: 10, contre: 5, abstention: 3, total: 18, groups: [],
};

const stats: Stats = {
  totalScrutins: 1, adoptes: 1, rejetes: 0, adoptionRate: 100, totalSenateurs: 3,
  groups: {}, groupColors: {}, generatedAt: '2026-10-20T00:00:00Z', source: 'test fixture',
};

const comparison: SenatorComparison = {
  a: '86034E', b: '04033B', scope: 'sitting_senators', shared: 809, agree: 785, agreementRate: 0.9703,
  breakdown: { bothPour: 417, bothContre: 338, bothAbstention: 30, opposite: 12, oneAbstained: 12 },
  firstDate: '2007-10-01', lastDate: '2023-07-18',
  disagreements: [
    { session: '2013', number: 160, date: '2014-02-27', title: scrutin.title, result: 'adopté', positionA: 'abstention', positionB: 'contre' },
    { session: '2012', number: 5, date: '2012-11-02', title: 'Scrutin absent de la liste', result: 'rejeté', positionA: 'pour', positionB: 'contre' },
  ],
};

const noShared: SenatorComparison = {
  ...comparison, b: 'X1', shared: 0, agree: 0, agreementRate: null,
  breakdown: { bothPour: 0, bothContre: 0, bothAbstention: 0, opposite: 0, oneAbstained: 0 },
  firstDate: null, lastDate: null, disagreements: [],
};

function renderCompare(onOpenScrutin = vi.fn()) {
  render(<SenatorCompare senator={larcher} scrutins={[scrutin]} stats={stats} onOpenScrutin={onOpenScrutin} />);
  return { onOpenScrutin, input: screen.getByRole('combobox', { name: 'Rechercher un sénateur en exercice' }) };
}

describe('compare helpers', () => {
  it('folds accents and case', () => {
    expect(foldText('  Éloïse LEMAIRE ')).toBe('eloise lemaire');
  });

  it('lists sitting senators only, excluding the current one, prefix matches first', () => {
    expect(compareCandidates(senators, '', '86034E')).toEqual([]);
    expect(compareCandidates(senators, 'eloise', '86034E')).toEqual([eloise]);
    expect(compareCandidates(senators, 'larch', '86034E')).toEqual([]);
    expect(compareCandidates(senators, 'senateur', '86034E')).toEqual([]); // former senator
    expect(compareCandidates(senators, 'vendee', '86034E')).toEqual([retailleau]);
    // "re" starts Retailleau's last name (rank 0) and is inside "Lemaire" (rank 1).
    expect(compareCandidates(senators, 're', 'nobody').map(s => s.matricule)).toEqual(['04033B', 'X1']);
    expect(compareCandidates(senators, 'r', 'nobody', 1)).toHaveLength(1);
  });

  it('formats the agreement and the breakdown', () => {
    expect(formatAgreement(null)).toBe('—');
    expect(formatAgreement(0.9703).replace(/\s/g, ' ')).toBe('97 %');
    expect(formatAgreement(0.5).replace(/\s/g, ' ')).toBe('50 %');
    const segments = breakdownSegments(comparison);
    expect(segments.map(s => s.value)).toEqual([417, 338, 30, 12, 12]);
    expect(segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
    expect(segments.filter(s => s.agree).reduce((sum, s) => sum + s.value, 0)).toBe(comparison.agree);
    expect(breakdownSegments(noShared).every(s => s.share === 0)).toBe(true);
  });
});

describe('SenatorCompare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCompareSenatorsCache();
    apiMock.senators.mockResolvedValue(senators);
    apiMock.compareSenators.mockResolvedValue(comparison);
  });

  it('searches with the keyboard, shows the agreement and opens a disagreement', async () => {
    const user = userEvent.setup();
    const { input, onOpenScrutin } = renderCompare();
    expect(apiMock.senators).not.toHaveBeenCalled(); // loaded on first use only

    await user.type(input, 'ret');
    const listbox = await screen.findByRole('listbox', { name: 'Sénateurs en exercice' });
    expect(apiMock.senators).toHaveBeenCalledTimes(1);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const options = within(listbox).getAllByRole('option');
    expect(options.map(option => option.textContent)).toEqual([expect.stringContaining('Bruno Retailleau')]);
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);

    await user.keyboard('{Enter}');
    expect(apiMock.compareSenators).toHaveBeenCalledWith('86034E', '04033B', expect.any(AbortSignal));
    expect((await screen.findByText(/97/)).textContent?.replace(/\s/g, ' ')).toBe('97 %');
    expect(screen.getByText(/Même position sur/).textContent?.replace(/\s/g, ' ')).toContain('785 des 809 votes communs');
    expect(screen.getByText(/Période couverte/).textContent).toContain('du 1 octobre 2007 au 18 juillet 2023');
    const breakdown = screen.getByRole('list', { name: 'Répartition des votes communs' });
    expect(within(breakdown).getByText('Positions opposées').nextSibling?.textContent).toBe('12');
    expect(screen.getByText(/Désaccords les plus récents \(24\)/)).toBeTruthy();
    expect(screen.getByText(/2 désaccords les plus récents sur 24/)).toBeTruthy();

    // A known scrutin opens; one missing from the loaded list is shown but not clickable.
    const row = screen.getByRole('button', { name: /Ouvrir le scrutin 160, session 2013 : Larcher abstention, Retailleau contre/ });
    await user.click(row);
    expect(onOpenScrutin).toHaveBeenCalledWith(scrutin);
    expect(screen.getByText('Scrutin absent de la liste').closest('button')).toBeNull();
    expect(screen.getByText(/Seuls les votes individuels des sénateurs en exercice/)).toBeTruthy();
  });

  it('aborts the previous request when another senator is picked', async () => {
    const user = userEvent.setup();
    let firstSignal: AbortSignal | undefined;
    apiMock.compareSenators
      .mockImplementationOnce((_a: string, _b: string, signal: AbortSignal) => {
        firstSignal = signal;
        return new Promise(() => undefined); // never resolves
      })
      .mockResolvedValueOnce(noShared);
    const { input } = renderCompare();

    await user.type(input, 'retail');
    await user.click(await screen.findByRole('option', { name: /Bruno Retailleau/ }));
    expect(await screen.findByText('Comparaison des votes…')).toBeTruthy();

    await user.type(input, 'lemaire');
    await user.click(await screen.findByRole('option', { name: /Éloïse Lemaire/ }));
    expect(firstSignal?.aborted).toBe(true);
    expect(apiMock.compareSenators).toHaveBeenLastCalledWith('86034E', 'X1', expect.any(AbortSignal));
    expect((await screen.findByText(/Aucun vote commun/)).textContent).toContain('Éloïse Lemaire');
    expect(screen.queryByText(/Désaccords les plus récents/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Retirer Éloïse Lemaire de la comparaison' }));
    expect(screen.queryByText(/Aucun vote commun/)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('closes the suggestions on Escape without closing the dialog, and reports no match', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    apiMock.senatorVotes.mockResolvedValue({ total: 0, offset: 0, limit: 50, items: [] });
    apiMock.senatorDetail.mockResolvedValue({ id: larcher.matricule, group_memberships: [] });
    render(<SenatorDetailDialog senator={larcher} scrutins={[scrutin]} stats={stats} onClose={onClose} onOpenScrutin={vi.fn()} />);
    const input = screen.getByRole('combobox', { name: 'Rechercher un sénateur en exercice' });

    await user.type(input, 'zzz');
    expect(await screen.findByText(/Aucun sénateur en exercice ne correspond/)).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}'); // clears the query
    expect((input as HTMLInputElement).value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a retry when the comparison fails and only a note for former senators', async () => {
    apiMock.compareSenators.mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce(comparison);
    const user = userEvent.setup();
    const { input } = renderCompare();
    await user.type(input, 'retail');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toContain('erreur (503)');
    await act(async () => { await user.click(screen.getByRole('button', { name: 'Réessayer' })); });
    expect((await screen.findByText(/Même position sur/)).textContent).toContain('809');

    render(<SenatorCompare senator={former} scrutins={[]} stats={null} onOpenScrutin={vi.fn()} />);
    expect(screen.getByText(/disponible que pour les sénateurs en exercice/)).toBeTruthy();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });
});
