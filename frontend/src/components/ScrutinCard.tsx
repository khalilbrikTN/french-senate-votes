import { formatDate } from '../lib/format';
import { voteShares } from '../lib/scrutins';
import type { Scrutin } from '../types';

interface ScrutinCardProps {
  scrutin: Scrutin;
  index: number;
  onOpen: (scrutin: Scrutin) => void;
}

export default function ScrutinCard({ scrutin, index, onOpen }: ScrutinCardProps) {
  const shares = voteShares(scrutin);
  const adopted = scrutin.result === 'adopté';
  const resultClass = adopted ? 'adopté' : 'rejeté';

  return (
    <article
      className={`scrutin-card ${resultClass}`}
      style={{ animationDelay: `${Math.min(index * 0.04, 0.4)}s` }}
    >
      <button
        className="scrutin-card-open"
        type="button"
        aria-label={`Ouvrir le scrutin n°${scrutin.number}, session ${scrutin.session}`}
        onClick={() => onOpen(scrutin)}
      />
      <div className="card-header">
        <div className="card-meta">
          <div className="card-number">Scrutin n°{scrutin.number}</div>
          <div className="card-date">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {formatDate(scrutin.date)}
          </div>
        </div>
        <span className={`result-badge ${resultClass}`}>{adopted ? 'Adopté' : 'Rejeté'}</span>
      </div>

      <h3 className="card-title">{scrutin.title || '(sans titre)'}</h3>

      <div className="vote-bar-container" aria-label={`${scrutin.pour} pour, ${scrutin.contre} contre`}>
        <div className="vote-bar" aria-hidden="true">
          <div className="vote-bar-pour" style={{ width: `${shares.pour}%` }} />
          <div className="vote-bar-contre" style={{ width: `${shares.contre}%` }} />
        </div>
        <div className="vote-counts">
          <div className="vote-count"><span className="vote-count-dot pour" /><strong>{scrutin.pour}</strong> Pour</div>
          <div className="vote-count"><span className="vote-count-dot contre" /><strong>{scrutin.contre}</strong> Contre</div>
          {scrutin.abstention > 0 && (
            <div className="vote-count"><span className="vote-count-dot abstention" /><strong>{scrutin.abstention}</strong> Abs.</div>
          )}
        </div>
      </div>

      <div className="card-footer">
        <span className="card-tag">Session {scrutin.session || '—'}</span>
        <span className="card-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </div>
    </article>
  );
}
