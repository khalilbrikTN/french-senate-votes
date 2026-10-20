import type { Senator } from '../types';
import type { MapGeometry } from './types';

// Senate constituencies with no outline in the map data (collectivités d'outre-mer and the
// French living abroad): shown as tiles instead. Codes as published by the Senate.
export const NON_POLYGON_TERRITORIES: Record<string, string> = {
  '975': 'Saint-Pierre-et-Miquelon',
  '977': 'Saint-Barthélemy',
  '978': 'Saint-Martin',
  '986': 'Wallis-et-Futuna',
  '987': 'Polynésie française',
  '988': 'Nouvelle-Calédonie',
  '997': 'Français établis hors de France (série 2)',
  '998': 'Français établis hors de France (série 1)',
};

export const OVERSEAS_FRAMES = ['971', '972', '973', '974', '976'] as const;

export interface GroupCount {
  group: string; // app group code, '' when unknown
  count: number;
}

export interface DepartmentSummary {
  code: string;
  name: string;
  hasPolygon: boolean;
  senators: Senator[]; // sorted by name
  groups: GroupCount[]; // largest first, ties by code
  // Group(s) with the most seats: one entry, or several when they are tied.
  leaders: string[];
  // Group holding strictly more seats than any other; null when the top groups are tied.
  dominant: string | null;
}

export interface DepartmentIndex {
  byCode: Map<string, DepartmentSummary>;
  mapped: DepartmentSummary[]; // drawn on the map, by code
  unmapped: DepartmentSummary[]; // tiles, by code
  withoutDepartment: Senator[]; // no usable department code at all
}

// "2a" → "2A", "1" → "01", "Hauts-de-Seine (92)" → "92"; null if nothing recognisable.
export function normalizeDeptCode(value: string | null | undefined): string | null {
  if (!value) return null;
  let code = value.trim().toUpperCase();
  const inParens = code.match(/\(([0-9]{1,3}|2[AB])\)\s*$/);
  if (inParens) code = inParens[1];
  if (/^[0-9]$/.test(code)) code = `0${code}`;
  return /^([0-9]{2,3}|2[AB])$/.test(code) ? code : null;
}

export function senatorDeptCode(senator: Senator): string | null {
  return normalizeDeptCode(senator.deptCode) ?? normalizeDeptCode(senator.dept);
}

// "Hauts-de-Seine (92)" → "Hauts-de-Seine"
function deptNameFromLabel(label: string | null): string | null {
  const name = label?.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return name || null;
}

export function polygonNames(geometry: MapGeometry): Map<string, string> {
  const names = new Map<string, string>();
  for (const frame of Object.values(geometry.frames)) {
    for (const feature of frame.features) names.set(feature.code, feature.name);
  }
  return names;
}

export function countGroups(senators: Senator[]): GroupCount[] {
  const counts = new Map<string, number>();
  senators.forEach(senator => {
    const group = senator.group ?? '';
    counts.set(group, (counts.get(group) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group));
}

export function leadingGroups(groups: GroupCount[]): string[] {
  if (!groups.length) return [];
  return groups.filter(g => g.count === groups[0].count).map(g => g.group);
}

export function dominantGroup(groups: GroupCount[]): string | null {
  if (!groups.length) return null;
  if (groups.length > 1 && groups[1].count === groups[0].count) return null;
  return groups[0].group || null;
}

const byName = (a: Senator, b: Senator) =>
  (a.nom || a.name).localeCompare(b.nom || b.name, 'fr') || a.name.localeCompare(b.name, 'fr');

export function buildDepartmentIndex(senators: Senator[], geometry: MapGeometry): DepartmentIndex {
  const names = polygonNames(geometry);
  const buckets = new Map<string, Senator[]>();
  const withoutDepartment: Senator[] = [];
  senators.forEach(senator => {
    const code = senatorDeptCode(senator);
    if (!code) {
      withoutDepartment.push(senator);
      return;
    }
    const list = buckets.get(code);
    if (list) list.push(senator); else buckets.set(code, [senator]);
  });

  const byCode = new Map<string, DepartmentSummary>();
  // Every drawn department is listed, even one with no sitting senator (e.g. a vacancy).
  const codes = new Set([...names.keys(), ...buckets.keys()]);
  codes.forEach(code => {
    const list = (buckets.get(code) ?? []).slice().sort(byName);
    const groups = countGroups(list);
    const hasPolygon = names.has(code);
    const name = names.get(code)
      ?? NON_POLYGON_TERRITORIES[code]
      ?? deptNameFromLabel(list[0]?.dept ?? null)
      ?? code;
    byCode.set(code, { code, name, hasPolygon, senators: list, groups, leaders: leadingGroups(groups), dominant: dominantGroup(groups) });
  });

  const sortByCode = (a: DepartmentSummary, b: DepartmentSummary) =>
    a.code.localeCompare(b.code, 'fr', { numeric: true });
  const all = [...byCode.values()].sort(sortByCode);
  return {
    byCode,
    mapped: all.filter(d => d.hasPolygon),
    unmapped: all.filter(d => !d.hasPolygon),
    withoutDepartment: withoutDepartment.sort(byName),
  };
}

// Accent- and case-insensitive match on name or code, for the searchable list.
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function matchesDepartment(department: DepartmentSummary, query: string): boolean {
  const q = foldText(query.trim());
  if (!q) return true;
  return foldText(department.name).includes(q) || department.code.toLowerCase() === q
    || department.code.toLowerCase().startsWith(q);
}
