import { z } from 'zod';
import type { AttendanceStatus, PersonType } from './domain';

const timeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM format');

/** Rules that can differ between Guest Faculty and Sports Coaches. */
export const typeRulesSchema = z
  .object({
    officeStart: timeHHMM,
    officeEnd: timeHHMM,
    graceMinutes: z.number().int().min(0).max(180),
    earlyDepartureGraceMinutes: z.number().int().min(0).max(180),
    minHoursFullDay: z.number().min(0).max(24),
    minHoursHalfDay: z.number().min(0).max(24),
    /** ISO weekdays that are working days: 1 = Monday … 7 = Sunday */
    workingDays: z.array(z.number().int().min(1).max(7)).min(1),
  })
  .refine((r) => r.officeEnd > r.officeStart, { message: 'Office end must be after office start', path: ['officeEnd'] })
  .refine((r) => r.minHoursHalfDay <= r.minHoursFullDay, {
    message: 'Half-day minimum cannot exceed full-day minimum',
    path: ['minHoursHalfDay'],
  });
export type TypeRules = z.infer<typeof typeRulesSchema>;

export const attendanceRulesSchema = z.object({
  byType: z.object({ GUEST_FACULTY: typeRulesSchema, SPORTS_COACH: typeRulesSchema }),
  /** When true, days of approved leave are removed from the denominator (neutral). */
  excludeLeaveFromDenominator: z.boolean(),
  /** Only used when leave is NOT excluded: if true, leave counts as present; otherwise as absent. */
  leaveCountsAsPresent: z.boolean(),
  /** When false, institutional holidays are not working days. */
  countHolidays: z.boolean(),
  /** When false, days outside `workingDays` are ignored unless the person actually attended. */
  countWeekends: z.boolean(),
  /** Credit given for a half day (0–1). */
  halfDayWeight: z.number().min(0).max(1),
  /**
   * When true, a self check-out automatically sets PRESENT / HALF_DAY / ABSENT from hours
   * worked using minHoursFullDay / minHoursHalfDay. When false, a check-in is always PRESENT.
   */
  autoClassifyByHours: z.boolean(),
  /** When true, officer corrections to existing records go to a Super Admin for approval. */
  manualCorrectionRequiresApproval: z.boolean(),
});
export type AttendanceRules = z.infer<typeof attendanceRulesSchema>;

export const DEFAULT_RULES: AttendanceRules = {
  byType: {
    GUEST_FACULTY: {
      officeStart: '09:00',
      officeEnd: '17:00',
      graceMinutes: 15,
      earlyDepartureGraceMinutes: 15,
      minHoursFullDay: 6,
      minHoursHalfDay: 3,
      workingDays: [1, 2, 3, 4, 5],
    },
    SPORTS_COACH: {
      officeStart: '07:00',
      officeEnd: '14:00',
      graceMinutes: 15,
      earlyDepartureGraceMinutes: 15,
      minHoursFullDay: 5,
      minHoursHalfDay: 2.5,
      workingDays: [1, 2, 3, 4, 5, 6],
    },
  },
  excludeLeaveFromDenominator: true,
  leaveCountsAsPresent: false,
  countHolidays: false,
  countWeekends: false,
  halfDayWeight: 0.5,
  autoClassifyByHours: true,
  manualCorrectionRequiresApproval: false,
};

export const systemSettingsSchema = z.object({
  universityName: z.string().trim().min(2).max(200),
  unitName: z.string().trim().max(200),
  timezone: z.string().trim().min(1).max(64),
  dateFormat: z.enum(['dd MMM yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd']),
  reportFooter: z.string().trim().max(500),
  logoPath: z.string().nullable(),
  leaveMaxDaysPerRequest: z.number().int().min(1).max(365),
  leaveAllowBackdatedDays: z.number().int().min(0).max(60),
});
export type SystemSettings = z.infer<typeof systemSettingsSchema>;

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  universityName: 'Netaji Subhas University of Technology, Delhi',
  unitName: 'Office of the Registrar — Establishment Section',
  timezone: 'Asia/Kolkata',
  dateFormat: 'dd MMM yyyy',
  reportFooter: 'This is a system-generated report from NSUT Attendance & Presence. Verify against source records before official use.',
  logoPath: null,
  leaveMaxDaysPerRequest: 30,
  leaveAllowBackdatedDays: 7,
};

export function rulesFor(rules: AttendanceRules, type: PersonType): TypeRules {
  return rules.byType[type];
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Status a completed day should take based on hours worked (auto classification). */
export function classifyByDuration(durationMinutes: number, tr: TypeRules): 'PRESENT' | 'HALF_DAY' | 'ABSENT' {
  if (durationMinutes >= tr.minHoursFullDay * 60) return 'PRESENT';
  if (durationMinutes >= tr.minHoursHalfDay * 60) return 'HALF_DAY';
  return 'ABSENT';
}

/** Minutes late (0 if on time or within grace). `minuteOfDay` is local institutional time. */
export function lateMinutes(checkInMinuteOfDay: number, tr: TypeRules): number {
  const threshold = hhmmToMinutes(tr.officeStart) + tr.graceMinutes;
  return Math.max(0, checkInMinuteOfDay - threshold);
}

/** Minutes left before the permitted departure time (0 if not early). */
export function earlyDepartureMinutes(checkOutMinuteOfDay: number, tr: TypeRules): number {
  const threshold = hhmmToMinutes(tr.officeEnd) - tr.earlyDepartureGraceMinutes;
  return Math.max(0, threshold - checkOutMinuteOfDay);
}

// ---------------------------------------------------------------------------
// Attendance percentage
// ---------------------------------------------------------------------------

export interface DayInput {
  /** ISO date yyyy-MM-dd */
  date: string;
  /** ISO weekday 1..7 */
  weekday: number;
  isHoliday: boolean;
  /** Stored status or NOT_MARKED when there is no record. */
  status: AttendanceStatus;
  /** Is this day within the person's contract / joining window? */
  inContract: boolean;
  /** True for today (institutional TZ) — an unmarked today is "in progress", not absent. */
  isToday: boolean;
  /** True for future dates — never counted. */
  isFuture: boolean;
}

export type DayOutcome = 'COUNTED' | 'EXCLUDED';

export interface DayEvaluation {
  date: string;
  outcome: DayOutcome;
  /** Credit towards the numerator (0, halfDayWeight or 1) when counted. */
  credit: number;
  status: AttendanceStatus;
  reason: string;
}

export interface AttendanceSummary {
  eligibleDays: number;
  credits: number;
  present: number;
  absent: number;
  notMarked: number;
  leave: number;
  halfDays: number;
  holidays: number;
  /** null when there are no eligible days */
  percentage: number | null;
  days: DayEvaluation[];
}

export function evaluateDay(d: DayInput, tr: TypeRules, rules: AttendanceRules): DayEvaluation {
  const base = { date: d.date, status: d.status };
  if (d.isFuture) return { ...base, outcome: 'EXCLUDED', credit: 0, reason: 'Future date' };
  if (!d.inContract) return { ...base, outcome: 'EXCLUDED', credit: 0, reason: 'Outside contract period' };
  if (d.isToday && d.status === 'NOT_MARKED') return { ...base, outcome: 'EXCLUDED', credit: 0, reason: 'Today — not yet marked' };

  const attended = d.status === 'PRESENT' || d.status === 'HALF_DAY';
  const isWorkingWeekday = tr.workingDays.includes(d.weekday);

  if (!isWorkingWeekday && !rules.countWeekends && !attended) {
    return { ...base, outcome: 'EXCLUDED', credit: 0, reason: 'Non-working day' };
  }
  if ((d.isHoliday || d.status === 'HOLIDAY') && !rules.countHolidays && !attended) {
    return { ...base, outcome: 'EXCLUDED', credit: 0, reason: 'Holiday' };
  }

  switch (d.status) {
    case 'PRESENT':
      return { ...base, outcome: 'COUNTED', credit: 1, reason: 'Present' };
    case 'HALF_DAY':
      return { ...base, outcome: 'COUNTED', credit: rules.halfDayWeight, reason: 'Half day' };
    case 'LEAVE':
      if (rules.excludeLeaveFromDenominator) return { ...base, outcome: 'EXCLUDED', credit: 0, reason: 'Approved leave (excluded)' };
      return {
        ...base,
        outcome: 'COUNTED',
        credit: rules.leaveCountsAsPresent ? 1 : 0,
        reason: rules.leaveCountsAsPresent ? 'Approved leave (counted as present)' : 'Approved leave (counted as absent)',
      };
    case 'HOLIDAY':
      // Only reached when countHolidays = true: treated as a paid working day.
      return { ...base, outcome: 'COUNTED', credit: 1, reason: 'Holiday (counted)' };
    case 'ABSENT':
      return { ...base, outcome: 'COUNTED', credit: 0, reason: 'Absent' };
    case 'NOT_MARKED':
    default:
      return { ...base, outcome: 'COUNTED', credit: 0, reason: 'Not marked' };
  }
}

export function summarize(days: DayInput[], tr: TypeRules, rules: AttendanceRules): AttendanceSummary {
  const evaluated = days.map((d) => evaluateDay(d, tr, rules));
  const s: AttendanceSummary = {
    eligibleDays: 0,
    credits: 0,
    present: 0,
    absent: 0,
    notMarked: 0,
    leave: 0,
    halfDays: 0,
    holidays: 0,
    percentage: null,
    days: evaluated,
  };
  for (const e of evaluated) {
    // Status tallies count every non-future, in-contract record the officer would expect to see,
    // except unmarked non-working days.
    if (e.reason === 'Future date' || e.reason === 'Outside contract period' || e.reason === 'Today — not yet marked') continue;
    if (e.status === 'PRESENT') s.present++;
    else if (e.status === 'HALF_DAY') s.halfDays++;
    else if (e.status === 'LEAVE') s.leave++;
    else if (e.status === 'HOLIDAY' || (e.reason === 'Holiday')) s.holidays++;
    else if (e.status === 'ABSENT') s.absent++;
    else if (e.status === 'NOT_MARKED' && e.outcome === 'COUNTED') s.notMarked++;

    if (e.outcome === 'COUNTED') {
      s.eligibleDays++;
      s.credits += e.credit;
    }
  }
  s.percentage = s.eligibleDays > 0 ? round1((s.credits / s.eligibleDays) * 100) : null;
  return s;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Human-readable explanation of the percentage formula under the current rules. */
export function describeFormula(rules: AttendanceRules): string[] {
  const lines = [
    'Attendance % = Eligible credits ÷ Eligible working days × 100',
    `Present = 1 credit; Half Day = ${rules.halfDayWeight} credit; Absent / Not Marked = 0.`,
    rules.excludeLeaveFromDenominator
      ? 'Approved leave days are excluded from eligible working days.'
      : rules.leaveCountsAsPresent
        ? 'Approved leave days are counted and credited as present.'
        : 'Approved leave days are counted as working days with no credit.',
    rules.countHolidays ? 'Holidays are counted as working days (full credit).' : 'Holidays are excluded.',
    rules.countWeekends
      ? 'Non-working weekdays are counted as working days.'
      : 'Non-working weekdays are excluded unless the person attended.',
    'Days outside the contract period, future days, and today (until marked) are excluded.',
  ];
  return lines;
}
