import {
  memo, useCallback, useMemo, useRef, useState,
  type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject,
} from 'react';
import PoliticalGroupBadge from './components/PoliticalGroupBadge';
import { POLITICAL_GROUPS } from './data/politicalGroups';
import { getInitials } from './lib/format';
import { getGroupColor, getGroupName } from './lib/groups';
import { preferredScrollBehavior } from './lib/motion';
import { senatorTitle } from './lib/senators';
import {
  buildDepartmentIndex,
  matchesDepartment,
  OVERSEAS_FRAMES,
  type DepartmentSummary,
} from './map/departments';
import GEOMETRY from './map/geometry';
import type { MapFrame } from './map/types';
import type { Senator, Stats } from './types';
import './map.css';

interface MapViewProps {
  senators: Senator[];
  stats: Stats | null;
  onOpenSenator: (senator: Senator) => void;
}

const shortName = (code: string) => (code && POLITICAL_GROUPS[code]?.short) || code || 'Sans groupe';
const plural = (n: number, word: string) => `${n.toLocaleString('fr-FR')} ${word}${n > 1 ? 's' : ''}`;

// Colour of a department: its dominant group; a neutral fill (--map-tie) when several groups have
// the same number of senators (the tooltip and panel give the detail); nothing when it has no
// sitting senator. Returned as a key: '' (none), 'LR' (one group) or 'LR|SER' (tie).
function fillKey(department: DepartmentSummary | undefined): string {
  if (!department || department.senators.length === 0) return '';
  return department.leaders.join('|');
}
const isTie = (key: string) => key.includes('|');

function fillColor(key: string, stats: Stats | null): string {
  if (!key) return 'var(--map-empty)';
  return isTie(key) ? 'var(--map-tie)' : getGroupColor(key, stats);
}

export default function MapView({ senators, stats, onOpenSenator }: MapViewProps) {
  const index = useMemo(() => buildDepartmentIndex(senators, GEOMETRY), [senators]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const hoveredRef = useRef<string | null>(null);

  const fillFor = useCallback(
    (code: string) => fillColor(fillKey(index.byCode.get(code)), stats),
    [index, stats],
  );

  // Legend: every group colouring at least one territory, largest first, then the ties.
  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    let tied = 0;
    index.byCode.forEach(department => {
      const key = fillKey(department);
      if (isTie(key)) tied += 1;
      else if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { groups, tied };
  }, [index]);

  const selected = selectedCode ? index.byCode.get(selectedCode) ?? null : null;
  const hovered = hoveredCode ? index.byCode.get(hoveredCode) ?? null : null;

  // Stable hover: the hovered department changes only when the pointer reaches another one, and
  // is cleared only when it leaves a drawing; the tooltip follows the pointer without re-rendering.
  const positionTooltip = useCallback((event: ReactPointerEvent) => {
    const stage = stageRef.current;
    const tip = tooltipRef.current;
    if (!stage || !tip) return;
    const box = stage.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const flip = x > box.width - 230;
    tip.style.transform = `translate(${flip ? x - 14 - tip.offsetWidth : x + 14}px, ${Math.max(0, y - tip.offsetHeight - 12)}px)`;
  }, []);

  const handlePointerOver = useCallback((event: ReactPointerEvent) => {
    if (event.pointerType === 'touch') return;
    const code = (event.target as Element).closest('[data-code]')?.getAttribute('data-code') ?? null;
    if (code && code !== hoveredRef.current) {
      hoveredRef.current = code;
      setHoveredCode(code);
    }
    positionTooltip(event);
  }, [positionTooltip]);

  const handlePointerMove = useCallback((event: ReactPointerEvent) => {
    if (event.pointerType === 'touch' || !hoveredRef.current) return;
    positionTooltip(event);
  }, [positionTooltip]);

  const handlePointerLeave = useCallback(() => {
    hoveredRef.current = null;
    setHoveredCode(null);
  }, []);

  const select = useCallback((code: string, moveFocus: boolean) => {
    setSelectedCode(code);
    // On narrow screens the panel sits below the map: bring it into view.
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const box = panel.getBoundingClientRect();
      if (box.top > window.innerHeight - 80 || box.bottom < 0) {
        panel.scrollIntoView({ block: 'start', behavior: preferredScrollBehavior() });
      }
      if (moveFocus) panelHeadingRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const handleMapClick = useCallback((event: ReactMouseEvent) => {
    const code = (event.target as Element).closest('[data-code]')?.getAttribute('data-code');
    if (code) select(code, false);
  }, [select]);

  const frameProps = {
    fillFor,
    selectedCode,
    hoveredCode,
    onPointerOver: handlePointerOver,
    onPointerMove: handlePointerMove,
    onPointerLeave: handlePointerLeave,
    onClick: handleMapClick,
  };

  const listed = useMemo(
    () => [...index.mapped, ...index.unmapped].filter(department => matchesDepartment(department, query)),
    [index, query],
  );
  const total = senators.length;
  const placedOnMap = index.mapped.reduce((n, d) => n + d.senators.length, 0);
  const onTiles = index.unmapped.reduce((n, d) => n + d.senators.length, 0);

  return (
    <main className="main-content view-panel" id="view-carte">
      <div className="container">
        <div className="map-intro">
          <p className="section-eyebrow">Sénateurs en exercice</p>
          <h1 className="map-title">Carte des départements</h1>
          <p className="map-lead">
            Chaque département prend la couleur du groupe politique qui y compte le plus de sénateurs.
            Survolez un territoire pour voir la répartition, cliquez pour afficher ses sénateurs.
          </p>
        </div>

        <div className="map-layout">
          <section className="map-card" aria-labelledby="map-card-title">
            <h2 className="sr-only" id="map-card-title">Carte</h2>
            <div className="map-stage" ref={stageRef}>
              <MapFrameSvg
                frame={GEOMETRY.frames.metro}
                className="map-svg map-svg--metro"
                label={`Carte de France métropolitaine : ${index.mapped.length} territoires dessinés. La liste des départements sous la carte donne le même accès au clavier.`}
                {...frameProps}
              />

              <ul className="map-insets" aria-label="Zooms et départements d’outre-mer">
                <li className="map-inset map-inset--paris">
                  <MapFrameSvg frame={GEOMETRY.frames.paris} className="map-svg" label="Zoom sur Paris et la petite couronne" {...frameProps} />
                  <span className="map-inset-label">Paris et petite couronne</span>
                </li>
                {OVERSEAS_FRAMES.map(code => (
                  <li className="map-inset" key={code}>
                    <MapFrameSvg frame={GEOMETRY.frames[code]} className="map-svg" label={index.byCode.get(code)?.name ?? code} {...frameProps} />
                    <span className="map-inset-label">{index.byCode.get(code)?.name ?? code}</span>
                  </li>
                ))}
              </ul>

              <div
                ref={tooltipRef}
                className={`map-tooltip${hovered ? ' is-visible' : ''}`}
                aria-hidden="true"
              >
                {hovered && <DepartmentTooltip department={hovered} stats={stats} />}
              </div>
            </div>

            {index.unmapped.length > 0 && (
              <div className="map-territories">
                <h3 className="map-subheading">Collectivités d’outre-mer et Français de l’étranger</h3>
                <ul className="map-territory-list">
                  {index.unmapped.map(department => (
                    <li key={department.code}>
                      <button
                        type="button"
                        className={`map-territory${selectedCode === department.code ? ' is-selected' : ''}`}
                        aria-pressed={selectedCode === department.code}
                        onClick={() => select(department.code, true)}
                      >
                        <GroupSwatch department={department} stats={stats} />
                        <span className="map-territory-name">{department.name}</span>
                        <span className="map-territory-count">{department.senators.length}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ul className="map-legend" aria-label="Légende : groupe majoritaire du département">
              {legend.groups.map(([group, count]) => (
                <li key={group} title={getGroupName(group)}>
                  <span className="map-legend-key" style={{ background: getGroupColor(group, stats) }} aria-hidden="true" />
                  <span className="map-legend-label">{shortName(group)}</span>
                  <span className="map-legend-value">{count}</span>
                </li>
              ))}
              {legend.tied > 0 && (
                <li title="Plusieurs groupes à égalité : survolez ou cliquez le territoire pour voir lesquels">
                  <span className="map-legend-key map-swatch--tie" aria-hidden="true" />
                  <span className="map-legend-label">Égalité</span>
                  <span className="map-legend-value">{legend.tied}</span>
                </li>
              )}
            </ul>
            <p className="map-caption">
              Couleur : groupe ayant le plus de sénateurs en exercice dans le territoire (gris : plusieurs groupes à égalité) ;
              le nombre indique les territoires concernés. {plural(total, 'sénateur')} : {placedOnMap} sur la carte, {onTiles} dans
              les collectivités et pour les Français de l’étranger{index.withoutDepartment.length ? `, ${index.withoutDepartment.length} sans circonscription connue` : ''}.
              Données : <a href="https://data.senat.fr" target="_blank" rel="noopener noreferrer">data.senat.fr</a>.
              Tracés : <a href="https://github.com/gregoiredavid/france-geojson" target="_blank" rel="noopener noreferrer">france-geojson</a> (IGN Admin Express, INSEE),
              {' '}<a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence/" target="_blank" rel="noopener noreferrer">Licence Ouverte Etalab</a>, simplifiés.
            </p>
          </section>

          <aside className="map-panel" ref={panelRef} aria-labelledby="map-panel-title">
            {selected ? (
              <DepartmentPanel
                department={selected}
                stats={stats}
                headingRef={panelHeadingRef}
                onOpenSenator={onOpenSenator}
                onClose={() => setSelectedCode(null)}
              />
            ) : (
              <div className="map-panel-empty">
                <h2 className="map-panel-title" id="map-panel-title" ref={panelHeadingRef} tabIndex={-1}>Aucun territoire sélectionné</h2>
                <p>Cliquez sur un département de la carte, une collectivité ou un élément de la liste ci-dessous pour afficher ses sénateurs.</p>
              </div>
            )}
          </aside>
        </div>

        <section className="map-list-section" aria-labelledby="map-list-title">
          <div className="map-list-header">
            <h2 className="map-subheading" id="map-list-title">Tous les territoires</h2>
            <label className="map-search">
              <span className="sr-only">Rechercher un département</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input
                type="search"
                value={query}
                placeholder="Nom ou numéro de département…"
                onChange={event => setQuery(event.target.value)}
              />
            </label>
          </div>
          <p className="sr-only" aria-live="polite">{plural(listed.length, 'territoire')}</p>
          {listed.length ? (
            <ul className="map-dept-list">
              {listed.map(department => (
                <li key={department.code}>
                  <button
                    type="button"
                    className={`map-dept${selectedCode === department.code ? ' is-selected' : ''}`}
                    aria-pressed={selectedCode === department.code}
                    onClick={() => select(department.code, true)}
                  >
                    <GroupSwatch department={department} stats={stats} />
                    <span className="map-dept-code">{department.code}</span>
                    <span className="map-dept-name">{department.name}</span>
                    <span className="map-dept-count" aria-label={plural(department.senators.length, 'sénateur')}>{department.senators.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="map-list-empty" role="status">Aucun territoire ne correspond à « {query} ».</p>
          )}
        </section>
      </div>
    </main>
  );
}

interface FrameProps {
  frame: MapFrame;
  className: string;
  label: string;
  fillFor: (code: string) => string;
  selectedCode: string | null;
  hoveredCode: string | null;
  onPointerOver: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerLeave: () => void;
  onClick: (event: ReactMouseEvent) => void;
}

// The base shapes only change with the colours; hover and selection are drawn as overlays on top,
// so moving the pointer re-renders two paths, not a hundred.
const FrameShapes = memo(function FrameShapes({ frame, fillFor }: {
  frame: MapFrame;
  fillFor: (code: string) => string;
}) {
  return (
    <g className="map-shapes">
      {frame.features.map(feature => (
        <path key={feature.code} d={feature.d} data-code={feature.code} fill={fillFor(feature.code)} />
      ))}
    </g>
  );
});

function MapFrameSvg({
  frame, className, label, fillFor, selectedCode, hoveredCode,
  onPointerOver, onPointerMove, onPointerLeave, onClick,
}: FrameProps) {
  const selected = frame.features.find(feature => feature.code === selectedCode);
  const hovered = hoveredCode !== selectedCode ? frame.features.find(feature => feature.code === hoveredCode) : undefined;
  return (
    <svg
      className={className}
      viewBox={frame.viewBox}
      role="img"
      aria-label={label}
      onPointerOver={onPointerOver}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={onClick}
    >
      <FrameShapes frame={frame} fillFor={fillFor} />
      {hovered && <path className="map-outline map-outline--hover" d={hovered.d} />}
      {selected && <path className="map-outline map-outline--selected" d={selected.d} />}
    </svg>
  );
}

function GroupSwatch({ department, stats }: { department: DepartmentSummary; stats: Stats | null }) {
  return <span className="map-swatch" style={{ background: fillColor(fillKey(department), stats) }} aria-hidden="true" />;
}

function GroupBreakdown({ department, stats }: { department: DepartmentSummary; stats: Stats | null }) {
  return (
    <ul className="map-breakdown">
      {department.groups.map(({ group, count }) => (
        <li key={group || 'none'}>
          <span className="map-legend-key" style={{ background: getGroupColor(group, stats) }} aria-hidden="true" />
          <span className="map-breakdown-name">{shortName(group)}</span>
          <span className="map-breakdown-count">{count}</span>
        </li>
      ))}
    </ul>
  );
}

function statusLine(department: DepartmentSummary): string {
  const n = department.senators.length;
  if (n === 0) return 'Aucun sénateur en exercice';
  if (department.dominant === null) return `${plural(n, 'sénateur')} · égalité ${department.leaders.map(shortName).join(' / ')}`;
  if (n === 1) return `1 sénateur · ${shortName(department.dominant)}`;
  return `${plural(n, 'sénateur')} · en tête : ${shortName(department.dominant)}`;
}

function DepartmentTooltip({ department, stats }: { department: DepartmentSummary; stats: Stats | null }) {
  return (
    <>
      <div className="map-tooltip-title">{department.name} <span>({department.code})</span></div>
      <div className="map-tooltip-meta">{statusLine(department)}</div>
      {department.senators.length > 0 && <GroupBreakdown department={department} stats={stats} />}
    </>
  );
}

function DepartmentPanel({ department, stats, headingRef, onOpenSenator, onClose }: {
  department: DepartmentSummary;
  stats: Stats | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onOpenSenator: (senator: Senator) => void;
  onClose: () => void;
}) {
  const n = department.senators.length;
  return (
    <div className="map-panel-body">
      <div className="map-panel-head">
        <div>
          <p className="map-panel-code">{department.hasPolygon ? `Département ${department.code}` : `Circonscription ${department.code}`}</p>
          <h2 className="map-panel-title" id="map-panel-title" ref={headingRef} tabIndex={-1}>{department.name}</h2>
          <p className="map-panel-meta">{statusLine(department)}</p>
        </div>
        <button type="button" className="map-panel-close" aria-label="Fermer le détail du territoire" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {n > 0 && (
        <div className="map-share-bar" aria-hidden="true">
          {department.groups.map(({ group, count }) => (
            <span key={group || 'none'} style={{ flexGrow: count, background: getGroupColor(group, stats) }} />
          ))}
        </div>
      )}
      {n > 0 && <GroupBreakdown department={department} stats={stats} />}

      {n > 0 ? (
        <ul className="map-senators" aria-label={`Sénateurs de ${department.name}`}>
          {department.senators.map(senator => (
            <li key={senator.matricule}>
              <SenatorRow senator={senator} stats={stats} onOpen={onOpenSenator} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="map-panel-note">Aucun sénateur en exercice n’est rattaché à ce territoire dans les données.</p>
      )}
    </div>
  );
}

function SenatorRow({ senator, stats, onOpen }: { senator: Senator; stats: Stats | null; onOpen: (senator: Senator) => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const color = getGroupColor(senator.group, stats);
  return (
    <button type="button" className="map-senator" onClick={() => onOpen(senator)} aria-label={`Ouvrir la fiche de ${senator.name}`}>
      <span className="map-senator-avatar" style={{ borderColor: `${color}66` }} aria-hidden="true">
        {senator.avatar && !imageFailed
          ? <img src={senator.avatar} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} />
          : <span style={{ color }}>{getInitials(senator.name)}</span>}
      </span>
      <span className="map-senator-meta">
        <span className="map-senator-name">{senator.name}</span>
        <span className="map-senator-role">{senatorTitle(senator)}</span>
        <PoliticalGroupBadge
          className="map-senator-badge"
          label={shortName(senator.group ?? '')}
          color={color}
          backgroundColor={`${color}18`}
          borderColor={`${color}33`}
          dotSize={6}
        />
      </span>
      <svg className="map-senator-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
    </button>
  );
}
