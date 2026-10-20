import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get() { return this.parentElement; },
});

// jsdom has no canvas: return no 2D context (ECharts then estimates text widths) instead of
// logging "not implemented" for every chart.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => null });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
