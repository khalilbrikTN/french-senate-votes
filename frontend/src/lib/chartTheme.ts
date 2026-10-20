// Chart colours and type, taken from the site's design tokens (legacy.css / design-tokens.css)
// so the charts look native; fallbacks keep them usable where the CSS is absent (tests).

export interface ChartTheme {
  surface: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  grid: string;
  axis: string;
  accent: string;
  accentMuted: string;
  adopted: string;
  rejected: string;
  fontFamily: string;
}

const FALLBACK: ChartTheme = {
  surface: '#162337',
  textPrimary: '#f5f1e9',
  textSecondary: '#bec8d7',
  textMuted: '#9aa7b8',
  grid: 'rgba(255,255,255,0.06)',
  axis: 'rgba(255,255,255,0.16)',
  accent: '#8585f6',
  accentMuted: '#3a4766',
  // Outcome colours of the site (--color-green / --color-red), stepped into the dark chart band
  // so the pair separates under deuteranopia/protanopia too (validated: ΔE 6.0, so the stacks
  // also keep a fixed order, a surface gap, a legend and a data table as secondary encoding).
  adopted: '#19a04e',
  rejected: '#f05a5d',
  fontFamily: "'Inter', system-ui, sans-serif",
};

export function readChartTheme(element?: Element | null): ChartTheme {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return FALLBACK;
  const style = getComputedStyle(element ?? document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    ...FALLBACK,
    surface: read('--sv-color-surface-card', read('--color-bg-card', FALLBACK.surface)),
    textPrimary: read('--color-text-primary', FALLBACK.textPrimary),
    textSecondary: read('--color-text-secondary', FALLBACK.textSecondary),
    textMuted: read('--color-text-muted', FALLBACK.textMuted),
    accent: read('--sv-color-action-primary', FALLBACK.accent),
    fontFamily: read('--font-body', FALLBACK.fontFamily),
  };
}

// One-hue sequential ramp (Bleu France dark-scheme hue, #8585f6), dark = low, light = high,
// for magnitudes on the dark cards (agreement %, cohesion index).
export const SEQUENTIAL_RAMP = ['#1d2650', '#2c3884', '#4049b5', '#5d63dc', '#8585f6', '#b1b1f9', '#dcdcfd'];

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}

function rgbToHex(rgb: number[]): string {
  return `#${rgb.map(c => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`;
}

// t in [0, 1] → colour along the ramp (linear interpolation between stops).
export function sequentialColor(t: number, ramp = SEQUENTIAL_RAMP): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const position = clamped * (ramp.length - 1);
  const index = Math.min(ramp.length - 2, Math.floor(position));
  const local = position - index;
  const a = hexToRgb(ramp[index]);
  const b = hexToRgb(ramp[index + 1]);
  return rgbToHex(a.map((c, i) => c + (b[i] - c) * local));
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Ink for a label drawn inside a coloured cell: dark navy on light fills, ivory on dark ones.
export function inkOn(hex: string): string {
  return relativeLuminance(hex) > 0.28 ? '#0b1422' : '#f5f1e9';
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
}

// Shared tooltip look: card surface, hairline border, value first.
export function tooltipBase(theme: ChartTheme) {
  return {
    backgroundColor: '#101c2d',
    borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: theme.textPrimary, fontFamily: theme.fontFamily, fontSize: 12 },
    extraCssText: 'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.35);',
    confine: true,
    // Tooltips live on <body>, so the chart boxes can clip their own content (overflow: hidden).
    appendTo: () => document.body,
  };
}

// One tooltip row: a short line key in the series colour, the value strong, the label muted.
export function tooltipRow(color: string, value: string, label: string, theme: ChartTheme): string {
  return `<div style="display:flex;align-items:center;gap:8px;line-height:1.7">`
    + `<span style="display:inline-block;width:12px;height:3px;border-radius:2px;background:${color}"></span>`
    + `<strong style="color:${theme.textPrimary};font-weight:700">${escapeHtml(value)}</strong>`
    + `<span style="color:${theme.textMuted}">${escapeHtml(label)}</span></div>`;
}

export function tooltipTitle(text: string, theme: ChartTheme): string {
  return `<div style="color:${theme.textSecondary};font-weight:600;margin-bottom:2px">${escapeHtml(text)}</div>`;
}
