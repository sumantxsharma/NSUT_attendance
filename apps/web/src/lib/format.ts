import { DateTime } from 'luxon';
import { PERSON_TYPE_LABELS, type PersonType } from '@nsut/shared';

export { formatDuration, formatTimeLocal, formatDateLocal, formatDateTimeLocal } from '@nsut/shared';

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`);

export const typeLabel = (t: PersonType) => PERSON_TYPE_LABELS[t];

export function unitName(p: { type: PersonType; departmentName: string | null; activityName: string | null }) {
  return p.type === 'SPORTS_COACH' ? (p.activityName ?? '—') : (p.departmentName ?? '—');
}

export function monthLabel(year: number, month: number) {
  return DateTime.fromObject({ year, month }).toFormat('MMMM yyyy');
}

export function nowParts(tz: string) {
  const n = DateTime.now().setZone(tz);
  return { year: n.year, month: n.month, date: n.toISODate()! };
}

export function greeting(tz: string) {
  const h = DateTime.now().setZone(tz).hour;
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function relativeTime(iso: string) {
  return DateTime.fromISO(iso).toRelative({ style: 'short' }) ?? '';
}

export function initials(name: string) {
  return name
    .replace(/^(Dr\.|Coach|Prof\.)\s+/i, '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');
}
