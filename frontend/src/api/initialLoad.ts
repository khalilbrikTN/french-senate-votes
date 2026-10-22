import { HttpError, RequestTimeoutError } from './client';
import { api } from './endpoints';
import type { Scrutin, Senator, Stats } from '../types';

// The production backend sleeps when idle and needs 30-60 s to wake up:
// the first load keeps retrying within this overall budget before giving up.
export const INITIAL_LOAD_BUDGET_MS = 90_000;
const STATUS_TIMEOUT_MS = 20_000;
const LIST_TIMEOUT_MS = 30_000;
const MIN_ATTEMPT_TIMEOUT_MS = 1_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

export interface InitialData {
  senators: Senator[];
  scrutins: Scrutin[];
  stats: Stats | null;
}

// The backend answered but cannot read its database yet (it may still be connecting).
export class BackendNotReadyError extends Error {
  constructor() {
    super('Le backend ne peut pas accéder aux données. Vérifiez sa connexion à la base de données.');
    this.name = 'BackendNotReadyError';
  }
}

// Network failures, timeouts and 5xx answers are typical of a waking server; 4xx and bad payloads are not.
export function isRetriableError(error: unknown): boolean {
  if (error instanceof HttpError) return error.status >= 500;
  return error instanceof RequestTimeoutError
    || error instanceof BackendNotReadyError
    || error instanceof TypeError; // fetch() rejects with TypeError when the connection fails
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function withRetry<T>(
  request: (timeoutMs: number) => Promise<T>,
  maxTimeoutMs: number,
  deadline: number,
  signal: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const remaining = deadline - Date.now();
    try {
      return await request(Math.max(MIN_ATTEMPT_TIMEOUT_MS, Math.min(maxTimeoutMs, remaining)));
    } catch (error) {
      if (signal.aborted || !isRetriableError(error)) throw error;
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      if (Date.now() + delay + MIN_ATTEMPT_TIMEOUT_MS > deadline) throw error;
      await wait(delay, signal);
    }
  }
}

export async function loadInitialData(signal: AbortSignal, budgetMs = INITIAL_LOAD_BUDGET_MS): Promise<InitialData> {
  const deadline = Date.now() + budgetMs;

  await withRetry(async timeoutMs => {
    const status = await api.status(signal, timeoutMs);
    if (status.status !== 'online' || !status.hasData) throw new BackendNotReadyError();
  }, STATUS_TIMEOUT_MS, deadline, signal);

  const [senators, scrutins, stats] = await Promise.all([
    withRetry(timeoutMs => api.senators(signal, timeoutMs), LIST_TIMEOUT_MS, deadline, signal),
    withRetry(timeoutMs => api.scrutins(signal, timeoutMs), LIST_TIMEOUT_MS, deadline, signal),
    // Statistics are optional: the site works without them.
    api.stats(signal, LIST_TIMEOUT_MS).catch(() => null),
  ]);
  return { senators, scrutins, stats };
}
