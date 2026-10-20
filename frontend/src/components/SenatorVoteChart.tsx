import { recordedNonVoterCount } from '../lib/senators';
import type { SenatorStats } from '../types';

interface SenatorVoteChartProps {
  stats: SenatorStats;
}

const POSITION_COLORS = {
  pour: 'var(--color-green)',
  contre: 'var(--color-red)',
  abstention: 'var(--color-gold)',
  nonVotant: 'var(--color-blue-light)',
} as const;

export default function SenatorVoteChart({ stats }: SenatorVoteChartProps) {
  const nonVotant = recordedNonVoterCount(stats);
  const positions = [
    { key: 'pour', label: 'Pour', value: stats.pour, color: POSITION_COLORS.pour },
    { key: 'contre', label: 'Contre', value: stats.contre, color: POSITION_COLORS.contre },
    { key: 'abstention', label: 'Abstentions', value: stats.abstention, color: POSITION_COLORS.abstention },
    ...(nonVotant === null ? [] : [{ key: 'non-votant', label: 'Non-votants enregistrés', value: nonVotant, color: POSITION_COLORS.nonVotant }]),
  ];
  const total = positions.reduce((sum, position) => sum + Math.max(0, position.value), 0);

  if (total === 0) {
    return (
      <figure className="senator-vote-chart">
        <figcaption>Répartition des positions</figcaption>
        <p className="senator-vote-chart-empty">Aucune position de vote enregistrée</p>
      </figure>
    );
  }

  let cumulative = 0;
  const sectors = positions.map(position => {
    const start = cumulative / total * 100;
    cumulative += Math.max(0, position.value);
    const end = cumulative / total * 100;
    const share = Math.max(0, position.value) / total * 100;
    const midpoint = (start + end) / 2 * 3.6 - 90;
    const angle = midpoint * Math.PI / 180;
    return {
      ...position,
      share,
      left: 50 + Math.cos(angle) * 30,
      top: 50 + Math.sin(angle) * 30,
      angle,
      start,
      end,
    };
  });
  const callouts = sectors.filter(sector => sector.share > 0 && sector.share < 10);
  const calloutPositions = new Map<string, { side: 'left' | 'right'; y: number }>();
  (['left', 'right'] as const).forEach(side => {
    const sideCallouts = callouts
      .filter(sector => (Math.cos(sector.angle) < 0 ? 'left' : 'right') === side)
      .map(sector => ({ sector, anchorY: Math.max(12, Math.min(168, 90 + Math.sin(sector.angle) * 82)) }))
      .sort((a, b) => a.anchorY - b.anchorY);
    const placed = sideCallouts.map(item => item.anchorY);
    for (let index = 1; index < placed.length; index += 1) {
      placed[index] = Math.max(placed[index], placed[index - 1] + 22);
    }
    if (placed.length && placed[placed.length - 1] > 168) {
      placed[placed.length - 1] = 168;
      for (let index = placed.length - 2; index >= 0; index -= 1) {
        placed[index] = Math.min(placed[index], placed[index + 1] - 22);
      }
    }
    sideCallouts.forEach(({ sector }, index) => {
      calloutPositions.set(sector.key, { side, y: Math.max(12, placed[index]) });
    });
  });
  const gradientStops = sectors.map(sector => `${sector.color} ${sector.start}% ${sector.end}%`);
  const distributionLabel = positions.map(position => {
    const percentage = (Math.max(0, position.value) / total * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    return `${position.label} : ${position.value.toLocaleString('fr-FR')} (${percentage} %)`;
  }).join(', ');

  return (
    <figure className="senator-vote-chart">
      <figcaption>Répartition des positions</figcaption>
      <div className="senator-vote-chart-content">
        <div className="senator-vote-chart-stage">
          <svg className="senator-vote-chart-callout-lines" viewBox="0 0 320 180" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              {callouts.map(sector => (
                <marker
                  id={`senator-vote-arrow-${sector.key}`}
                  key={sector.key}
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M0 0L6 3L0 6Z" fill={sector.color} />
                </marker>
              ))}
            </defs>
            {callouts.map(sector => {
              const position = calloutPositions.get(sector.key)!;
              const anchorX = 160 + Math.cos(sector.angle) * 82;
              const anchorY = 90 + Math.sin(sector.angle) * 82;
              const lineStartX = position.side === 'left' ? 53 : 267;
              const elbowX = position.side === 'left' ? 61 : 259;
              return (
                <path
                  key={sector.key}
                  d={`M ${lineStartX} ${position.y} L ${elbowX} ${position.y} L ${anchorX} ${anchorY}`}
                  fill="none"
                  stroke={sector.color}
                  strokeWidth="1.5"
                  markerEnd={`url(#senator-vote-arrow-${sector.key})`}
                />
              );
            })}
          </svg>
          <div
            className="senator-vote-pie"
            role="img"
            aria-label={distributionLabel}
            style={{ background: `conic-gradient(${gradientStops.join(', ')})` }}
          >
            {sectors.filter(sector => sector.share >= 10).map(sector => (
              <span
                className="senator-vote-pie-label"
                key={sector.key}
                style={{ left: `${sector.left}%`, top: `${sector.top}%` }}
                aria-hidden="true"
              >
                {sector.share.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%
              </span>
            ))}
          </div>
          {callouts.map(sector => {
            const position = calloutPositions.get(sector.key)!;
            return (
              <span
                className={`senator-vote-pie-callout senator-vote-pie-callout-${position.side}`}
                key={sector.key}
                style={{ top: `${(position.y / 180) * 100}%`, color: sector.color }}
                aria-hidden="true"
              >
                {sector.share.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%
              </span>
            );
          })}
        </div>
      </div>
    </figure>
  );
}
