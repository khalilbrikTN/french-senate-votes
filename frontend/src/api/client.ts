import { CONFIG } from '../config';

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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (error) {
    if (timedOut) throw new Error(`La requête a expiré après ${timeoutMs / 1000} s.`);
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
