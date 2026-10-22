import { useEffect, useRef, useState, type RefObject } from 'react';

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * True once the element is near the viewport and, after the page has finished loading,
 * the browser is idle. Used to start heavy lazy imports (the chart library) without
 * competing with the first display. Without IntersectionObserver (tests, old browsers)
 * the element counts as visible.
 */
export function useIdleWhenNearViewport<T extends Element>(
  { rootMargin = '200px', idleTimeout = 2000 }: { rootMargin?: string; idleTimeout?: number } = {},
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (near || !ref.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setNear(true);
    }, { rootMargin });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near, rootMargin]);

  useEffect(() => {
    if (!near || ready) return;
    const win = window as IdleWindow;
    let idleHandle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (win.requestIdleCallback) idleHandle = win.requestIdleCallback(() => setReady(true), { timeout: idleTimeout });
      else timer = setTimeout(() => setReady(true), 50);
    };
    const onLoad = () => schedule();
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', onLoad, { once: true });
    return () => {
      window.removeEventListener('load', onLoad);
      if (idleHandle !== undefined) win.cancelIdleCallback?.(idleHandle);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [near, ready, idleTimeout]);

  return [ref, ready];
}
