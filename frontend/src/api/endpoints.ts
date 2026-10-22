import { fetchJSON } from './client';
import type {
  ApiStatus, GroupStats, LoyaltyOverview, SenatorRebels, SenatorComparison, Scrutin, ScrutinDetail, Senator, SenatorDetail, SenatorVotesPage, SenateStatus, Stats, ThemeStats,
} from '../types';

export const api = {
  status: (signal?: AbortSignal, timeoutMs = 1500) => fetchJSON<ApiStatus>('/api/status', timeoutMs, signal),
  senators: (signal?: AbortSignal, timeoutMs = 4000) => fetchJSON<Senator[]>('/api/senateurs', timeoutMs, signal),
  senatorsByStatus: (status: SenateStatus, signal?: AbortSignal) =>
    fetchJSON<Senator[]>(`/api/senateurs?status=${status}`, 20000, signal),
  scrutins: (signal?: AbortSignal, timeoutMs = 4000) => fetchJSON<Scrutin[]>('/api/scrutins', timeoutMs, signal),
  stats: (signal?: AbortSignal, timeoutMs = 4000) => fetchJSON<Stats>('/api/stats', timeoutMs, signal),
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
