// Visit counting with Cloudflare Web Analytics: no cookies, no stored IP, aggregate figures only.
// Enabled when the site is built with VITE_CF_ANALYTICS_TOKEN (the token Cloudflare gives for the site).
export function startAnalytics(token = import.meta.env.VITE_CF_ANALYTICS_TOKEN as string | undefined) {
  if (!token || document.querySelector('script[data-cf-beacon]')) return;
  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  script.dataset.cfBeacon = JSON.stringify({ token, spa: true });
  document.head.appendChild(script);
}
