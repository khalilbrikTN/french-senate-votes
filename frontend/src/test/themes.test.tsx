import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ScrutinsView from '../ScrutinsView';
import ScrutinCard from '../components/ScrutinCard';
import ThemeCharts from '../stats/ThemesChart';
import { readChartTheme } from '../lib/chartTheme';
import {
  ALL_THEMES, THEME_MIN_VOTES, filterByTheme, hasThemes, shortThemeLabel, themeAdoption, themeAnalysisScope,
  themeCounts, themeGroupMatrix,
} from '../lib/themes';
import type { Scrutin, ThemeStats } from '../types';

const apiMock = vi.hoisted(() => ({ themeStats: vi.fn() }));
vi.mock('../api/endpoints', () => ({ api: apiMock }));

function vote(partial: Partial<Scrutin>): Scrutin {
  return {
    session: '2025', number: 1, date: '2025-11-15', title: 'sur l’ensemble du texte', result: 'adopté', url: null,
    pour: 200, contre: 100, abstention: 10, total: 310, groups: [],
    theme: 'budget', themeLabel: 'Budget & fiscalité', voteType: 'ensemble', voteTypeLabel: 'Ensemble du texte',
    ...partial,
  };
}

const budget = (n: number, extra: Partial<Scrutin> = {}) => vote({ number: n, ...extra });
const justice = (n: number, extra: Partial<Scrutin> = {}) =>
  vote({ number: n, theme: 'justice', themeLabel: 'Justice & sécurité', title: `sur la proposition de loi pénale ${n}`, ...extra });
const other = (n: number) => vote({ number: n, theme: 'autres', themeLabel: 'Autres', title: 'sur la déclaration' });

const scrutins: Scrutin[] = [
  budget(1), budget(2, { result: 'rejeté' }), budget(3),
  justice(4), justice(5, { result: 'rejeté' }),
  other(6),
  budget(7, { session: '2024', date: '2024-11-15' }),
  vote({ number: 8, session: '2024', date: '2024-11-16', theme: 'culture', themeLabel: 'Culture, médias & sport' }),
];

const themeStats: ThemeStats = {
  scope: 'sitting_senators',
  minGroupVoters: 3,
  note: 'Thèmes attribués automatiquement',
  generatedAt: '2026-10-20T00:00:00+00:00',
  themes: [
    { id: 'budget', label: 'Budget & fiscalité' },
    { id: 'justice', label: 'Justice & sécurité' },
    { id: 'culture', label: 'Culture, médias & sport' },
    { id: 'autres', label: 'Autres' },
  ],
  sessions: [
    { session: '2010', votes: 277, officialVoters: 92192, individualCast: 3962, votesWithIndividual: 277, coverage: 0.043 },
    { session: '2024', votes: 359, officialVoters: 119014, individualCast: 91775, votesWithIndividual: 359, coverage: 0.7711 },
    { session: '2025', votes: 337, officialVoters: 113929, individualCast: 91542, votesWithIndividual: 337, coverage: 0.8035 },
  ],
  votes: [{ session: '2025', theme: 'budget', votes: 3, adopted: 2 }],
  groups: [
    { session: '2025', theme: 'budget', group: 'LR', votes: 40, pour: 30, contre: 8, abstention: 1 },
    { session: '2025', theme: 'budget', group: 'SER', votes: 40, pour: 10, contre: 28, abstention: 0 },
    { session: '2024', theme: 'budget', group: 'LR', votes: 20, pour: 10, contre: 10, abstention: 0 },
    { session: '2025', theme: 'justice', group: 'LR', votes: 12, pour: 12, contre: 0, abstention: 0 },
    // Below THEME_MIN_VOTES: shown as an empty cell, not a rate.
    { session: '2025', theme: 'justice', group: 'SER', votes: THEME_MIN_VOTES - 1, pour: 1, contre: 3, abstention: 0 },
    // Only below the threshold: the theme gets no row.
    { session: '2025', theme: 'culture', group: 'LR', votes: 2, pour: 2, contre: 0, abstention: 0 },
    // The non-inscrits are not a group.
    { session: '2025', theme: 'budget', group: 'NI', votes: 30, pour: 30, contre: 0, abstention: 0 },
  ],
};

describe('theme helpers', () => {
  it('counts every theme of the data, most frequent first and "Autres" last', () => {
    const session2025 = scrutins.filter(s => s.session === '2025');
    const counts = themeCounts(scrutins, session2025);
    expect(counts.map(c => [c.id, c.count])).toEqual([['budget', 3], ['justice', 2], ['culture', 0], ['autres', 1]]);
    expect(hasThemes(scrutins)).toBe(true);
    expect(hasThemes([vote({ theme: undefined })])).toBe(false);
  });

  it('filters by theme and treats a missing theme as "autres"', () => {
    expect(filterByTheme(scrutins, ALL_THEMES)).toHaveLength(scrutins.length);
    expect(filterByTheme(scrutins, 'justice').map(s => s.number)).toEqual([4, 5]);
    expect(filterByTheme([vote({ theme: undefined })], 'autres')).toHaveLength(1);
  });

  it('computes the adoption rate per theme', () => {
    const rows = themeAdoption(scrutins.filter(s => s.session === '2025'));
    expect(rows[0]).toMatchObject({ id: 'budget', total: 3, adopted: 2, rejected: 1, rate: 66.7 });
    expect(rows[rows.length - 1].id).toBe('autres');
  });

  it('shortens labels for narrow axes', () => {
    expect(shortThemeLabel('Sécurité sociale & santé')).toBe('Sécurité sociale');
    expect(shortThemeLabel('Culture, médias & sport')).toBe('Culture');
    expect(shortThemeLabel('Autres')).toBe('Autres');
  });

  it('applies the coverage thresholds of the group charts', () => {
    expect(themeAnalysisScope(themeStats, '2025')).toMatchObject({ sessions: ['2025'], state: 'ok' });
    expect(themeAnalysisScope(themeStats, '2010').state).toBe('low');
    expect(themeAnalysisScope(themeStats, 'all').sessions).toEqual(['2024', '2025']);
  });

  it('builds the group × theme matrix with minimum votes and without the non-inscrits', () => {
    const matrix = themeGroupMatrix(themeStats, ['2025']);
    expect(matrix.groups).toEqual(['SER', 'LR']); // political order, NI left out
    expect(matrix.themes.map(t => t.id)).toEqual(['budget', 'justice']);
    const cell = (theme: string, group: string) => matrix.cells.find(c => c.theme === theme && c.group === group);
    expect(cell('budget', 'LR')?.pct).toBe(75);
    expect(cell('justice', 'SER')?.pct).toBeNull();
    // Pooled over sessions.
    expect(themeGroupMatrix(themeStats, ['2024', '2025']).cells.find(c => c.theme === 'budget' && c.group === 'LR'))
      .toMatchObject({ votes: 60, pour: 40, pct: 66.7 });
  });
});

const resultsCount = () => document.querySelector('.results-count')?.textContent;

describe('theme UI', () => {
  it('shows the theme as a tag on a vote card', () => {
    render(<ScrutinCard scrutin={justice(4)} index={0} onOpen={vi.fn()} />);
    expect(screen.getByText('Justice & sécurité').className).toContain('card-tag--theme');
  });

  it('filters the votes page by theme, combined with the result filter and the session', async () => {
    const user = userEvent.setup();
    render(<ScrutinsView scrutins={scrutins} stats={null} selectedSession="2025" onOpenScrutin={vi.fn()} onOpenSearch={vi.fn()} />);
    expect(resultsCount()).toBe('6 scrutins');

    await user.click(screen.getByRole('button', { name: /Thème/ }));
    const menu = screen.getByRole('menu');
    // Counts follow the selected session; themes of other sessions stay listed.
    expect(within(menu).getByRole('menuitemradio', { name: /Culture, médias & sport\s*0 scrutin/ })).toBeTruthy();
    await user.click(within(menu).getByRole('menuitemradio', { name: /Justice & sécurité/ }));

    expect(resultsCount()).toBe('2 scrutins');
    expect(screen.getByText(/classement indicatif/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Rejetés' }));
    expect(resultsCount()).toBe('1 scrutin');
  });

  it('renders the theme charts and the group heatmap data from /api/stats/themes', async () => {
    apiMock.themeStats.mockResolvedValue(themeStats);
    render(
      <ThemeCharts
        scrutins={scrutins.filter(s => s.session === '2025')}
        selectedSession="2025"
        sessionLabel="Session 2025-2026"
        stats={null}
        theme={readChartTheme()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Scrutins par thème' })).toBeTruthy();
    expect(screen.getByText(/classement approximatif/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Vote des groupes par thème' })).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/couverture 80 %/)).toBeTruthy());
    const tables = screen.getAllByRole('table');
    expect(within(tables[0]).getByRole('rowheader', { name: 'Budget & fiscalité' })).toBeTruthy();
    expect(within(tables[1]).getAllByRole('cell', { name: '75,0 %' })).toHaveLength(1);
  });

  it('warns instead of drawing the heatmap when the session coverage is too low', async () => {
    apiMock.themeStats.mockResolvedValue(themeStats);
    render(<ThemeCharts scrutins={[]} selectedSession="2010" sessionLabel="Session 2010-2011" stats={null} theme={readChartTheme()} />);
    expect(await screen.findByText(/Couverture insuffisante/)).toBeTruthy();
    expect(screen.getByText('Aucun scrutin pour cette sélection.')).toBeTruthy();
  });

  it('offers a retry when the route fails', async () => {
    apiMock.themeStats.mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValue(themeStats);
    const user = userEvent.setup();
    render(<ThemeCharts scrutins={[]} selectedSession="2025" sessionLabel="Session 2025-2026" stats={null} theme={readChartTheme()} />);
    await user.click(await screen.findByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(screen.getByText(/couverture 80 %/)).toBeTruthy());
  });
});
