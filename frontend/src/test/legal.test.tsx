import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import LegalView from '../LegalView';
import { startAnalytics } from '../lib/analytics';
import { parseHash } from '../lib/routes';

describe('Mentions légales', () => {
  it('has its own route and names the publisher and hosts', () => {
    expect(parseHash('#mentions-legales')).toEqual({ view: 'mentions-legales', dialog: null });
    render(<LegalView />);
    expect(screen.getByRole('heading', { level: 1, name: 'Mentions légales et confidentialité' })).toBeTruthy();
    expect(screen.getByText(/édité par Mohamed Khalil Brik/)).toBeTruthy();
    expect(screen.getByText(/Cloudflare, Inc\./)).toBeTruthy();
    expect(screen.getByText(/ni affilié au Sénat/)).toBeTruthy();
  });
});

describe('startAnalytics', () => {
  afterEach(() => document.querySelectorAll('script[data-cf-beacon]').forEach(s => s.remove()));

  it('loads nothing without a token', () => {
    startAnalytics('');
    expect(document.querySelector('script[data-cf-beacon]')).toBeNull();
  });

  it('adds the Cloudflare beacon once with the token', () => {
    startAnalytics('abc123');
    startAnalytics('abc123');
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[data-cf-beacon]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe('https://static.cloudflareinsights.com/beacon.min.js');
    expect(JSON.parse(scripts[0].dataset.cfBeacon!)).toEqual({ token: 'abc123', spa: true });
  });
});
