import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  adoptionBySession, agreementIndex, agreementMatrix, assignSeats, cohesionGrid, closestVotes,
  groupAnalysisScope, hemicycleLayout, marginHistogram, monthlyActivity, orderGroupsForHemicycle,
} from '../lib/statsCharts';
import { inkOn, sequentialColor } from '../lib/chartTheme';
import type { GroupStats, Scrutin } from '../types';

const apiMock = vi.hoisted(() => ({ groupStats: vi.fn() }));
vi.mock('../api/endpoints', () => ({ api: apiMock }));

function vote(partial: Partial<Scrutin>): Scrutin {
  return {
    session: '2024', number: 1, date: '2024-10-15', title: 'Texte', result: 'adopté', url: null,
    pour: 200, contre: 100, abstention: 10, total: 310, groups: [], ...partial,
  };
}

const groupStats: GroupStats = {
  scope: 'sitting_senators',
  minGroupVoters: 3,
  generatedAt: '2026-10-20T00:00:00+00:00',
  sessions: [
    { session: '2010', votes: 277, officialVoters: 92192, individualCast: 3962, votesWithIndividual: 277, coverage: 0.043 },
    { session: '2022', votes: 331, officialVoters: 112864, individualCast: 63615, votesWithIndividual: 331, coverage: 0.5636 },
    { session: '2024', votes: 359, officialVoters: 119014, individualCast: 91775, votesWithIndividual: 359, coverage: 0.7711 },
    { session: '2025', votes: 337, officialVoters: 113929, individualCast: 91542, votesWithIndividual: 337, coverage: 0.8035 },
  ],
  cohesion: [
    { session: '2010', group: 'LR', votes: 277, avgVoters: 8, agreementIndex: 0.99 },
    { session: '2022', group: 'LR', votes: 331, avgVoters: 80, agreementIndex: 0.981 },
    { session: '2024', group: 'LR', votes: 359, avgVoters: 93, agreementIndex: 0.98 },
    { session: '2025', group: 'LR', votes: 337, avgVoters: 98, agreementIndex: 0.974 },
    { session: '2025', group: 'SER', votes: 335, avgVoters: 53, agreementIndex: 0.996 },
    { session: '2025', group: 'RDSE', votes: 4, avgVoters: 3, agreementIndex: 1 },
    { session: '2025', group: 'NI', votes: 104, avgVoters: 3, agreementIndex: 1 },
  ],
  agreement: [
    { session: '2024', groupA: 'LR', groupB: 'SER', votes: 300, agree: 60 },
    { session: '2025', groupA: 'LR', groupB: 'SER', votes: 335, agree: 82 },
    { session: '2025', groupA: 'LR', groupB: 'UC', votes: 336, agree: 317 },
    { session: '2025', groupA: 'SER', groupB: 'UC', votes: 334, agree: 97 },
    { session: '2025', groupA: 'LR', groupB: 'NI', votes: 104, agree: 58 },
    { session: '2010', groupA: 'LR', groupB: 'UC', votes: 100, agree: 90 },
  ],
};

describe('statistics chart data shaping', () => {
  it('buckets votes per month, filling the months without votes', () => {
    const data = monthlyActivity([
      vote({ date: '2024-10-02' }),
      vote({ date: '2024-10-30', result: 'rejeté' }),
      vote({ date: '2025-01-12' }),
      vote({ date: null }),
    ]);
    expect(data.months).toEqual(['2024-10', '2024-11', '2024-12', '2025-01']);
    expect(data.adopted).toEqual([1, 0, 0, 1]);
    expect(data.rejected).toEqual([1, 0, 0, 0]);
    expect(monthlyActivity([])).toEqual({ months: [], adopted: [], rejected: [] });
  });

  it('computes the adoption rate of every session in chronological order', () => {
    const rows = adoptionBySession([
      vote({ session: '2025' }), vote({ session: '2025', result: 'rejeté' }), vote({ session: '2025' }),
      vote({ session: '2009' }),
    ]);
    expect(rows.map(r => r.session)).toEqual(['2009', '2025']);
    expect(rows[1]).toMatchObject({ total: 3, adopted: 2, rejected: 1, rate: 66.7 });
  });

  it('builds a margin histogram and counts votes decided by fewer than 10 votes', () => {
    const histogram = marginHistogram([
      vote({ pour: 150, contre: 141 }), // 9: close
      vote({ pour: 141, contre: 150, result: 'rejeté' }), // 9: close
      vote({ pour: 160, contre: 150 }), // 10: not close
      vote({ pour: 300, contre: 5 }), // 295
      vote({ pour: 0, contre: 0 }), // no count: skipped
    ]);
    expect(histogram.total).toBe(4);
    expect(histogram.close).toBe(2);
    expect(histogram.bins[0]).toEqual({ from: 0, to: 10, adopted: 1, rejected: 1 });
    expect(histogram.bins[1]).toMatchObject({ adopted: 1, rejected: 0 });
    expect(histogram.bins).toHaveLength(30);
    expect(histogram.bins.reduce((a, b) => a + b.adopted + b.rejected, 0)).toBe(4);
  });

  it('keeps the closest votes ordered by margin', () => {
    const votes = closestVotes([vote({ number: 1, pour: 100, contre: 50 }), vote({ number: 2, pour: 100, contre: 99 }), vote({ number: 3, pour: 10, contre: 0 })]);
    expect(votes.map(v => v.number)).toEqual([2, 1]);
  });

  it('lays out exactly one hemicycle seat per senator, left to right, inside the unit semicircle', () => {
    for (const total of [1, 2, 17, 100, 348]) {
      const layout = hemicycleLayout(total);
      expect(layout.seats).toHaveLength(total);
      for (const seat of layout.seats) {
        expect(Math.hypot(seat.x, seat.y)).toBeLessThanOrEqual(1 + 1e-9);
        expect(seat.y).toBeGreaterThanOrEqual(-1e-9);
      }
      const angles = layout.seats.map(s => s.angle);
      expect([...angles].sort((a, b) => b - a)).toEqual(angles);
    }
    const senate = hemicycleLayout(348);
    expect(senate.rows).toBeGreaterThan(5);
    // No two seats overlap.
    let minDistance = Infinity;
    for (let i = 0; i < senate.seats.length; i += 1) {
      for (let j = i + 1; j < senate.seats.length; j += 1) {
        const a = senate.seats[i]; const b = senate.seats[j];
        minDistance = Math.min(minDistance, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    expect(minDistance).toBeGreaterThanOrEqual(2 * senate.dotRadius);
    expect(hemicycleLayout(0).seats).toEqual([]);
  });

  it('orders groups politically and assigns contiguous seats', () => {
    const groups = orderGroupsForHemicycle([
      { code: 'NI', seats: 2 }, { code: 'LR', seats: 5 }, { code: 'CRCE-K', seats: 3 }, { code: 'XYZ', seats: 1 }, { code: 'UC', seats: 0 },
    ]);
    expect(groups.map(g => g.code)).toEqual(['CRCE-K', 'LR', 'XYZ', 'NI']);
    const seats = assignSeats(hemicycleLayout(11), groups);
    expect(seats.map(s => s.group)).toEqual([
      'CRCE-K', 'CRCE-K', 'CRCE-K', 'LR', 'LR', 'LR', 'LR', 'LR', 'XYZ', 'NI', 'NI',
    ]);
  });

  it('computes the Hix–Noury–Roland agreement index', () => {
    expect(agreementIndex(10, 0, 0)).toBe(1);
    expect(agreementIndex(5, 5, 5)).toBeCloseTo(0);
    expect(agreementIndex(6, 2, 0)).toBeCloseTo((6 - 0.5 * 2) / 8);
    expect(agreementIndex(0, 0, 0)).toBeNull();
  });

  it('chooses the sessions of the agreement matrix from their coverage', () => {
    expect(groupAnalysisScope(groupStats, 'all')).toMatchObject({ sessions: ['2024', '2025'], state: 'ok' });
    expect(groupAnalysisScope(groupStats, '2025')).toMatchObject({ sessions: ['2025'], state: 'ok' });
    expect(groupAnalysisScope(groupStats, '2022').state).toBe('partial');
    expect(groupAnalysisScope(groupStats, '2010').state).toBe('low');
    expect(groupAnalysisScope(groupStats, '1999').state).toBe('empty');
  });

  it('pools agreement over sessions, in hemicycle order, without the non-inscrits', () => {
    const matrix = agreementMatrix(groupStats, ['2024', '2025']);
    expect(matrix.groups).toEqual(['SER', 'UC', 'LR']);
    const lrSer = matrix.cells.find(c => c.a === 'LR' && c.b === 'SER');
    expect(lrSer).toMatchObject({ votes: 635, agree: 142, pct: 22.4 });
    expect(matrix.cells.find(c => c.a === 'SER' && c.b === 'LR')?.pct).toBe(22.4);
    expect(matrix.cells).toHaveLength(6);
  });

  it('keeps cohesion only for covered sessions and groups with enough votes', () => {
    const grid = cohesionGrid(groupStats);
    expect(grid.sessions.map(s => [s.session, s.partial])).toEqual([['2022', true], ['2024', false], ['2025', false]]);
    expect(grid.hiddenSessions).toBe(1);
    expect(grid.groups).toEqual(['SER', 'LR']);
    expect(grid.cells.find(c => c.session === '2025' && c.group === 'LR')?.value).toBe(97.4);
  });

  it('interpolates the sequential ramp and picks readable ink', () => {
    expect(sequentialColor(0)).toBe('#1d2650');
    expect(sequentialColor(1)).toBe('#dcdcfd');
    expect(inkOn(sequentialColor(1))).toBe('#0b1422');
    expect(inkOn(sequentialColor(0))).toBe('#f5f1e9');
  });
});

describe('Statistics view', () => {
  const scrutins = [
    vote({ session: '2025', number: 1, date: '2025-10-07' }),
    vote({ session: '2025', number: 2, date: '2025-11-07', pour: 160, contre: 155, result: 'adopté' }),
    vote({ session: '2010', number: 3, date: '2010-11-07', result: 'rejeté', pour: 100, contre: 200 }),
  ];

  it('renders the charts with text alternatives, and explains low coverage instead of numbers', async () => {
    apiMock.groupStats.mockResolvedValue(groupStats);
    const { default: StatsView } = await import('../StatsView');
    const { rerender } = render(<StatsView scrutins={scrutins} stats={null} selectedSession="2025" onOpenScrutin={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Composition du Sénat' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Hémicycle de 348 sièges/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Histogramme mensuel/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /1 scrutins sur 2 .* moins de 10 voix/ })).toBeTruthy();
    expect(await screen.findByRole('img', { name: /Matrice d’accord entre 3 groupes, session 2025-2026/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Cohésion de 2 groupes sur 3 sessions/ })).toBeTruthy();

    const hemicycle = screen.getByRole('list', { name: /Sièges par groupe/ });
    expect(within(hemicycle).getAllByRole('listitem').map(li => li.textContent?.replace(/\d+$/, ''))[0]).toBe('CRCE-K');

    rerender(<StatsView scrutins={scrutins} stats={null} selectedSession="2010" onOpenScrutin={vi.fn()} />);
    expect(screen.getByText(/Couverture insuffisante/)).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Matrice d’accord/ })).toBeNull();
    expect(screen.getByText(/La session 2010-2011 n’est pas affichée/)).toBeTruthy();
  });

  it('shows an error state with a retry when the group statistics fail', async () => {
    apiMock.groupStats.mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce(groupStats);
    const { default: StatsView } = await import('../StatsView');
    render(<StatsView scrutins={scrutins} stats={null} selectedSession="all" onOpenScrutin={vi.fn()} />);
    const retry = await screen.findByRole('button', { name: 'Réessayer' });
    retry.click();
    expect(await screen.findByRole('img', { name: /Matrice d’accord/ })).toBeTruthy();
  });
});
