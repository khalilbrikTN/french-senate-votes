import { fetchJSON } from './client';
import type {
  ApiStatus, GroupStats, LoyaltyOverview, SenatorRebels, SenatorComparison, Scrutin, ScrutinDetail, Senator, SenatorDetail, SenatorVotesPage, SenateStatus, Stats, ThemeStats,
} from '../types';

export const api = {
  status: (signal?: AbortSignal) => fetchJSON<ApiStatus>('/api/status', 1500, signal),
  senators: (signal?: AbortSignal) => fetchJSON<Senator[]>('/api/senateurs', 4000, signal),
  senatorsByStatus: (status: SenateStatus, signal?: AbortSignal) =>
    fetchJSON<Senator[]>(`/api/senateurs?status=${status}`, 20000, signal),
  scrutins: (signal?: AbortSignal) => fetchJSON<Scrutin[]>('/api/scrutins', 4000, signal),
  stats: (signal?: AbortSignal) => fetchJSON<Stats>('/api/stats', 4000, signal),
  groupStats: (signal?: AbortSignal) => fetchJSON<GroupStats>('/api/stats/groups', 15000, signal),
  themeStats: (signal?: AbortSignal) => fetchJSON<ThemeStats>('/api/stats/themes', 15000, signal),
  senatorVotes: (matricule: string, offset: number, limit: number, signal?: AbortSignal) =>
    fetchJSON<SenatorVotesPage>(
      `/api/senateurs/${encodeURIComponent(matricule)}/votes?offset=${offset}&limit=${limit}`, 15000, signal),
  senatorDetail: (matricule: string, signal?: AbortSignal) =>
    fetchJSON<SenatorDetail>(`/api/v1/senators/${encodeURIComponent(matricule)}`, 15000, signal),
  scrutinDetail: (session: string, number: number, signal?: AbortSignal) =>
    fetchJSON<ScrutinDetail>(`/api/scrutins/${encodeURIComponent(session)}/${number}`, 15000, signal),
  compareSenators: (matriculeA: string, matriculeB: string, signal?: AbortSignal) =>
    fetchJSON<SenatorComparison>(
      `/api/compare/${encodeURIComponent(matriculeA)}/${encodeURIComponent(matriculeB)}`, 15000, signal),
  loyalty: (signal?: AbortSignal) => fetchJSON<LoyaltyOverview>('/api/loyalty', 15000, signal),
  senatorRebels: (matricule: string, limit: number, signal?: AbortSignal) =>
    fetchJSON<SenatorRebels>(`/api/loyalty/${encodeURIComponent(matricule)}/rebels?limit=${limit}`, 15000, signal),
};
