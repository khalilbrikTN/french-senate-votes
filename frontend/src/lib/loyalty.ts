import type { Position, SenatorLoyalty } from '../types';

// Party loyalty (see backend/app/routers/loyalty.py): share of a senator's expressed votes
// that match their group's majority position on that vote.

export const LOYALTY_DEFINITION =
  'Sur chaque scrutin, la position majoritaire d’un groupe est la position (pour, contre ou abstention) '
  + 'exprimée par le plus grand nombre de ses membres ; en cas d’égalité, le groupe n’a pas de position. '
  + 'Un sénateur suit son groupe quand sa position exprimée est celle de la majorité du groupe auquel il '
  + 'appartenait le jour du vote ; sinon, il s’en écarte. Loyauté = votes alignés / (votes alignés + écarts). '
  + 'Les non-inscrits et les scrutins où le groupe compte moins de 3 positions exprimées sont exclus.';

export const LOYALTY_COVERAGE_NOTE =
  'Seuls les votes individuels des sénateurs en exercice sont chargés, et les sessions anciennes sont '
  + 'incomplètes (environ 80 % des votants pour 2023–2025, un peu plus de la moitié pour 2020–2022, '
  + 'beaucoup moins avant) : la majorité d’un groupe est calculée sur ses membres actuels présents dans la base.';

export function formatLoyalty(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

export function countedVotes(entry: Pick<SenatorLoyalty, 'follows' | 'rebels'>): number {
  return entry.follows + entry.rebels;
}

// Most independent first: lowest loyalty, then the larger sample, then by name.
export function rankByIndependence(
  senators: SenatorLoyalty[],
  { group = 'all', minVotes }: { group?: string; minVotes: number },
): SenatorLoyalty[] {
  return senators
    .filter(s => s.loyalty !== null && s.group !== 'NI' && countedVotes(s) >= minVotes
      && (group === 'all' || s.group === group))
    .sort((a, b) => (a.loyalty! - b.loyalty!) || (countedVotes(b) - countedVotes(a))
      || a.name.localeCompare(b.name, 'fr'));
}

// Mean loyalty of the senators of the given list (for a group filtered with another threshold).
export function averageLoyalty(senators: SenatorLoyalty[]): number | null {
  const values = senators.map(s => s.loyalty).filter((v): v is number => v !== null);
  if (!values.length) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length * 10) / 10;
}

const POSITION_LABELS: Record<Exclude<Position, 'non_votant'>, string> = {
  pour: 'Pour', contre: 'Contre', abstention: 'Abstention',
};

export function positionLabel(position: Exclude<Position, 'non_votant'>): string {
  return POSITION_LABELS[position];
}

// Tone of a loyalty value for colouring: below 90 % is notably independent in the Sénat,
// where most groups vote as one block.
export function loyaltyTone(value: number | null): 'high' | 'medium' | 'low' | 'none' {
  if (value === null) return 'none';
  if (value >= 97) return 'high';
  if (value >= 90) return 'medium';
  return 'low';
}
