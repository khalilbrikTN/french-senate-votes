import { getYear } from './format';
import type { Senator, SenatorStats, VoteNotes } from '../types';

// The summary API's listed count includes each recorded position; total only
// includes expressed votes (pour, contre and abstention). The difference is the
// number of explicitly recorded non-voter positions, not an attendance count.
export function recordedNonVoterCount(stats: SenatorStats | null | undefined): number | null {
  if (!stats || typeof stats.listed !== 'number' || !Number.isInteger(stats.listed)
      || !Number.isInteger(stats.total)) return null;
  if (stats.listed < 0 || stats.total < 0 || stats.total > stats.listed) return null;
  return stats.listed - stats.total;
}

export function isFormerSenator(senator: Senator): boolean {
  return senator.status === 'ANCIEN';
}

// The Senate records the title (civilité) as M., Mme or Mlle.
export function isWoman(senator: Senator): boolean {
  return senator.civilite === 'Mme' || senator.civilite === 'Mlle';
}

export function senatorTitle(senator: Senator): string {
  return isWoman(senator) ? 'Sénatrice' : 'Sénateur';
}

export function formerTag(senator: Senator): string {
  return isWoman(senator) ? 'Ancienne' : 'Ancien';
}

// "Ancienne sénatrice · 1983 – 2001", from the official mandate dates when published.
export function formerSenatorLabel(senator: Senator): string {
  const start = getYear(senator.serviceStart);
  const end = getYear(senator.serviceEnd);
  const period = start && end ? ` · ${start} – ${end}` : end ? ` · jusqu'en ${end}` : '';
  return `${formerTag(senator)} ${senatorTitle(senator).toLowerCase()}${period}`;
}

// Former senators show their last recorded group, as the Senate's history publishes it.
export function senatorGroupLabel(senator: Senator, groupName: string): string {
  if (!senator.group) return 'Groupe non renseigné';
  if (!isFormerSenator(senator)) return `${senator.group} — ${groupName}`;
  const until = getYear(senator.lastGroupEndDate);
  return `Dernier groupe : ${senator.groupFullName || senator.group}${until ? ` (jusqu'en ${until})` : ''}`;
}

export interface SocialLink {
  label: string;
  network: 'X' | 'Facebook';
  url: string;
}

// Social accounts as published by senat.fr: X handles are bare; Facebook is a URL or a numeric profile id.
export function socialLinks(senator: Senator): SocialLink[] {
  const social = senator.social || {};
  const links: SocialLink[] = [];
  const twitter = (social.twitter || '').trim().replace(/^@/, '');
  if (/^[A-Za-z0-9_]{1,30}$/.test(twitter)) {
    links.push({ label: `@${twitter}`, network: 'X', url: `https://x.com/${twitter}` });
  }
  const facebook = (social.facebook || '').trim();
  if (/^https?:\/\/([a-z0-9-]+\.)*facebook\.com\//i.test(facebook)) {
    links.push({ label: 'Facebook', network: 'Facebook', url: facebook });
  } else if (/^\d+$/.test(facebook)) {
    links.push({ label: 'Facebook', network: 'Facebook', url: `https://www.facebook.com/profile.php?id=${facebook}` });
  }
  return links;
}

export function voteNotes(v: VoteNotes): string[] {
  const notes: string[] = [];
  if (v.specialStatus) notes.push(v.specialStatus);
  if (v.delegatedBy) notes.push(`A aussi voté pour ${v.delegatedBy} (délégation)`);
  if (v.hasCorrection) notes.push('A ensuite indiqué une autre intention de vote');
  return notes;
}

function normalizeName(str: string | null | undefined): string {
  if (!str) return '';
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
}

export function findSenatorByName(senators: Senator[], voterName: string): Senator | null {
  if (!voterName || senators.length === 0) return null;
  const targetNorm = normalizeName(voterName);

  // 1. Direct exact normalized name match
  let match = senators.find(s => normalizeName(s.name) === targetNorm);
  if (match) return match;

  // 2. Normalized contains match
  match = senators.find(s => {
    const sNorm = normalizeName(s.name);
    return sNorm.includes(targetNorm) || targetNorm.includes(sNorm);
  });
  if (match) return match;

  // 3. Match by last name
  const words = voterName.trim().split(/\s+/);
  if (words.length > 0) {
    const lastNameNorm = normalizeName(words[words.length - 1]);
    if (lastNameNorm.length >= 3) {
      match = senators.find(s => normalizeName(s.nom) === lastNameNorm);
      if (match) return match;
    }
  }
  return null;
}

// Voters from the API carry the senator's matricule; fall back to the name for older data.
export function findVoterSenator(senators: Senator[], voter: { id?: string | null; name: string }): Senator | null {
  return (voter.id && senators.find(s => s.matricule === voter.id)) || findSenatorByName(senators, voter.name);
}
