import LoyaltyRanking from './components/LoyaltyRanking';
import type { Scrutin, Senator, Stats } from './types';

interface IndependenceViewProps {
  senators: Senator[];
  scrutins: Scrutin[];
  stats: Stats | null;
  onOpenSenator: (senator: Senator) => void;
  onOpenScrutin: (scrutin: Scrutin) => void;
}

// The loyalty ranking on its own page (#independance).
export default function IndependenceView({ senators, scrutins, stats, onOpenSenator, onOpenScrutin }: IndependenceViewProps) {
  return (
    <main className="main-content view-panel" id="view-independance">
      <div className="container">
        <LoyaltyRanking
          senators={senators}
          scrutins={scrutins}
          stats={stats}
          onOpenSenator={onOpenSenator}
          onOpenScrutin={onOpenScrutin}
          titleAs="h1"
        />
      </div>
    </main>
  );
}
