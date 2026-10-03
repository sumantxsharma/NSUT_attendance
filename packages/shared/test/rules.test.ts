import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  classifyByDuration,
  earlyDepartureMinutes,
  lateMinutes,
  summarize,
  evaluateDay,
  type DayInput,
  type AttendanceRules,
} from '../src/rules';
import {
  datesBetween,
  datesInMonth,
  durationMinutes,
  formatDuration,
  isoWeekday,
  localDateOf,
  localToInstant,
  minuteOfDay,
  previousMonth,
  rangesOverlap,
  daysInRange,
  isValidIsoDate,
} from '../src/time';
import { manualAttendanceSchema, leaveSchema, correctionSchema } from '../src/schemas';

const GF = DEFAULT_RULES.byType.GUEST_FACULTY;
const TZ = 'Asia/Kolkata';

function day(date: string, status: DayInput['status'], extra: Partial<DayInput> = {}): DayInput {
  return { date, weekday: isoWeekday(date), isHoliday: false, status, inContract: true, isToday: false, isFuture: false, ...extra };
}

describe('duration calculation', () => {
  it('computes minutes between check-in and check-out', () => {
    expect(durationMinutes('2026-09-28T03:44:00Z', '2026-09-28T11:27:00Z')).toBe(463);
  });
  it('floors partial minutes', () => {
    expect(durationMinutes('2026-09-28T03:44:00Z', '2026-09-28T03:45:59Z')).toBe(1);
  });
  it('rejects check-out before check-in', () => {
    expect(() => durationMinutes('2026-09-28T10:00:00Z', '2026-09-28T09:00:00Z')).toThrow();
  });
  it('handles shifts crossing midnight', () => {
    expect(durationMinutes('2026-09-28T18:00:00Z', '2026-09-28T19:30:00Z')).toBe(90);
  });
  it('formats durations', () => {
    expect(formatDuration(463)).toBe('7h 43m');
    expect(formatDuration(5)).toBe('0h 05m');
    expect(formatDuration(null)).toBe('—');
  });
});

describe('late calculation', () => {
  it('is on time within the grace period', () => {
    expect(lateMinutes(9 * 60 + 15, GF)).toBe(0);
  });
  it('is late after the grace period', () => {
    expect(lateMinutes(9 * 60 + 16, GF)).toBe(1);
    expect(lateMinutes(10 * 60, GF)).toBe(45);
  });
  it('uses institutional time, not UTC', () => {
    // 03:50 UTC = 09:20 IST -> 5 minutes late
    const inst = new Date('2026-09-28T03:50:00Z');
    expect(minuteOfDay(inst, TZ)).toBe(9 * 60 + 20);
    expect(lateMinutes(minuteOfDay(inst, TZ), GF)).toBe(5);
  });
  it('flags early departure before end minus grace', () => {
    expect(earlyDepartureMinutes(16 * 60 + 45, GF)).toBe(0);
    expect(earlyDepartureMinutes(16 * 60 + 30, GF)).toBe(15);
  });
});

describe('half-day classification', () => {
  it('classifies by hours worked', () => {
    expect(classifyByDuration(6 * 60, GF)).toBe('PRESENT');
    expect(classifyByDuration(6 * 60 - 1, GF)).toBe('HALF_DAY');
    expect(classifyByDuration(3 * 60, GF)).toBe('HALF_DAY');
    expect(classifyByDuration(3 * 60 - 1, GF)).toBe('ABSENT');
  });
});

describe('attendance percentage', () => {
  // Sep 2026: 1st is a Tuesday.
  const week: DayInput[] = [
    day('2026-09-01', 'PRESENT'),
    day('2026-09-02', 'PRESENT'),
    day('2026-09-03', 'HALF_DAY'),
    day('2026-09-04', 'LEAVE'),
    day('2026-09-05', 'NOT_MARKED'), // Saturday
    day('2026-09-06', 'NOT_MARKED'), // Sunday
    day('2026-09-07', 'ABSENT'),
    day('2026-09-08', 'NOT_MARKED'),
  ];

  it('excludes leave from denominator by default', () => {
    const s = summarize(week, GF, DEFAULT_RULES);
    // eligible: 1,2,3,7,8 = 5 ; credits 1+1+0.5 = 2.5
    expect(s.eligibleDays).toBe(5);
    expect(s.credits).toBe(2.5);
    expect(s.percentage).toBe(50);
    expect(s.present).toBe(2);
    expect(s.halfDays).toBe(1);
    expect(s.leave).toBe(1);
    expect(s.absent).toBe(1);
    expect(s.notMarked).toBe(1);
  });

  it('can count leave as present', () => {
    const rules: AttendanceRules = { ...DEFAULT_RULES, excludeLeaveFromDenominator: false, leaveCountsAsPresent: true };
    const s = summarize(week, GF, rules);
    expect(s.eligibleDays).toBe(6);
    expect(s.credits).toBe(3.5);
    expect(s.percentage).toBe(58.3);
  });

  it('can count leave as absent', () => {
    const rules: AttendanceRules = { ...DEFAULT_RULES, excludeLeaveFromDenominator: false, leaveCountsAsPresent: false };
    const s = summarize(week, GF, rules);
    expect(s.eligibleDays).toBe(6);
    expect(s.credits).toBe(2.5);
  });

  it('counts weekend work but not empty weekends', () => {
    const s = summarize([day('2026-09-05', 'PRESENT'), day('2026-09-06', 'NOT_MARKED')], GF, DEFAULT_RULES);
    expect(s.eligibleDays).toBe(1);
    expect(s.percentage).toBe(100);
  });

  it('counts weekends when configured', () => {
    const s = summarize([day('2026-09-06', 'NOT_MARKED')], GF, { ...DEFAULT_RULES, countWeekends: true });
    expect(s.eligibleDays).toBe(1);
  });

  it('excludes holidays by default and includes them when configured', () => {
    const d = [day('2026-10-02', 'NOT_MARKED', { isHoliday: true })];
    expect(summarize(d, GF, DEFAULT_RULES).eligibleDays).toBe(0);
    expect(summarize(d, GF, DEFAULT_RULES).holidays).toBe(1);
    expect(summarize(d, GF, { ...DEFAULT_RULES, countHolidays: true }).eligibleDays).toBe(1);
  });

  it('does not count today until marked, future days, or out-of-contract days', () => {
    expect(evaluateDay(day('2026-09-28', 'NOT_MARKED', { isToday: true }), GF, DEFAULT_RULES).outcome).toBe('EXCLUDED');
    expect(evaluateDay(day('2026-09-28', 'PRESENT', { isToday: true }), GF, DEFAULT_RULES).outcome).toBe('COUNTED');
    expect(evaluateDay(day('2026-09-29', 'NOT_MARKED', { isFuture: true }), GF, DEFAULT_RULES).outcome).toBe('EXCLUDED');
    expect(evaluateDay(day('2026-09-22', 'NOT_MARKED', { inContract: false }), GF, DEFAULT_RULES).outcome).toBe('EXCLUDED');
  });

  it('returns null percentage with no eligible days', () => {
    expect(summarize([], GF, DEFAULT_RULES).percentage).toBeNull();
  });

  it('respects half-day weight', () => {
    const s = summarize([day('2026-09-01', 'HALF_DAY')], GF, { ...DEFAULT_RULES, halfDayWeight: 0.25 });
    expect(s.percentage).toBe(25);
  });
});

describe('leave calculations and date handling', () => {
  it('lists leave days across a month boundary', () => {
    expect(datesBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(daysInRange('2026-09-29', '2026-10-02')).toBe(4);
  });
  it('detects overlapping ranges (inclusive)', () => {
    expect(rangesOverlap('2026-09-01', '2026-09-05', '2026-09-05', '2026-09-08')).toBe(true);
    expect(rangesOverlap('2026-09-01', '2026-09-04', '2026-09-05', '2026-09-08')).toBe(false);
  });
  it('handles leap years', () => {
    expect(datesInMonth(2028, 2)).toHaveLength(29);
    expect(datesInMonth(2027, 2)).toHaveLength(28);
    expect(datesBetween('2028-02-28', '2028-03-01')).toHaveLength(3);
  });
  it('handles year boundaries', () => {
    expect(previousMonth(2027, 1)).toEqual({ year: 2026, month: 12 });
    expect(datesBetween('2026-12-31', '2027-01-01')).toEqual(['2026-12-31', '2027-01-01']);
  });
  it('maps instants near midnight to the institutional date', () => {
    // 18:40 UTC on 27 Sep = 00:10 IST on 28 Sep
    expect(localDateOf('2026-09-27T18:40:00Z', TZ)).toBe('2026-09-28');
    expect(localDateOf('2026-09-27T18:20:00Z', TZ)).toBe('2026-09-27');
  });
  it('converts local time to UTC instants', () => {
    expect(localToInstant('2026-09-28', '09:00', TZ).toISOString()).toBe('2026-09-28T03:30:00.000Z');
  });
  it('validates ISO dates', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
  });
  it('rejects leave with to-date before from-date', () => {
    const r = leaveSchema.safeParse({ fromDate: '2026-09-10', toDate: '2026-09-09', leaveType: 'CASUAL', reason: 'Family function' });
    expect(r.success).toBe(false);
  });
});

describe('manual attendance validation', () => {
  const base = { personId: '9b2d8f7a-0a4e-4f5b-9e1c-2f3a4b5c6d7e', date: '2026-09-28' };
  it('rejects check-out without check-in', () => {
    expect(manualAttendanceSchema.safeParse({ ...base, status: 'PRESENT', checkOut: '17:00' }).success).toBe(false);
  });
  it('rejects out-time before in-time', () => {
    expect(manualAttendanceSchema.safeParse({ ...base, status: 'PRESENT', checkIn: '10:00', checkOut: '09:00' }).success).toBe(false);
  });
  it('rejects times on absent status', () => {
    expect(manualAttendanceSchema.safeParse({ ...base, status: 'ABSENT', checkIn: '10:00' }).success).toBe(false);
  });
  it('accepts a valid present record', () => {
    expect(manualAttendanceSchema.safeParse({ ...base, status: 'PRESENT', checkIn: '09:05', checkOut: '17:00' }).success).toBe(true);
  });
  it('requires a reason for corrections', () => {
    expect(correctionSchema.safeParse({ status: 'PRESENT', checkIn: '09:05', reason: '' }).success).toBe(false);
  });
});
