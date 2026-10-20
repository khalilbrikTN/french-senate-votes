// API_BASE is empty by default: the backend serves the app and the API from the same origin,
// and in development Vite proxies /api to it. Set VITE_API_BASE to call another server.
export const CONFIG = {
  API_BASE: import.meta.env.VITE_API_BASE ?? '',
  PAGE_SIZE: 18,
  HISTORY_PAGE_SIZE: 50,
} as const;
