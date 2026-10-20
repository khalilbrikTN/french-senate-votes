import type { ReactNode } from 'react';
import type { ChartTheme } from '../lib/chartTheme';

export function ChartCard({ title, aside, children, caption, wide, id }: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  caption?: ReactNode;
  wide?: boolean;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`stats-chart-card stats-viz-card${wide ? ' stats-viz-card--wide' : ''}`} aria-labelledby={headingId}>
      <div className="stats-chart-title">
        <h2 className="stats-viz-heading" id={headingId}>{title}</h2>
        {aside && <span className="stats-viz-aside">{aside}</span>}
      </div>
      {children}
      {caption && <p className="stats-viz-caption">{caption}</p>}
    </section>
  );
}

export function LegendItem({ color, label, value, shape = 'rect' }: {
  color: string;
  label: string;
  value?: ReactNode;
  shape?: 'rect' | 'line' | 'dot';
}) {
  return (
    <li className="stats-legend-item">
      <span className={`stats-legend-key stats-legend-key--${shape}`} style={{ background: color }} aria-hidden="true" />
      <span className="stats-legend-label">{label}</span>
      {value !== undefined && <span className="stats-legend-value">{value}</span>}
    </li>
  );
}

export function ChartEmpty({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warning' }) {
  return <div className={`stats-empty stats-empty--${tone}`} role="status">{children}</div>;
}

export function GradientLegend({ from, to, ramp, label }: { from: string; to: string; ramp: string[]; label: string }) {
  return (
    <div className="stats-gradient-legend">
      <span className="stats-gradient-label">{label}</span>
      <span className="stats-gradient-end">{from}</span>
      <span className="stats-gradient-bar" style={{ background: `linear-gradient(90deg, ${ramp.join(', ')})` }} aria-hidden="true" />
      <span className="stats-gradient-end">{to}</span>
    </div>
  );
}

export const nf = (n: number, digits = 0) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function axisStyle(theme: ChartTheme) {
  return {
    axisLine: { show: true, lineStyle: { color: theme.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: theme.textMuted, fontSize: 11, fontFamily: theme.fontFamily, hideOverlap: true },
    splitLine: { show: false },
  };
}

export function valueAxisStyle(theme: ChartTheme) {
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: theme.textMuted, fontSize: 11, fontFamily: theme.fontFamily },
    splitLine: { show: true, lineStyle: { color: theme.grid, width: 1, type: 'solid' as const } },
  };
}

// Session "2025" → "25-26" for crowded axes.
export function shortSession(session: string): string {
  const y = parseInt(session);
  return Number.isFinite(y) ? `${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}` : session;
}
