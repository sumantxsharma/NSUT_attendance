import { DateTime, Interval } from 'luxon';

/**
 * Timezone-aware date helpers. All official calculations use the institutional
 * timezone (default Asia/Kolkata) — never the browser's local zone.
 * Timestamps are stored as UTC `timestamptz`; calendar dates as plain `date`.
 */

export const DEFAULT_TZ = 'Asia/Kolkata';

export function nowIn(tz: string): DateTime {
  return DateTime.now().setZone(tz);
}

export function todayIn(tz: string, now: DateTime = DateTime.now()): string {
  return now.setZone(tz).toISODate()!;
}

export function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && DateTime.fromISO(s, { zone: 'utc' }).isValid;
}

/** Local minute-of-day (0..1439) of an instant in the institutional timezone. */
export function minuteOfDay(instant: Date | string, tz: string): number {
  const dt = DateTime.fromJSDate(new Date(instant)).setZone(tz);
  return dt.hour * 60 + dt.minute;
}

/** The institutional calendar date of an instant. */
export function localDateOf(instant: Date | string, tz: string): string {
  return DateTime.fromJSDate(new Date(instant)).setZone(tz).toISODate()!;
}

/** Combine a local date (yyyy-MM-dd) and local time (HH:mm) into a UTC Date. */
export function localToInstant(date: string, hhmm: string, tz: string): Date {
  const dt = DateTime.fromISO(`${date}T${hhmm}`, { zone: tz });
  if (!dt.isValid) throw new Error(`Invalid local date/time ${date} ${hhmm}`);
  return dt.toJSDate();
}

export function durationMinutes(checkIn: Date | string, checkOut: Date | string): number {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  if (ms < 0) throw new Error('Check-out is before check-in');
  return Math.floor(ms / 60000);
}

export function formatDuration(mins: number | null | undefined): string {
  if (mins === null || mins === undefined || Number.isNaN(mins)) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** All dates in a month as yyyy-MM-dd strings (handles leap years). */
export function datesInMonth(year: number, month: number): string[] {
  const start = DateTime.fromObject({ year, month, day: 1 }, { zone: 'utc' });
  if (!start.isValid) throw new Error('Invalid month');
  const out: string[] = [];
  for (let d = 1; d <= start.daysInMonth!; d++) out.push(start.set({ day: d }).toISODate()!);
  return out;
}

/** Inclusive list of dates between two yyyy-MM-dd strings. */
export function datesBetween(from: string, to: string): string[] {
  const a = DateTime.fromISO(from, { zone: 'utc' });
  const b = DateTime.fromISO(to, { zone: 'utc' });
  if (!a.isValid || !b.isValid || b < a) return [];
  const out: string[] = [];
  for (let d = a; d <= b; d = d.plus({ days: 1 })) out.push(d.toISODate()!);
  return out;
}

export function isoWeekday(date: string): number {
  return DateTime.fromISO(date, { zone: 'utc' }).weekday;
}

export function monthBounds(year: number, month: number): { from: string; to: string } {
  const s = DateTime.fromObject({ year, month, day: 1 }, { zone: 'utc' });
  return { from: s.toISODate()!, to: s.endOf('month').toISODate()! };
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** Do two inclusive date ranges overlap? */
export function rangesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

/** Number of calendar days in an inclusive range. */
export function daysInRange(from: string, to: string): number {
  const i = Interval.fromDateTimes(DateTime.fromISO(from, { zone: 'utc' }), DateTime.fromISO(to, { zone: 'utc' }).plus({ days: 1 }));
  return Math.round(i.length('days'));
}

export function formatTimeLocal(instant: Date | string | null | undefined, tz: string): string {
  if (!instant) return '—';
  return DateTime.fromJSDate(new Date(instant)).setZone(tz).toFormat('hh:mm a');
}

export function formatDateLocal(date: string | null | undefined, fmt = 'dd MMM yyyy'): string {
  if (!date) return '—';
  const d = DateTime.fromISO(date, { zone: 'utc' });
  return d.isValid ? d.toFormat(fmt) : date;
}

export function formatDateTimeLocal(instant: Date | string | null | undefined, tz: string): string {
  if (!instant) return '—';
  return DateTime.fromJSDate(new Date(instant)).setZone(tz).toFormat('dd MMM yyyy, hh:mm a');
}
