import { useEffect, useMemo, useState } from 'react';
import { api } from './api/endpoints';
import { POLITICAL_GROUPS } from './data/politicalGroups';
import type { Senator, SenatorStatusFilter, Stats } from './types';
import EmptyState from './components/EmptyState';
import FilterDropdown from './components/FilterDropdown';
import SenatorCard from './components/SenatorCard';
import SectionHeader from './components/SectionHeader';

interface SenatorsViewProps {
  senators: Senator[];
  stats: Stats | null;
  groupFilter: string;
  onGroupFilterChange: (group: string) => void;
  statusFilter: SenatorStatusFilter;
  onStatusFilterChange: (status: SenatorStatusFilter) => void;
  onOpenSenator: (senator: Senator) => void;
  onOpenPhoto: (src: string, name: string) => void;
}

type SortMode = 'nom-asc' | 'nom-desc' | 'group' | 'votes-asc' | 'votes-desc';
type FormerLoadState = 'idle' | 'loading' | 'ready' | 'error';

function departmentKey(senator: Senator): string {
  return senator.deptCode?.trim() || senator.dept?.trim() || '';
}

function normalizedValue(value: string | null): string {
  return value?.trim() || '';
}

export default function SenatorsView({
  senators,
  stats,
  groupFilter,
  onGroupFilterChange,
  statusFilter,
  onStatusFilterChange,
  onOpenSenator,
  onOpenPhoto,
}: SenatorsViewProps) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('nom-asc');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [commissionFilter, setCommissionFilter] = useState('all');
  const [professionFilter, setProfessionFilter] = useState('all');
  const [formerSenators, setFormerSenators] = useState<Senator[] | null>(null);
  const [formerLoadState, setFormerLoadState] = useState<FormerLoadState>('idle');
  const [retryFormer, setRetryFormer] = useState(0);

  useEffect(() => {
    if (statusFilter === 'ACTIF' || formerSenators !== null) return;
    const controller = new AbortController();
    setFormerLoadState('loading');

    api.senatorsByStatus('ANCIEN', controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        setFormerSenators(data);
        setFormerLoadState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setFormerLoadState('error');
      });

    return () => controller.abort();
  }, [statusFilter, formerSenators, retryFormer]);

  const data = useMemo(() => {
    if (statusFilter === 'ACTIF') return senators;
    if (formerSenators === null) return [];
    if (statusFilter === 'ANCIEN') return formerSenators;
    return [...senators, ...formerSenators];
  }, [senators, formerSenators, statusFilter]);

  const departments = useMemo(() => {
    const labels = new Map<string, string>();
    data.forEach(senator => {
      const key = departmentKey(senator);
      if (!key) return;
      const name = normalizedValue(senator.dept) || key;
      const code = normalizedValue(senator.deptCode);
      labels.set(key, code && !name.includes(code) ? `${name} (${code})` : name);
    });
    return [...labels.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  }, [data]);

  const commissions = useMemo(() => [...new Set(
    data.map(senator => normalizedValue(senator.commission)).filter(Boolean),
  )].sort((a, b) => a.localeCompare(b, 'fr')), [data]);

  // Professions are free text as published by the Senate; list them most common first.
  const professions = useMemo(() => {
    const counts = new Map<string, number>();
    data.forEach(senator => {
      const profession = normalizedValue(senator.profession);
      if (profession) counts.set(profession, (counts.get(profession) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));
  }, [data]);

  const statusOptions = [
    { value: 'ACTIF', label: 'En exercice', hint: 'Sénateurs en fonction' },
    { value: 'ANCIEN', label: 'Anciens', hint: 'Anciens membres du Sénat' },
    { value: 'all', label: 'Tous', hint: 'En exercice et anciens' },
  ];
  const groupOptions = [
    { value: 'all', label: 'Tous les groupes', hint: 'Sans restriction de groupe' },
    ...Object.entries(POLITICAL_GROUPS).map(([code, group]) => ({
      value: code,
      label: group.name,
      hint: group.orientation,
      badge: code,
    })),
  ];
  const departmentOptions = [
    { value: 'all', label: 'Tous les départements' },
    ...departments.map(department => ({ ...department })),
  ];
  const commissionOptions = [
    { value: 'all', label: 'Toutes les commissions' },
    ...commissions.map(commission => ({ value: commission, label: commission })),
  ];
  const professionOptions = [
    { value: 'all', label: 'Toutes les professions' },
    ...professions.map(([profession, count]) => ({
      value: profession,
      label: profession,
      hint: `${count.toLocaleString('fr-FR')} sénateur${count > 1 ? 's' : ''}`,
    })),
  ];
  const sortOptions = [
    { value: 'nom-asc', label: 'Nom A → Z', hint: 'Ordre alphabétique croissant' },
    { value: 'nom-desc', label: 'Nom Z → A', hint: 'Ordre alphabétique décroissant' },
    { value: 'group', label: 'Groupe politique', hint: 'Groupe puis nom' },
    { value: 'votes-asc', label: 'Votes exprimés ↑', hint: 'Du plus petit total au plus grand' },
    { value: 'votes-desc', label: 'Votes exprimés ↓', hint: 'Du plus grand total au plus petit' },
  ];

  const activeFilterCount = [
    search.trim().length > 0,
    statusFilter !== 'ACTIF',
    groupFilter !== 'all',
    departmentFilter !== 'all',
    commissionFilter !== 'all',
    professionFilter !== 'all',
  ].filter(Boolean).length;
  const hasCustomFilters = activeFilterCount > 0 || sort !== 'nom-asc';

  const resetFilters = () => {
    setSearch('');
    setDepartmentFilter('all');
    setCommissionFilter('all');
    setProfessionFilter('all');
    setSort('nom-asc');
    onGroupFilterChange('all');
    onStatusFilterChange('ACTIF');
  };

  const filtered = useMemo(() => {
    const query = search.toLocaleLowerCase('fr-FR').trim();
    const rows = data.filter(senator => {
      if (groupFilter !== 'all' && senator.group !== groupFilter) return false;
      if (departmentFilter !== 'all' && departmentKey(senator) !== departmentFilter) return false;
      if (commissionFilter !== 'all' && normalizedValue(senator.commission) !== commissionFilter) return false;
      if (professionFilter !== 'all' && normalizedValue(senator.profession) !== professionFilter) return false;
      return !query || [senator.name, senator.dept, senator.deptCode, senator.commission, senator.groupFullName, senator.profession]
        .some(value => (value || '').toLocaleLowerCase('fr-FR').includes(query));
    });
    rows.sort((a, b) => {
      if (sort === 'nom-desc') return b.name.localeCompare(a.name, 'fr');
      if (sort === 'group') return (a.group || '').localeCompare(b.group || '', 'fr') || a.name.localeCompare(b.name, 'fr');
      if (sort === 'votes-asc') return (a.stats?.total ?? 0) - (b.stats?.total ?? 0) || a.name.localeCompare(b.name, 'fr');
      if (sort === 'votes-desc') return (b.stats?.total ?? 0) - (a.stats?.total ?? 0) || a.name.localeCompare(b.name, 'fr');
      return a.name.localeCompare(b.name, 'fr');
    });
    return rows;
  }, [data, groupFilter, departmentFilter, commissionFilter, professionFilter, search, sort]);

  return (
    <main className="main-content view-panel" id="view-senateurs">
      <div className="container">
        <h1 className="sr-only">Sénateurs</h1>
        <section className="senator-filter-panel" aria-labelledby="senator-filter-title">
          <div className="senator-filter-heading">
            <div>
              <p className="senator-filter-eyebrow">Annuaire du Sénat</p>
              <h2 id="senator-filter-title">Filtrer les sénateurs</h2>
              <p className="senator-filter-description">Combinez plusieurs critères pour trouver un profil.</p>
            </div>
            <div className="senator-filter-actions">
              <span className="senator-filter-count" aria-live="polite">
                {activeFilterCount === 0 ? 'Aucun filtre actif' : `${activeFilterCount} filtre${activeFilterCount > 1 ? 's' : ''} actif${activeFilterCount > 1 ? 's' : ''}`}
              </span>
              <button className="senator-filter-reset" type="button" onClick={resetFilters} disabled={!hasCustomFilters}>
                Effacer les filtres
              </button>
            </div>
          </div>

          <div className="senator-filter-grid">
            <div className="senator-filter-field senator-filter-search">
              <label htmlFor="senator-search">Recherche</label>
              <input
                className="filter-input"
                id="senator-search"
                type="search"
                placeholder="Nom, département, commission, profession…"
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
            </div>
            <FilterDropdown id="senator-status" label="Statut" value={statusFilter} options={statusOptions} onChange={value => onStatusFilterChange(value as SenatorStatusFilter)} />
            <FilterDropdown id="senator-group" label="Groupe politique" value={groupFilter} options={groupOptions} onChange={onGroupFilterChange} />
            <FilterDropdown id="senator-department" label="Département" value={departmentFilter} options={departmentOptions} onChange={setDepartmentFilter} />
            <FilterDropdown id="senator-commission" label="Commission" value={commissionFilter} options={commissionOptions} onChange={setCommissionFilter} />
            <FilterDropdown id="senator-profession" label="Profession" value={professionFilter} options={professionOptions} onChange={setProfessionFilter} />
            <FilterDropdown id="senator-sort" label="Trier par" value={sort} options={sortOptions} onChange={value => setSort(value as SortMode)} />
          </div>
        </section>

        <SectionHeader
          title="Liste des sénateurs"
          count={
            <>
              <strong className="senator-results-number">{filtered.length.toLocaleString('fr-FR')}</strong>
              <span> sénateur{filtered.length === 1 ? '' : 's'} dans la liste</span>
            </>
          }
        />
        <p className="senator-nonvoter-note senator-list-nonvoter-note">
          Les non-votants affichés sont les positions explicitement enregistrées ainsi. Les absences sans enregistrement ne sont pas comptées.
        </p>

        {statusFilter !== 'ACTIF' && formerLoadState === 'loading' ? (
          <div className="senators-grid"><div className="loading-state" style={{ gridColumn: '1 / -1' }}><div className="loading-spinner" /><p>Chargement des anciens sénateurs…</p></div></div>
        ) : statusFilter !== 'ACTIF' && formerLoadState === 'error' ? (
          <EmptyState
            icon="⚠️"
            title="Anciens sénateurs indisponibles"
            description="Le serveur n’a pas pu fournir cette liste. Vérifiez la connexion puis réessayez."
            role="alert"
          >
            <button className="btn-primary" type="button" onClick={() => { setFormerSenators(null); setRetryFormer(value => value + 1); }}>Réessayer</button>
          </EmptyState>
        ) : filtered.length === 0 ? (
          <div className="senators-grid"><EmptyState icon="👤" title="Aucun sénateur trouvé" description="Essayez un autre nom, département, profession ou groupe politique." style={{ gridColumn: '1 / -1' }} /></div>
        ) : (
          <div className="senators-grid">
            {filtered.map(senator => <SenatorCard key={senator.matricule} senator={senator} stats={stats} onOpen={onOpenSenator} onOpenPhoto={onOpenPhoto} />)}
          </div>
        )}
      </div>
    </main>
  );
}
