import { useState } from 'react';
import { getGroupColor, getGroupName } from '../lib/groups';
import { getInitials } from '../lib/format';
import { formerSenatorLabel, isFormerSenator, recordedNonVoterCount, senatorGroupLabel, senatorTitle } from '../lib/senators';
import type { Senator, Stats } from '../types';
import PoliticalGroupBadge from './PoliticalGroupBadge';

interface SenatorCardProps {
  senator: Senator;
  stats: Stats | null;
  onOpen: (senator: Senator) => void;
  onOpenPhoto: (src: string, name: string) => void;
}

export default function SenatorCard({ senator, stats, onOpen, onOpenPhoto }: SenatorCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const former = isFormerSenator(senator);
  const color = getGroupColor(senator.group, stats);
  const groupName = getGroupName(senator.group, senator.groupFullName);
  const voteStats = senator.stats;

  return (
    <article className={`senator-card${former ? ' is-former' : ''}`}>
      <button className="senator-card-open" type="button" aria-label={`Ouvrir la fiche de ${senator.name}`} onClick={() => onOpen(senator)} />
      <div className="senator-card-top">
        {senator.avatar && !imageFailed ? (
          <button
            className="senator-avatar-large senator-photo-trigger"
            type="button"
            aria-label={`Agrandir la photo de ${senator.name}`}
            title={`Agrandir la photo de ${senator.name}`}
            style={{ borderColor: `${color}55` }}
            onClick={() => onOpenPhoto(senator.avatar!, senator.name)}
          >
            <img src={senator.avatar} alt="" className="senator-photo-img" loading="lazy" decoding="async" onError={() => setImageFailed(true)} />
            <span className="senator-avatar-dot" style={{ background: color }} />
          </button>
        ) : (
          <div className="senator-avatar-large" style={{ borderColor: `${color}55` }}>
            <span style={{ fontWeight: 700, color }}>{getInitials(senator.name)}</span>
            <div className="senator-avatar-dot" style={{ background: color }} />
          </div>
        )}
        <div className="senator-card-meta">
          <div className="senator-card-name">{senator.name}</div>
          <div className="senator-card-dept">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></svg>
            {senator.dept || 'Sénat'}
          </div>
        </div>
      </div>

      <PoliticalGroupBadge
        className="senator-card-group-badge"
        label={senatorGroupLabel(senator, groupName)}
        color={color}
        backgroundColor={`${color}18`}
        borderColor={`${color}33`}
        dotSize={6}
      />

      {former ? (
        <div className="senator-card-role senator-former-label">
          <span className="senator-former-tag">{senator.civilite === 'Mme' || senator.civilite === 'Mlle' ? 'Ancienne' : 'Ancien'}</span>
          {formerSenatorLabel(senator)}
        </div>
      ) : (
        <div className="senator-card-role" title={senator.commission || ''}>{senator.commission || senatorTitle(senator)}</div>
      )}

      <div className="senator-nonvoter-summary" title="Compte uniquement les positions officiellement enregistrées comme non-votant, pas les absences sans enregistrement.">
        <span>Non-votants enregistrés</span>
        <strong>{recordedNonVoterCount(voteStats)?.toLocaleString('fr-FR') ?? '—'}</strong>
      </div>

      <div className="senator-stats-row">
        <MiniStat value={voteStats?.pour ?? 0} label="Pour" className="pour" />
        <MiniStat value={voteStats?.contre ?? 0} label="Contre" className="contre" />
        <MiniStat value={voteStats?.abstention ?? 0} label="Abst." className="abst" />
        <div className="senator-card-action" aria-hidden="true">
          Voir votes
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
        </div>
      </div>
    </article>
  );
}

function MiniStat({ value, label, className }: { value: number; label: string; className: string }) {
  return <div className="senator-stat-mini"><div className={`senator-stat-mini-val ${className}`}>{value}</div><div className="senator-stat-mini-label">{label}</div></div>;
}
