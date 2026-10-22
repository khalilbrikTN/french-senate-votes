import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import ErrorBoundary from '../components/ErrorBoundary';
import type { ApiStatus, Scrutin } from '../types';

const apiMock = vi.hoisted(() => ({
  status: vi.fn(),
  senators: vi.fn(),
  scrutins: vi.fn(),
  stats: vi.fn(),
}));
vi.mock('../api/endpoints', () => ({ api: apiMock }));

// The Groupes view always crashes, to check the rest of the site survives it.
vi.mock('../GroupsView', () => ({
  default: () => { throw new Error('Groupes cassé'); },
}));

const scrutin: Scrutin = {
  session: '2024', number: 17, date: '2024-10-21', title: 'Projet de loi sur l’égalité',
  result: 'adopté', url: null, pour: 10, contre: 5, abstention: 3, total: 18, groups: [],
};
const online: ApiStatus = { status: 'online', backend: 'test', database: 'ok', hasData: true };

function Thrower({ fail }: { fail: boolean }) {
  if (fail) throw new Error('boom');
  return <p>Contenu affiché</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    apiMock.status.mockResolvedValue(online);
    apiMock.senators.mockResolvedValue([]);
    apiMock.scrutins.mockResolvedValue([scrutin]);
    apiMock.stats.mockResolvedValue(null);
  });

  it('renders the French fallback when a child throws, and resets when its key changes', () => {
    const { rerender } = render(<ErrorBoundary resetKey="a"><Thrower fail /></ErrorBoundary>);
    expect(screen.getByRole('heading', { name: 'Une erreur est survenue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recharger la page' })).toBeTruthy();

    // Same key: the error stays caught even if the child would now render.
    rerender(<ErrorBoundary resetKey="a"><Thrower fail={false} /></ErrorBoundary>);
    expect(screen.getByRole('heading', { name: 'Une erreur est survenue' })).toBeTruthy();
    rerender(<ErrorBoundary resetKey="b"><Thrower fail={false} /></ErrorBoundary>);
    expect(screen.getByText('Contenu affiché')).toBeTruthy();
  });

  it('keeps the header and the other views usable when one view crashes', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findAllByText(scrutin.title)).not.toHaveLength(0);

    await user.click(screen.getByRole('link', { name: 'Groupes' }));
    expect(await screen.findByRole('heading', { name: 'Une erreur est survenue' })).toBeTruthy();

    await user.click(screen.getByRole('link', { name: 'Scrutins' }));
    await waitFor(() => expect(window.location.hash).toBe('#scrutins'));
    expect(screen.getAllByText(scrutin.title)).not.toHaveLength(0);
  });
});
