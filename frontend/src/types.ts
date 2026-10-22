// Shapes of the API responses used by the app (see backend/app/routers/legacy.py and /api/v1).

export type VoteResult = 'adopté' | 'rejeté';
export type Position = 'pour' | 'contre' | 'abstention' | 'non_votant';
export type SenateStatus = 'ACTIF' | 'ANCIEN';
export type SenatorStatusFilter = SenateStatus | 'all';
export type View = 'scrutins' | 'senateurs' | 'groupes' | 'independance' | 'carte' | 'stats' | 'about';

export interface SenatorStats {
  pour: number;
  contre: number;
  abstention: number;
  total: number;
  listed?: number;
  participation?: number;
}

export interface Senator {
  matricule: string;
  name: string;
  prenom: string;
  nom: string;
  slug: string | null;
  civilite: string | null;
  status: SenateStatus;
  group: string | null;
  groupFullName: string | null;
  lastGroupEndDate: string | null;
  serviceStart: string | null;
  serviceEnd: string | null;
  dept: string | null;
  deptCode: string | null;
  commission: string | null;
  avatar: string | null;
  url: string | null;
  profession: string | null;
  social: { twitter?: string | null; facebook?: string | null } | null;
  stats: SenatorStats | null;
}

export interface GroupVoteTotal {
  code: string;
  name: string;
  pour: number;
  contre: number;
  abstention: number;
}

export interface Scrutin {
  number: number;
  session: string;
  date: string | null;
  title: string;
  result: string;
  url: string | null;
  pour: number;
  contre: number;
  abstention: number;
  total: number;
  groups: GroupVoteTotal[];
  // Automatic, approximate classification of the title (backend/app/themes.py).
  theme?: string;
  themeLabel?: string;
  voteType?: string; // ensemble | article | amendement | motion | autre
  voteTypeLabel?: string;
}

export interface StatsGroup {
  name: string;
  color: string | null;
  seats: number;
  leader?: string | null;
  leaderId?: string | null;
  leaderSince?: string | null;
}

export interface Stats {
  totalScrutins: number;
  adoptes: number;
  rejetes: number;
  adoptionRate: number;
  totalSenateurs: number;
  groups: Record<string, StatsGroup>;
  groupColors?: Record<string, string>;
  generatedAt: string;
  source: string;
}

export interface ApiStatus {
  status: string;
  backend: string;
  database: string;
  hasData: boolean;
}

export interface VoteNotes {
  specialStatus: string | null;
  delegatedBy: string | null;
  hasCorrection: boolean;
}

export interface HistoryItem extends VoteNotes {
  scrutinSession: string;
  scrutinNumber: number;
  scrutinTitle: string;
  scrutinDate: string | null;
  scrutinResult: string;
  vote: Position;
}

export interface SenatorVotesPage {
  total: number;
  offset: number;
  limit: number;
  items: HistoryItem[];
}

export interface Voter extends VoteNotes {
  id: string;
  name: string;
  group: string | null;
}

export interface VoteCorrection {
  text: string;
  url: string | null;
}

export interface ScrutinDetail {
  session: string;
  number: number;
  senateurs: Record<Position, Voter[]>;
  votersScope: string;
  listedVoters: number;
  corrections: VoteCorrection[];
}

export interface GroupMembership {
  group_code: string | null;
  group_name: string;
  start_date: string | null;
  end_date: string | null;
  source_url: string;
}

export interface SenatorDetail {
  id: string;
  group_memberships: GroupMembership[];
}

// /api/stats/groups: aggregated from the individual votes of the senators sitting today
// (older sessions are partial, see `coverage`). Group codes are app codes (LR, SER...).
export interface GroupStatsSession {
  session: string;
  votes: number;
  officialVoters: number;
  individualCast: number;
  votesWithIndividual: number;
  coverage: number; // individual pour/contre/abstention rows / official voters, 0..1
}

export interface GroupCohesion {
  session: string;
  group: string;
  votes: number; // votes where the group had at least minGroupVoters expressed positions
  avgVoters: number;
  agreementIndex: number; // Hix–Noury–Roland, 0..1, averaged over those votes
}

export interface GroupAgreement {
  session: string;
  groupA: string;
  groupB: string;
  votes: number; // votes where both groups had a clear majority position
  agree: number; // ... and it was the same one
}

export interface GroupStats {
  scope: 'sitting_senators';
  minGroupVoters: number;
  sessions: GroupStatsSession[];
  cohesion: GroupCohesion[];
  agreement: GroupAgreement[];
  generatedAt: string;
}

// /api/compare/{a}/{b}: votes where both senators expressed pour/contre/abstention.
// Only the individual votes of the senators sitting today are loaded.
export type ExpressedPosition = 'pour' | 'contre' | 'abstention';

export interface CompareDisagreement {
  session: string;
  number: number;
  date: string | null;
  title: string;
  result: string;
  positionA: ExpressedPosition;
  positionB: ExpressedPosition;
}

export interface SenatorComparison {
  a: string;
  b: string;
  scope: 'sitting_senators';
  shared: number;
  agree: number;
  agreementRate: number | null; // agree / shared, 0..1; null when they share no votes
  breakdown: { bothPour: number; bothContre: number; bothAbstention: number; opposite: number; oneAbstained: number };
  firstDate: string | null;
  lastDate: string | null;
  disagreements: CompareDisagreement[]; // latest first
}

// /api/loyalty: how often each sitting senator votes like their group's majority
// (see backend/app/routers/loyalty.py for the definitions). Group codes are app codes.
export interface SenatorLoyalty {
  matricule: string;
  name: string;
  group: string; // current group ('NI' for non-inscrits, never measured)
  follows: number;
  rebels: number;
  ties: number; // votes where the group had no majority (not counted)
  loyalty: number | null; // follows / (follows + rebels), percent with one decimal
  ranked: boolean; // follows + rebels >= minRankedVotes
}

export interface GroupLoyalty {
  group: string;
  members: number;
  ranked: number;
  follows: number;
  rebels: number;
  avgLoyalty: number | null; // mean loyalty of the ranked members
  loyalty: number | null; // pooled over all the members' counted votes
}

export interface LoyaltyOverview {
  scope: 'sitting_senators';
  minGroupVoters: number;
  minRankedVotes: number;
  senators: SenatorLoyalty[];
  groups: GroupLoyalty[];
  generatedAt: string;
}

export interface RebelVote {
  scrutinSession: string;
  scrutinNumber: number;
  scrutinTitle: string;
  scrutinDate: string | null;
  scrutinResult: string;
  vote: Exclude<Position, 'non_votant'>;
  groupPosition: Exclude<Position, 'non_votant'>;
  group: string; // group on the vote date
  groupPour: number;
  groupContre: number;
  groupAbstention: number;
  specialStatus: string | null;
  delegatedBy: string | null;
}

export interface SenatorRebels {
  matricule: string;
  minGroupVoters: number;
  minRankedVotes: number;
  follows: number;
  rebels: number;
  ties: number;
  loyalty: number | null;
  ranked: boolean;
  group: string | null; // current group, null for non-inscrits
  groupAvgLoyalty: number | null;
  total: number; // rebel votes in total (items holds at most `limit`, latest first)
  limit: number;
  items: RebelVote[];
}

// /api/stats/themes: votes per theme (automatic classification from titles) and group
// majority positions per theme, from the individual votes of the sitting senators.
export interface ThemeDefinition {
  id: string;
  label: string;
}

export interface ThemeVotes {
  session: string;
  theme: string;
  votes: number;
  adopted: number;
}

export interface ThemeGroupPositions {
  session: string;
  theme: string;
  group: string; // app code
  votes: number; // votes where the group had at least minGroupVoters expressed positions
  pour: number; // ... and a strict majority pour
  contre: number;
  abstention: number;
}

export interface ThemeStats {
  scope: 'sitting_senators';
  minGroupVoters: number;
  note: string;
  themes: ThemeDefinition[];
  sessions: GroupStatsSession[];
  votes: ThemeVotes[];
  groups: ThemeGroupPositions[];
  generatedAt: string;
}
