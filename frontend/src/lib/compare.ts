import type { ExpressedPosition, Senator, SenatorComparison } from '../types';

// Lower-case, accent-free form used to match names typed without accents.
export function foldText(value: string | null | undefined): string {
  return (value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('fr-FR').trim();
}

// Sitting senators other than `excludeId` matching the query on name, department or group.
// Names that start with the query (first or last name) come first.
export function compareCandidates(senators: Senator[], query: string, excludeId: string, max = 8): Senator[] {
  const q = foldText(query);
  if (!q) return [];
  const scored: { senator: Senator; rank: number }[] = [];
  for (const senator of senators) {
    if (senator.matricule === excludeId || senator.status !== 'ACTIF') continue;
    const name = foldText(senator.name);
    const words = [foldText(senator.prenom), foldText(senator.nom), ...name.split(/[\s-]+/)];
    let rank: number;
    if (words.some(word => word.startsWith(q)) || name.startsWith(q)) rank = 0;
    else if (name.includes(q)) rank = 1;
    else if ([senator.dept, senator.group, senator.deptCode].some(value => foldText(value).includes(q))) rank = 2;
    else continue;
    scored.push({ senator, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.senator.nom.localeCompare(b.senator.nom, 'fr') || a.senator.name.localeCompare(b.senator.name, 'fr'))
    .slice(0, max)
    .map(item => item.senator);
}

export function formatAgreement(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

export interface BreakdownSegment {
  key: keyof SenatorComparison['breakdown'];
  label: string;
  value: number;
  share: number; // 0..1 of the shared votes
  agree: boolean;
}

const BREAKDOWN_LABELS: [BreakdownSegment['key'], string, boolean][] = [
  ['bothPour', 'Tous deux pour', true],
  ['bothContre', 'Tous deux contre', true],
  ['bothAbstention', 'Tous deux abstention', true],
  ['opposite', 'Positions opposées', false],
  ['oneAbstained', 'Un seul s’est abstenu', false],
];

export function breakdownSegments(comparison: SenatorComparison): BreakdownSegment[] {
  const total = comparison.shared;
  return BREAKDOWN_LABELS.map(([key, label, agree]) => ({
    key, label, agree, value: comparison.breakdown[key], share: total > 0 ? comparison.breakdown[key] / total : 0,
  }));
}

export function positionLabel(position: ExpressedPosition): string {
  switch (position) {
    case 'pour': return 'Pour';
    case 'contre': return 'Contre';
    case 'abstention': return 'Abstention';
  }
}
