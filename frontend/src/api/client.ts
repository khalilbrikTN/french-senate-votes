import { CONFIG } from '../config';

// The server answered with a non-2xx status. The message keeps the historical "HTTP <code>" form.
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`La requête a expiré après ${timeoutMs / 1000} s.`);
    this.name = 'RequestTimeoutError';
  }
}

// GET a JSON resource from the API, failing after timeoutMs or when its caller is cancelled.
export async function fetchJSON<T>(path: string, timeoutMs = 4000, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });

  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetch(`${CONFIG.API_BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new HttpError(res.status);
    return (await res.json()) as T;
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError(timeoutMs);
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
