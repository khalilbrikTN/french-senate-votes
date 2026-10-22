import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import MapView from '../MapView';
import {
  buildDepartmentIndex,
  dominantGroup,
  countGroups,
  leadingGroups,
  matchesDepartment,
  NON_POLYGON_TERRITORIES,
  normalizeDeptCode,
  OVERSEAS_FRAMES,
} from '../map/departments';
import GEOMETRY from '../map/geometry';
import type { Senator } from '../types';

// Sitting senators per constituency code, as /api/senateurs returned them on 20 Oct 2026 (348).
const SEATS = '01:3 02:3 03:2 04:1 05:1 06:5 07:2 08:2 09:1 10:2 11:2 12:2 13:8 14:3 15:2 16:2 17:3 18:2 19:2 '
  + '21:3 22:3 23:2 24:2 25:3 26:3 27:3 28:3 29:4 2A:1 2B:1 30:3 31:5 32:2 33:6 34:4 35:4 36:2 37:3 38:5 39:2 '
  + '40:2 41:2 42:4 43:2 44:5 45:3 46:2 47:2 48:1 49:4 50:3 51:3 52:2 53:2 54:4 55:2 56:3 57:5 58:2 59:11 60:4 '
  + '61:2 62:7 63:3 64:3 65:2 66:2 67:5 68:4 69:7 70:2 71:3 72:3 73:2 74:3 75:12 76:6 77:6 78:6 79:2 80:3 81:2 '
  + '82:2 83:4 84:3 85:3 86:2 87:2 88:2 89:2 90:1 91:5 92:7 93:6 94:6 95:5 971:3 972:2 973:2 974:4 975:1 976:2 '
  + '977:1 978:1 986:1 987:2 988:2 997:6 998:6';

function makeSenator(index: number, deptCode: string | null, group: string | null = 'LR', overrides: Partial<Senator> = {}): Senator {
  return {
    matricule: `S${index}`,
    name: `Prénom Nom${index}`,
    prenom: 'Prénom',
    nom: `Nom${String(index).padStart(3, '0')}`,
    slug: null,
    civilite: index % 2 ? 'Mme' : 'M.',
    status: 'ACTIF',
    group,
    groupFullName: null,
    lastGroupEndDate: null,
    serviceStart: null,
    serviceEnd: null,
    dept: deptCode ? `Département (${deptCode})` : null,
    deptCode,
    commission: null,
    avatar: null,
    url: null,
    profession: null,
    social: null,
    stats: null,
    ...overrides,
  };
}

function sittingSenate(): Senator[] {
  const senators: Senator[] = [];
  SEATS.split(' ').forEach(entry => {
    const [code, count] = entry.split(':');
    for (let i = 0; i < Number(count); i += 1) senators.push(makeSenator(senators.length, code));
  });
  return senators;
}

const allFeatures = Object.values(GEOMETRY.frames).flatMap(frame => frame.features);

describe('department geometry', () => {
  it('draws the 101 departments once each (Paris zoom aside), Corsica split into 2A and 2B', () => {
    const outside = Object.entries(GEOMETRY.frames).filter(([id]) => id !== 'paris').flatMap(([, f]) => f.features);
    const codes = outside.map(feature => feature.code);
    expect(new Set(codes).size).toBe(101);
    expect(codes).toHaveLength(101);
    expect(codes).toEqual(expect.arrayContaining(['2A', '2B', '01', '95']));
    expect(codes).not.toContain('20');
    expect(GEOMETRY.frames.paris.features.map(f => f.code).sort()).toEqual(['75', '92', '93', '94']);
  });

  it('has one frame per overseas department, containing only that department', () => {
    OVERSEAS_FRAMES.forEach(code => {
      expect(GEOMETRY.frames[code].features.map(f => f.code)).toEqual([code]);
    });
    expect(GEOMETRY.frames.metro.features.some(f => f.code.startsWith('97'))).toBe(false);
  });

  it('only contains plain path data', () => {
    allFeatures.forEach(feature => {
      expect(feature.d).toMatch(/^M[0-9MLZ .-]+Z$/);
      expect(feature.name.length).toBeGreaterThan(0);
    });
  });
});

describe('department codes', () => {
  it('normalises the codes published by the Senate', () => {
    expect(normalizeDeptCode('92')).toBe('92');
    expect(normalizeDeptCode(' 2a ')).toBe('2A');
    expect(normalizeDeptCode('1')).toBe('01');
    expect(normalizeDeptCode('971')).toBe('971');
    expect(normalizeDeptCode('Hauts-de-Seine (92)')).toBe('92');
    expect(normalizeDeptCode('Corse-du-Sud (2A)')).toBe('2A');
    expect(normalizeDeptCode('Français établis hors de France')).toBeNull();
    expect(normalizeDeptCode('')).toBeNull();
    expect(normalizeDeptCode(null)).toBeNull();
  });
});

describe('grouping senators by department', () => {
  it('places every sitting senator either on a drawn department or on a territory tile', () => {
    const senators = sittingSenate();
    expect(senators).toHaveLength(348);
    const index = buildDepartmentIndex(senators, GEOMETRY);
    const onMap = index.mapped.reduce((n, d) => n + d.senators.length, 0);
    const onTiles = index.unmapped.reduce((n, d) => n + d.senators.length, 0);
    expect(index.withoutDepartment).toHaveLength(0);
    expect(onMap + onTiles).toBe(348);
    expect(onTiles).toBe(20);
    expect(index.mapped).toHaveLength(101);
    expect(index.mapped.every(d => d.senators.length > 0)).toBe(true);
    expect(index.unmapped.map(d => d.code)).toEqual(['975', '977', '978', '986', '987', '988', '997', '998']);
    index.unmapped.forEach(d => expect(d.name).toBe(NON_POLYGON_TERRITORIES[d.code]));
  });

  it('maps Corsica and the overseas departments to their own outlines', () => {
    const index = buildDepartmentIndex(sittingSenate(), GEOMETRY);
    expect(index.byCode.get('2A')).toMatchObject({ hasPolygon: true, name: 'Corse-du-Sud' });
    expect(index.byCode.get('2B')).toMatchObject({ hasPolygon: true, name: 'Haute-Corse' });
    expect(index.byCode.get('971')).toMatchObject({ hasPolygon: true, name: 'Guadeloupe' });
    expect(index.byCode.get('974')?.senators).toHaveLength(4);
    expect(index.byCode.get('976')?.hasPolygon).toBe(true);
    expect(index.byCode.get('988')).toMatchObject({ hasPolygon: false, name: 'Nouvelle-Calédonie' });
  });

  it('keeps senators without a usable department apart, and an unknown code as a tile', () => {
    const index = buildDepartmentIndex([
      makeSenator(1, null),
      makeSenator(2, '999', 'UC', { dept: 'Territoire inconnu (999)' }),
    ], GEOMETRY);
    expect(index.withoutDepartment.map(s => s.matricule)).toEqual(['S1']);
    expect(index.byCode.get('999')).toMatchObject({ hasPolygon: false, name: 'Territoire inconnu' });
  });

  it('colours by the strictly largest group, with a tie giving no dominant group', () => {
    const paris = [
      ...Array.from({ length: 4 }, (_, i) => makeSenator(i, '75', 'LR')),
      ...Array.from({ length: 4 }, (_, i) => makeSenator(10 + i, '75', 'GEST')),
      ...Array.from({ length: 3 }, (_, i) => makeSenator(20 + i, '75', 'SER')),
      makeSenator(30, '75', 'CRCE-K'),
    ];
    const groups = countGroups(paris);
    expect(groups.map(g => [g.group, g.count])).toEqual([['GEST', 4], ['LR', 4], ['SER', 3], ['CRCE-K', 1]]);
    expect(dominantGroup(groups)).toBeNull();
    expect(leadingGroups(groups)).toEqual(['GEST', 'LR']);
    expect(dominantGroup(countGroups([...paris, makeSenator(40, '75', 'LR')]))).toBe('LR');
    expect(dominantGroup(countGroups([makeSenator(1, '2B', 'UC')]))).toBe('UC');
    expect(dominantGroup([])).toBeNull();
  });

  it('searches names without accents and by code', () => {
    const index = buildDepartmentIndex(sittingSenate(), GEOMETRY);
    const find = (q: string) => [...index.byCode.values()].filter(d => matchesDepartment(d, q)).map(d => d.code);
    expect(find('reunion')).toEqual(['974']);
    expect(find('2a')).toEqual(['2A']);
    expect(find('hors de france').sort()).toEqual(['997', '998']);
  });
});

describe('MapView', () => {
  it('fills a tied department with the neutral tie colour', () => {
    const senators = [makeSenator(1, '33', 'LR'), makeSenator(2, '33', 'SER'), makeSenator(3, '40', 'SER')];
    const { container } = render(<MapView senators={senators} stats={null} onOpenSenator={() => {}} />);
    expect(container.querySelector('.map-svg--metro path[data-code="33"]')!.getAttribute('fill')).toBe('var(--map-tie)');
    expect(container.querySelector('pattern')).toBeNull();
    expect(container.querySelector('.map-svg--metro path[data-code="40"]')!.getAttribute('fill')).toBe('#fb6f99');
    expect(container.querySelector('.map-svg--metro path[data-code="01"]')!.getAttribute('fill')).toBe('var(--map-empty)');
  });

  it('opens a department from the keyboard list, then a senator', async () => {
    const user = userEvent.setup();
    const onOpenSenator = vi.fn();
    const senators = [
      makeSenator(1, '2A', 'LR', { name: 'Ange Rossi', nom: 'Rossi' }),
      makeSenator(2, '2B', 'UC', { name: 'Paule Santoni', nom: 'Santoni' }),
      makeSenator(3, '998', 'SER', { name: 'Claire Monde', nom: 'Monde' }),
    ];
    render(<MapView senators={senators} stats={null} onOpenSenator={onOpenSenator} />);

    await user.type(screen.getByRole('searchbox', { name: 'Rechercher un département' }), 'corse');
    const list = screen.getByRole('heading', { name: 'Tous les territoires' }).closest('section')!;
    const buttons = within(list).getAllByRole('button');
    expect(buttons.map(b => b.textContent)).toEqual(['2ACorse-du-Sud1', '2BHaute-Corse1']);

    await user.click(buttons[1]);
    const panel = screen.getByRole('complementary');
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveProperty('textContent', 'Haute-Corse');
    await user.click(within(panel).getByRole('button', { name: 'Ouvrir la fiche de Paule Santoni' }));
    expect(onOpenSenator).toHaveBeenCalledWith(senators[1]);
  });

  it('selects a department by clicking its outline and lists territories without one', async () => {
    const user = userEvent.setup();
    const senators = [makeSenator(1, '92'), makeSenator(2, '988', 'RDPI', { name: 'Kanak Senator', nom: 'Kanak' })];
    const { container } = render(<MapView senators={senators} stats={null} onOpenSenator={() => {}} />);

    const outlines = container.querySelectorAll('path[data-code="92"]');
    expect(outlines).toHaveLength(2); // metropolitan map and Paris zoom
    expect(outlines[0].getAttribute('fill')).toBe('#6092dc'); // LR, offline colour
    await user.click(outlines[0]);
    expect(within(screen.getByRole('complementary')).getByRole('heading', { level: 2 }).textContent).toBe('Hauts-de-Seine');

    await user.click(screen.getAllByRole('button', { name: /Nouvelle-Calédonie/ })[0]); // territory tile
    expect(within(screen.getByRole('complementary')).getByText('Circonscription 988')).toBeTruthy();
  });
});
