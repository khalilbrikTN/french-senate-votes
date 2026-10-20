import { getGroupColor, getGroupLeader, getGroupSeats, getGroupName, getTotalSeats } from './lib/groups';
import { GROUP_CODES, POLITICAL_GROUPS } from './data/politicalGroups';
import type { Senator, Stats } from './types';
import PoliticalGroupBadge from './components/PoliticalGroupBadge';
import LoyaltyRanking from './components/LoyaltyRanking';

interface GroupsViewProps {
  senators: Senator[];
  stats: Stats | null;
  onSelectGroup: (code: string) => void;
  // Opens the senator panel from the loyalty ranking (App's openSenator).
  onOpenSenator?: (senator: Senator) => void;
}

export default function GroupsView({ senators, stats, onSelectGroup, onOpenSenator }: GroupsViewProps) {
  const totalSeats = getTotalSeats(stats);

  return (
    <main className="main-content view-panel" id="view-groupes">
      <div className="container">
        <h1 className="sr-only">Groupes politiques</h1>
        <div className="groups-page-grid">
          {GROUP_CODES.map(code => {
            const group = POLITICAL_GROUPS[code];
            const color = getGroupColor(code, stats);
            const seats = getGroupSeats(code, stats);
            const share = totalSeats > 0 ? (seats / totalSeats * 100).toFixed(1) : '0.0';
            const memberCount = senators.filter(senator => senator.group === code).length;

            return (
              <article className="group-card" key={code}>
                <div className="group-card-stripe" style={{ background: color }} />
                <div className="group-card-header">
                  <PoliticalGroupBadge
                    className="group-card-badge"
                    label={group.short}
                    color={color}
                    backgroundColor={`${color}20`}
                    borderColor={`${color}40`}
                    dotSize={8}
                  />
                  <div className="group-card-seats">
                    <div className="group-card-seats-num">{seats}</div>
                    <div className="group-card-seats-label">sièges ({share}%)</div>
                  </div>
                </div>

                <h2 className="group-card-title">{getGroupName(code, group.name)}</h2>
                {group.desc && <p className="group-card-desc">{group.desc}</p>}

                <div className="group-card-leader">
                  <span>Président(e) de groupe :</span>
                  <strong>{getGroupLeader(code, stats)}</strong>
                </div>

                <div className="group-cohesion-box">
                  <div className="group-cohesion-header">
                    <span>Poids officiel dans l’hémicycle</span>
                    <span style={{ color }}>{share}%</span>
                  </div>
                  <div className="group-cohesion-bar">
                    <div className="group-cohesion-fill" style={{ width: `${share}%`, background: color }} />
                  </div>
                </div>

                <div className="group-card-footer">
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{group.orientation}</span>
                  <button className="btn-view-group-senators" type="button" onClick={() => onSelectGroup(code)}>
                    Voir les sénateurs ({memberCount})
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        <LoyaltyRanking senators={senators} stats={stats} onOpenSenator={onOpenSenator} />
      </div>
    </main>
  );
}
