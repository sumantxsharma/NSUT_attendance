import type { Request } from 'express';
import type pg from 'pg';
import { DateTime } from 'luxon';
import {
  classifyByDuration,
  datesBetween,
  datesInMonth,
  durationMinutes,
  earlyDepartureMinutes,
  isoWeekday,
  lateMinutes,
  localDateOf,
  localToInstant,
  minuteOfDay,
  rulesFor,
  summarize,
  todayIn,
  type AttendanceRules,
  type AttendanceStatus,
  type DayInput,
  type PersonType,
  type PresenceState,
  type StoredAttendanceStatus,
  type SystemSettings,
} from '@nsut/shared';
import { one, pool, query, tx, type Queryable } from '../db/pool';
import { audit, clientMeta } from '../lib/audit';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { notify, reviewersFor, superAdminIds, userIdForPerson } from '../lib/notify';
import { assertPersonVisible, peopleScopeSql } from '../lib/scope';
import { loadSettings } from '../lib/settings';
import { likePattern, Params } from '../lib/sql';

// ----------------------------------------------------------------------------- types

export interface AttendanceRow {
  id: string;
  person_id: string;
  date: string;
  status: StoredAttendanceStatus;
  check_in_at: Date | null;
  check_out_at: Date | null;
  duration_minutes: number | null;
  marking_method: string;
  remarks: string | null;
  marked_by: string | null;
  marked_by_name?: string | null;
  leave_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface PersonLite {
  id: string;
  ref_id: string;
  full_name: string;
  type: PersonType;
  status: 'ACTIVE' | 'INACTIVE';
  activity_id: string | null;
  activity_name: string | null;
  designation: string | null;
  joining_date: string | null;
  contract_start: string | null;
  contract_end: string | null;
  assigned_hours: number | null;
  photo_path: string | null;
}

export interface Filters {
  q?: string;
  type?: PersonType;
  activityId?: string;
  personId?: string;
  status?: string;
}

// ----------------------------------------------------------------------------- serialization

export function serializeRecord(r: AttendanceRow | null, type: PersonType, rules: AttendanceRules, tz: string) {
  if (!r) return null;
  const tr = rulesFor(rules, type);
  const late = r.check_in_at ? lateMinutes(minuteOfDay(r.check_in_at, tz), tr) : 0;
  const early = r.check_out_at ? earlyDepartureMinutes(minuteOfDay(r.check_out_at, tz), tr) : 0;
  return {
    id: r.id,
    personId: r.person_id,
    date: r.date,
    status: r.status as AttendanceStatus,
    checkInAt: r.check_in_at ? new Date(r.check_in_at).toISOString() : null,
    checkOutAt: r.check_out_at ? new Date(r.check_out_at).toISOString() : null,
    durationMinutes: r.duration_minutes,
    lateMinutes: late,
    isLate: late > 0,
    earlyMinutes: early,
    isEarlyDeparture: early > 0,
    isIncomplete: !!r.check_in_at && !r.check_out_at && r.date < todayIn(tz),
    markingMethod: r.marking_method,
    remarks: r.remarks,
    markedBy: r.marked_by,
    markedByName: r.marked_by_name ?? null,
    leaveId: r.leave_id,
    version: r.version,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}
export type SerializedRecord = NonNullable<ReturnType<typeof serializeRecord>>;

export function presenceOf(rec: SerializedRecord | null, isHoliday: boolean): PresenceState {
  if (!rec) return isHoliday ? 'HOLIDAY' : 'NOT_MARKED';
  if (rec.checkInAt && !rec.checkOutAt) return 'CURRENTLY_PRESENT';
  switch (rec.status) {
    case 'PRESENT':
      return rec.checkOutAt ? 'CHECKED_OUT' : 'CHECKED_OUT';
    case 'HALF_DAY':
      return 'HALF_DAY';
    case 'LEAVE':
      return 'ON_LEAVE';
    case 'HOLIDAY':
      return 'HOLIDAY';
    case 'ABSENT':
    default:
      return 'ABSENT';
  }
}

export function serializePerson(p: PersonLite) {
  return {
    id: p.id,
    refId: p.ref_id,
    fullName: p.full_name,
    type: p.type,
    status: p.status,
    activityId: p.activity_id,
    activityName: p.activity_name,
    designation: p.designation,
    joiningDate: p.joining_date,
    contractStart: p.contract_start,
    contractEnd: p.contract_end,
    assignedHours: p.assigned_hours,
    hasPhoto: !!p.photo_path,
  };
}

export const PERSON_SELECT = `
  p.id, p.ref_id, p.full_name, p.type, p.status,
  p.activity_id, a.name AS activity_name, p.designation, p.joining_date, p.contract_start, p.contract_end,
  p.assigned_hours, p.photo_path`;
export const PERSON_JOINS = `LEFT JOIN activities a ON a.id = p.activity_id`;

// ----------------------------------------------------------------------------- helpers

export function contractWindow(p: Pick<PersonLite, 'joining_date' | 'contract_start' | 'contract_end'>) {
  const starts = [p.joining_date, p.contract_start].filter(Boolean) as string[];
  return { from: starts.length ? starts.sort().at(-1)! : null, to: p.contract_end };
}

export function inContract(p: Pick<PersonLite, 'joining_date' | 'contract_start' | 'contract_end'>, date: string) {
  const w = contractWindow(p);
  return (!w.from || date >= w.from) && (!w.to || date <= w.to);
}

export async function holidaysBetween(from: string, to: string, client: Queryable = pool): Promise<Map<string, string>> {
  const rows = await query<{ date: string; name: string }>('SELECT date, name FROM holidays WHERE date BETWEEN $1 AND $2', [from, to], client);
  return new Map(rows.map((r) => [r.date, r.name]));
}

/** People visible to the caller with optional filters. `activeOn` limits to ACTIVE people or those with records in the range. */
export async function scopedPeople(req: Request, filters: Filters, opts: { includeInactiveWithRecords?: { from: string; to: string } } = {}) {
  const p = new Params();
  const where: string[] = ['p.deleted_at IS NULL', peopleScopeSql(req, p)];
  if (filters.type) where.push(`p.type = ${p.add(filters.type)}`);
  if (filters.activityId) where.push(`p.activity_id = ${p.add(filters.activityId)}`);
  if (filters.personId) where.push(`p.id = ${p.add(filters.personId)}`);
  if (filters.q) {
    const q = p.add(likePattern(filters.q));
    where.push(`(p.full_name ILIKE ${q} OR p.ref_id ILIKE ${q} OR a.name ILIKE ${q} OR a.category ILIKE ${q})`);
  }
  if (opts.includeInactiveWithRecords) {
    const { from, to } = opts.includeInactiveWithRecords;
    where.push(`(p.status = 'ACTIVE' OR EXISTS (SELECT 1 FROM attendance x WHERE x.person_id = p.id AND x.date BETWEEN ${p.add(from)} AND ${p.add(to)}))`);
  } else {
    where.push(`p.status = 'ACTIVE'`);
  }
  return query<PersonLite>(`SELECT ${PERSON_SELECT} FROM people p ${PERSON_JOINS} WHERE ${where.join(' AND ')} ORDER BY p.type, p.full_name`, p.values);
}

export async function recordsFor(personIds: string[], from: string, to: string, client: Queryable = pool) {
  if (personIds.length === 0) return [] as AttendanceRow[];
  return query<AttendanceRow>(
    `SELECT at.*, u.name AS marked_by_name FROM attendance at LEFT JOIN users u ON u.id = at.marked_by
     WHERE at.person_id = ANY($1::uuid[]) AND at.date BETWEEN $2 AND $3`,
    [personIds, from, to],
    client,
  );
}

// ----------------------------------------------------------------------------- daily sheet / live presence

export async function dailySheet(req: Request, date: string, filters: Filters) {
  const { rules, system } = await loadSettings();
  const tz = system.timezone;
  const today = todayIn(tz);
  const people = await scopedPeople(req, filters, { includeInactiveWithRecords: { from: date, to: date } });
  const recs = await recordsFor(
    people.map((x) => x.id),
    date,
    date,
  );
  const byPerson = new Map(recs.map((r) => [r.person_id, r]));
  const holidays = await holidaysBetween(date, date);
  const isHoliday = holidays.has(date);
  const weekday = isoWeekday(date);

  let rows = people
    .filter((p) => inContract(p, date) || byPerson.has(p.id))
    .map((p) => {
      const rec = serializeRecord(byPerson.get(p.id) ?? null, p.type, rules, tz);
      const tr = rulesFor(rules, p.type);
      const presence = presenceOf(rec, isHoliday);
      const liveMinutes =
        rec?.checkInAt && !rec.checkOutAt && date === today ? Math.max(0, Math.floor((Date.now() - Date.parse(rec.checkInAt)) / 60000)) : null;
      return {
        person: serializePerson(p),
        record: rec,
        status: (rec?.status ?? (isHoliday ? 'HOLIDAY' : 'NOT_MARKED')) as AttendanceStatus,
        presence,
        isWorkingDay: tr.workingDays.includes(weekday) && !isHoliday,
        expectedHours: `${tr.officeStart}–${tr.officeEnd}`,
        expectedMinutes: tr.minHoursFullDay * 60,
        currentMinutes: liveMinutes ?? rec?.durationMinutes ?? null,
      };
    });

  if (filters.status) {
    const s = filters.status;
    rows = rows.filter((r) => r.status === s || r.presence === s);
  }

  const counts = {
    total: rows.length,
    guestFaculty: rows.filter((r) => r.person.type === 'GUEST_FACULTY').length,
    sportsCoaches: rows.filter((r) => r.person.type === 'SPORTS_COACH').length,
    present: rows.filter((r) => r.status === 'PRESENT' || r.status === 'HALF_DAY' || r.presence === 'CURRENTLY_PRESENT').length,
    currentlyPresent: rows.filter((r) => r.presence === 'CURRENTLY_PRESENT').length,
    checkedOut: rows.filter((r) => r.presence === 'CHECKED_OUT').length,
    halfDay: rows.filter((r) => r.status === 'HALF_DAY').length,
    absent: rows.filter((r) => r.status === 'ABSENT' && r.presence !== 'CURRENTLY_PRESENT').length,
    onLeave: rows.filter((r) => r.status === 'LEAVE').length,
    notMarked: rows.filter((r) => r.status === 'NOT_MARKED' && r.isWorkingDay).length,
    late: rows.filter((r) => r.record?.isLate).length,
  };
  return { date, isToday: date === today, isHoliday, holidayName: holidays.get(date) ?? null, rows, counts, timezone: tz };
}

// ----------------------------------------------------------------------------- monthly

export function buildDays(
  p: PersonLite,
  dates: string[],
  recs: Map<string, AttendanceRow>,
  holidays: Map<string, string>,
  today: string,
): DayInput[] {
  return dates.map((date) => {
    const rec = recs.get(date);
    return {
      date,
      weekday: isoWeekday(date),
      isHoliday: holidays.has(date),
      status: (rec?.status ?? 'NOT_MARKED') as AttendanceStatus,
      inContract: inContract(p, date),
      isToday: date === today,
      isFuture: date > today,
    };
  });
}

export async function monthlySummary(req: Request, year: number, month: number, filters: Filters) {
  const { rules, system } = await loadSettings();
  const tz = system.timezone;
  const today = todayIn(tz);
  const dates = datesInMonth(year, month);
  const from = dates[0];
  const to = dates.at(-1)!;
  const people = await scopedPeople(req, filters, { includeInactiveWithRecords: { from, to } });
  const recs = await recordsFor(
    people.map((x) => x.id),
    from,
    to,
  );
  const holidays = await holidaysBetween(from, to);
  const byPerson = new Map<string, Map<string, AttendanceRow>>();
  for (const r of recs) {
    if (!byPerson.has(r.person_id)) byPerson.set(r.person_id, new Map());
    byPerson.get(r.person_id)!.set(r.date, r);
  }
  const rows = people.map((p) => {
    const tr = rulesFor(rules, p.type);
    const personRecs = byPerson.get(p.id) ?? new Map();
    const s = summarize(buildDays(p, dates, personRecs, holidays, today), tr, rules);
    let late = 0;
    let early = 0;
    let minutes = 0;
    for (const r of personRecs.values()) {
      const ser = serializeRecord(r, p.type, rules, tz)!;
      if (ser.isLate) late++;
      if (ser.isEarlyDeparture) early++;
      minutes += r.duration_minutes ?? 0;
    }
    const { days: _days, ...summary } = s;
    return { person: serializePerson(p), ...summary, late, earlyDepartures: early, totalMinutes: minutes };
  });
  return { year, month, from, to, rows, timezone: tz };
}

/** Aggregate attendance % across a set of people for a month (credits / eligible). */
export async function aggregatePercentage(req: Request, year: number, month: number, filters: Filters = {}) {
  const m = await monthlySummary(req, year, month, filters);
  const agg = (rows: typeof m.rows) => {
    const eligible = rows.reduce((s, r) => s + r.eligibleDays, 0);
    const credits = rows.reduce((s, r) => s + r.credits, 0);
    return { eligible, credits, percentage: eligible > 0 ? Math.round((credits / eligible) * 1000) / 10 : null };
  };
  return {
    overall: agg(m.rows),
    guestFaculty: agg(m.rows.filter((r) => r.person.type === 'GUEST_FACULTY')),
    sportsCoaches: agg(m.rows.filter((r) => r.person.type === 'SPORTS_COACH')),
    rows: m.rows,
  };
}

// ----------------------------------------------------------------------------- person calendar

export async function personMonth(req: Request, personId: string, year: number, month: number) {
  await assertPersonVisible(req, personId);
  const { rules, system } = await loadSettings();
  const tz = system.timezone;
  const today = todayIn(tz);
  const person = await one<PersonLite>(`SELECT ${PERSON_SELECT} FROM people p ${PERSON_JOINS} WHERE p.id = $1`, [personId]);
  if (!person) throw notFound('Person');
  const dates = datesInMonth(year, month);
  const recs = await recordsFor([personId], dates[0], dates.at(-1)!);
  const recMap = new Map(recs.map((r) => [r.date, r]));
  const holidays = await holidaysBetween(dates[0], dates.at(-1)!);
  const tr = rulesFor(rules, person.type);
  const dayInputs = buildDays(person, dates, recMap, holidays, today);
  const summary = summarize(dayInputs, tr, rules);
  const leaves = await query(
    `SELECT id, from_date, to_date, leave_type, status FROM leaves WHERE person_id = $1 AND from_date <= $3 AND to_date >= $2 AND status IN ('PENDING','APPROVED')`,
    [personId, dates[0], dates.at(-1)!],
  );
  const days = dayInputs.map((d, i) => {
    const rec = serializeRecord(recMap.get(d.date) ?? null, person.type, rules, tz);
    return {
      date: d.date,
      weekday: d.weekday,
      isWorkingDay: tr.workingDays.includes(d.weekday),
      isHoliday: d.isHoliday,
      holidayName: holidays.get(d.date) ?? null,
      isToday: d.isToday,
      isFuture: d.isFuture,
      inContract: d.inContract,
      status: (rec?.status ?? (d.isHoliday ? 'HOLIDAY' : 'NOT_MARKED')) as AttendanceStatus,
      record: rec,
      evaluation: { outcome: summary.days[i].outcome, credit: summary.days[i].credit, reason: summary.days[i].reason },
      pendingLeave: leaves.some((l: any) => l.status === 'PENDING' && l.from_date <= d.date && l.to_date >= d.date),
    };
  });
  const { days: _d, ...totals } = summary;
  return { person: serializePerson(person), year, month, days, summary: totals, rules: tr, timezone: tz };
}

// ----------------------------------------------------------------------------- self check-in / check-out

async function personForSelf(req: Request, client: Queryable) {
  const personId = req.auth!.user.personId;
  if (!personId) throw forbidden('Your account is not linked to a Guest Faculty / Coach profile.');
  const person = await one<PersonLite>(`SELECT ${PERSON_SELECT} FROM people p ${PERSON_JOINS} WHERE p.id = $1 AND p.deleted_at IS NULL`, [personId], client);
  if (!person) throw notFound('Profile');
  if (person.status !== 'ACTIVE') throw forbidden('Your profile is inactive. Please contact the administration.');
  return person;
}

export async function myToday(req: Request) {
  const { rules, system } = await loadSettings();
  const tz = system.timezone;
  const person = await personForSelf(req, pool);
  const today = todayIn(tz);
  const rec = await one<AttendanceRow>('SELECT * FROM attendance WHERE person_id = $1 AND date = $2', [person.id, today]);
  const holidays = await holidaysBetween(today, today);
  const tr = rulesFor(rules, person.type);
  const onLeave = await one(`SELECT id FROM leaves WHERE person_id = $1 AND status = 'APPROVED' AND $2 BETWEEN from_date AND to_date`, [person.id, today]);
  const ser = serializeRecord(rec, person.type, rules, tz);
  return {
    date: today,
    serverTime: new Date().toISOString(),
    timezone: tz,
    person: serializePerson(person),
    record: ser,
    presence: presenceOf(ser, holidays.has(today)),
    isHoliday: holidays.has(today),
    holidayName: holidays.get(today) ?? null,
    isWorkingDay: tr.workingDays.includes(isoWeekday(today)),
    onApprovedLeave: !!onLeave,
    rules: tr,
    canCheckIn: !rec && !onLeave,
    canCheckOut: !!rec?.check_in_at && !rec.check_out_at,
  };
}

export async function checkIn(req: Request) {
  const { rules, system } = await loadSettings();
  const tz = system.timezone;
  return tx(async (c) => {
    const person = await personForSelf(req, c);
    const now = new Date();
    const date = localDateOf(now, tz);
    if (!inContract(person, date)) throw forbidden('Your contract period does not include today.');
    const leave = await one(`SELECT id FROM leaves WHERE person_id = $1 AND status = 'APPROVED' AND $2 BETWEEN from_date AND to_date`, [person.id, date], c);
    if (leave) throw conflict('You are on approved leave today. Contact your coordinator if you have returned.');
    // Lock the person row so concurrent double-clicks serialize.
    await c.query('SELECT id FROM people WHERE id = $1 FOR UPDATE', [person.id]);
    const existing = await one<AttendanceRow>('SELECT * FROM attendance WHERE person_id = $1 AND date = $2', [person.id, date], c);
    if (existing) {
      if (existing.check_out_at) throw conflict('You have already checked out today. Attendance cannot be marked again.');
      throw conflict('Attendance has already been marked for today.');
    }
    const meta = clientMeta(req);
    const row = await one<AttendanceRow>(
      `INSERT INTO attendance (person_id, date, status, check_in_at, marking_method, marked_by, client_ip, client_agent)
       VALUES ($1, $2, 'PRESENT', $3, 'SELF', $4, $5, $6) RETURNING *`,
      [person.id, date, now, req.auth!.user.id, meta.ip, meta.ua],
      c,
    );
    const ser = serializeRecord(row!, person.type, rules, tz)!;
    await audit(
      { action: 'ATTENDANCE_CHECK_IN', entityType: 'attendance', entityId: row!.id, summary: `${person.full_name} checked in`, newValue: ser },
      req,
      c,
    );
    if (ser.isLate) {
      await notify(
        {
          userIds: await reviewersFor(person.id, c).then((ids) => ids),
          type: 'LATE_ARRIVAL',
          title: `Late arrival: ${person.full_name}`,
          body: `Checked in ${ser.lateMinutes} min after the grace period.`,
          link: `/people/${person.id}`,
        },
        c,
      ).catch(() => undefined);
    }
    return ser;
  });
}

export async function checkOut(req: Request) {
  const { rules, system } = await loadSettings();
  const tz = system.timezone;
  return tx(async (c) => {
    const person = await personForSelf(req, c);
    const now = new Date();
    const date = localDateOf(now, tz);
    const existing = await one<AttendanceRow>('SELECT * FROM attendance WHERE person_id = $1 AND date = $2 FOR UPDATE', [person.id, date], c);
    if (!existing || !existing.check_in_at) throw badRequest('You cannot check out before checking in.');
    if (existing.check_out_at) throw conflict('You have already checked out today.');
    if (now < new Date(existing.check_in_at)) throw badRequest('Check-out time cannot be before check-in time.');
    const tr = rulesFor(rules, person.type);
    const dur = durationMinutes(existing.check_in_at, now);
    const status = rules.autoClassifyByHours ? classifyByDuration(dur, tr) : 'PRESENT';
    const before = serializeRecord(existing, person.type, rules, tz);
    const row = await one<AttendanceRow>(
      `UPDATE attendance SET check_out_at = $2, duration_minutes = $3, status = $4, version = version + 1 WHERE id = $1 RETURNING *`,
      [existing.id, now, dur, status],
      c,
    );
    const ser = serializeRecord(row!, person.type, rules, tz)!;
    await audit(
      {
        action: 'ATTENDANCE_CHECK_OUT',
        entityType: 'attendance',
        entityId: row!.id,
        summary: `${person.full_name} checked out`,
        oldValue: before,
        newValue: ser,
      },
      req,
      c,
    );
    return ser;
  });
}

// ----------------------------------------------------------------------------- manual marking & corrections

function buildTimes(date: string, checkIn: string | null | undefined, checkOut: string | null | undefined, tz: string) {
  const inAt = checkIn ? localToInstant(date, checkIn, tz) : null;
  const outAt = checkOut ? localToInstant(date, checkOut, tz) : null;
  if (outAt && !inAt) throw badRequest('You cannot record a check-out without a check-in.');
  if (inAt && outAt && outAt <= inAt) throw badRequest('Out-time must be after in-time.');
  const now = new Date();
  if ((inAt && inAt > now) || (outAt && outAt > now)) throw badRequest('Attendance times cannot be in the future.');
  return { inAt, outAt, duration: inAt && outAt ? durationMinutes(inAt, outAt) : null };
}

function assertDateAllowed(date: string, system: SystemSettings) {
  const today = todayIn(system.timezone);
  if (date > today) throw badRequest('Attendance cannot be marked for a future date.');
  const oldest = DateTime.fromISO(today).minus({ days: 400 }).toISODate()!;
  if (date < oldest) throw badRequest('This date is too far in the past to mark attendance.');
}

export interface ManualInput {
  personId: string;
  date: string;
  status: StoredAttendanceStatus;
  checkIn?: string | null;
  checkOut?: string | null;
  remarks?: string | null;
}

export async function manualMark(req: Request, input: ManualInput) {
  const { rules, system } = await loadSettings();
  const tz = system.timezone;
  await assertPersonVisible(req, input.personId);
  assertDateAllowed(input.date, system);
  const times = buildTimes(input.date, input.checkIn, input.checkOut, tz);
  if (input.status === 'LEAVE') throw badRequest('Leave is recorded through the Leave module so it has an approval trail.');
  return tx(async (c) => {
    const person = await one<PersonLite>(`SELECT ${PERSON_SELECT} FROM people p ${PERSON_JOINS} WHERE p.id = $1`, [input.personId], c);
    if (!person) throw notFound('Person');
    if (person.status !== 'ACTIVE') throw badRequest('This person is inactive. Reactivate the profile before marking attendance.');
    const existing = await one('SELECT id FROM attendance WHERE person_id = $1 AND date = $2', [input.personId, input.date], c);
    if (existing) throw conflict('Attendance has already been marked for this person on this date. Use “Correct” to change it.', { attendanceId: existing.id });
    const row = await one<AttendanceRow>(
      `INSERT INTO attendance (person_id, date, status, check_in_at, check_out_at, duration_minutes, marking_method, remarks, marked_by)
       VALUES ($1,$2,$3,$4,$5,$6,'MANUAL',$7,$8) RETURNING *`,
      [input.personId, input.date, input.status, times.inAt, times.outAt, times.duration, input.remarks ?? null, req.auth!.user.id],
      c,
    );
    const ser = serializeRecord(row!, person.type, rules, tz)!;
    await audit(
      {
        action: 'ATTENDANCE_CREATE',
        entityType: 'attendance',
        entityId: row!.id,
        summary: `Marked ${person.full_name} as ${input.status} for ${input.date}`,
        newValue: { ...ser, personName: person.full_name },
        reason: input.remarks ?? null,
      },
      req,
      c,
    );
    return ser;
  });
}

export interface CorrectionInput {
  status: StoredAttendanceStatus;
  checkIn?: string | null;
  checkOut?: string | null;
  remarks?: string | null;
  reason: string;
  version?: number;
}

async function applyCorrectionValues(
  c: pg.PoolClient,
  existing: AttendanceRow,
  person: PersonLite,
  input: Omit<CorrectionInput, 'reason'>,
  tz: string,
  userId: string,
) {
  const times = buildTimes(existing.date, input.checkIn, input.checkOut, tz);
  if (input.status === 'LEAVE' && existing.status !== 'LEAVE') throw badRequest('Leave is recorded through the Leave module so it has an approval trail.');
  const row = await one<AttendanceRow>(
    `UPDATE attendance SET status = $2::attendance_status, check_in_at = $3, check_out_at = $4, duration_minutes = $5, remarks = $6,
       marked_by = $7, marking_method = CASE WHEN marking_method = 'LEAVE_SYNC' AND $2::attendance_status = 'LEAVE' THEN marking_method ELSE 'MANUAL' END,
       leave_id = CASE WHEN $2::attendance_status = 'LEAVE' THEN leave_id ELSE NULL END, version = version + 1
     WHERE id = $1 RETURNING *`,
    [existing.id, input.status, times.inAt, times.outAt, times.duration, input.remarks ?? existing.remarks, userId],
    c,
  );
  void person;
  return row!;
}

export async function correctAttendance(req: Request, attendanceId: string, input: CorrectionInput) {
  const { rules, system } = await loadSettings();
  const tz = system.timezone;
  const existingPre = await one<AttendanceRow>('SELECT * FROM attendance WHERE id = $1', [attendanceId]);
  if (!existingPre) throw notFound('Attendance record');
  await assertPersonVisible(req, existingPre.person_id);
  // Validate times up-front for a clean error even when routing to approval.
  buildTimes(existingPre.date, input.checkIn, input.checkOut, tz);

  return tx(async (c) => {
    const existing = await one<AttendanceRow>('SELECT * FROM attendance WHERE id = $1 FOR UPDATE', [attendanceId], c);
    if (!existing) throw notFound('Attendance record');
    if (input.version !== undefined && input.version !== existing.version) {
      throw conflict('This record was changed by someone else while you were editing. Reload and try again.');
    }
    const person = (await one<PersonLite>(`SELECT ${PERSON_SELECT} FROM people p ${PERSON_JOINS} WHERE p.id = $1`, [existing.person_id], c))!;
    const before = serializeRecord(existing, person.type, rules, tz)!;
    const proposed = { status: input.status, checkIn: input.checkIn ?? null, checkOut: input.checkOut ?? null, remarks: input.remarks ?? null };
    const needsApproval = rules.manualCorrectionRequiresApproval && req.auth!.user.role !== 'SUPER_ADMIN';

    if (needsApproval) {
      const corr = await one(
        `INSERT INTO attendance_corrections (attendance_id, person_id, date, previous_value, proposed_value, reason, status, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7) RETURNING id`,
        [existing.id, existing.person_id, existing.date, JSON.stringify(before), JSON.stringify(proposed), input.reason, req.auth!.user.id],
        c,
      );
      await audit(
        {
          action: 'ATTENDANCE_CORRECTION_REQUESTED',
          entityType: 'attendance',
          entityId: existing.id,
          summary: `Correction requested for ${person.full_name} on ${existing.date}`,
          oldValue: before,
          newValue: proposed,
          reason: input.reason,
        },
        req,
        c,
      );
      await notify(
        {
          userIds: await superAdminIds(c),
          type: 'CORRECTION_PENDING',
          title: 'Attendance correction awaiting approval',
          body: `${person.full_name} — ${existing.date}`,
          link: '/attendance/corrections',
        },
        c,
      );
      return { pendingApproval: true, correctionId: corr!.id, record: before };
    }

    const row = await applyCorrectionValues(c, existing, person, proposed, tz, req.auth!.user.id);
    const after = serializeRecord(row, person.type, rules, tz)!;
    await c.query(
      `INSERT INTO attendance_corrections (attendance_id, person_id, date, previous_value, proposed_value, reason, status, requested_by, reviewed_by, reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'APPLIED',$7,$7, now())`,
      [existing.id, existing.person_id, existing.date, JSON.stringify(before), JSON.stringify(after), input.reason, req.auth!.user.id],
    );
    await audit(
      {
        action: 'ATTENDANCE_UPDATE',
        entityType: 'attendance',
        entityId: existing.id,
        summary: `Corrected ${person.full_name} on ${existing.date}`,
        oldValue: before,
        newValue: after,
        reason: input.reason,
      },
      req,
      c,
    );
    const staffUser = await userIdForPerson(person.id, c);
    if (staffUser)
      await notify(
        { userIds: [staffUser], type: 'ATTENDANCE_CORRECTED', title: `Your attendance for ${existing.date} was corrected`, body: input.reason, link: '/me' },
        c,
      );
    return { pendingApproval: false, record: after };
  });
}

export async function reviewCorrection(req: Request, correctionId: string, approve: boolean, remarks: string | null) {
  const { rules, system } = await loadSettings();
  const tz = system.timezone;
  return tx(async (c) => {
    const corr = await one<any>('SELECT * FROM attendance_corrections WHERE id = $1 FOR UPDATE', [correctionId], c);
    if (!corr) throw notFound('Correction request');
    if (corr.status !== 'PENDING') throw conflict('This correction has already been reviewed.');
    if (corr.requested_by === req.auth!.user.id) throw forbidden('You cannot approve your own correction request.');
    const person = (await one<PersonLite>(`SELECT ${PERSON_SELECT} FROM people p ${PERSON_JOINS} WHERE p.id = $1`, [corr.person_id], c))!;
    let after: SerializedRecord | null = null;
    if (approve) {
      const existing = await one<AttendanceRow>('SELECT * FROM attendance WHERE id = $1 FOR UPDATE', [corr.attendance_id], c);
      if (!existing) throw conflict('The original attendance record no longer exists.');
      const row = await applyCorrectionValues(c, existing, person, corr.proposed_value, tz, corr.requested_by);
      after = serializeRecord(row, person.type, rules, tz);
    }
    await c.query(`UPDATE attendance_corrections SET status = $2, reviewed_by = $3, reviewed_at = now(), review_remarks = $4 WHERE id = $1`, [
      correctionId,
      approve ? 'APPLIED' : 'REJECTED',
      req.auth!.user.id,
      remarks,
    ]);
    await audit(
      {
        action: approve ? 'ATTENDANCE_CORRECTION_APPROVED' : 'ATTENDANCE_CORRECTION_REJECTED',
        entityType: 'attendance',
        entityId: corr.attendance_id,
        summary: `${approve ? 'Approved' : 'Rejected'} correction for ${person.full_name} on ${corr.date}`,
        oldValue: corr.previous_value,
        newValue: after ?? corr.proposed_value,
        reason: remarks ?? corr.reason,
      },
      req,
      c,
    );
    if (corr.requested_by)
      await notify(
        {
          userIds: [corr.requested_by],
          type: 'ATTENDANCE_CORRECTED',
          title: `Correction ${approve ? 'approved' : 'rejected'}: ${person.full_name}, ${corr.date}`,
          body: remarks ?? undefined,
          link: `/people/${person.id}`,
        },
        c,
      );
    return { status: approve ? 'APPLIED' : 'REJECTED', record: after };
  });
}

export async function deleteAttendance(req: Request, attendanceId: string, reason: string) {
  const { rules, system } = await loadSettings();
  return tx(async (c) => {
    const existing = await one<AttendanceRow>('SELECT * FROM attendance WHERE id = $1 FOR UPDATE', [attendanceId], c);
    if (!existing) throw notFound('Attendance record');
    if (existing.marking_method === 'LEAVE_SYNC') throw badRequest('This record comes from approved leave. Cancel the leave instead.');
    const person = (await one<PersonLite>(`SELECT ${PERSON_SELECT} FROM people p ${PERSON_JOINS} WHERE p.id = $1`, [existing.person_id], c))!;
    const before = serializeRecord(existing, person.type, rules, system.timezone);
    await c.query('UPDATE attendance_corrections SET attendance_id = NULL WHERE attendance_id = $1', [attendanceId]);
    await c.query('DELETE FROM attendance WHERE id = $1', [attendanceId]);
    await c.query(
      `INSERT INTO attendance_corrections (attendance_id, person_id, date, previous_value, proposed_value, reason, status, requested_by, reviewed_by, reviewed_at)
       VALUES (NULL,$1,$2,$3,$4,$5,'APPLIED',$6,$6, now())`,
      [existing.person_id, existing.date, JSON.stringify(before), JSON.stringify({ deleted: true }), reason, req.auth!.user.id],
    );
    await audit(
      {
        action: 'ATTENDANCE_DELETE',
        entityType: 'attendance',
        entityId: attendanceId,
        summary: `Deleted attendance for ${person.full_name} on ${existing.date}`,
        oldValue: before,
        reason,
      },
      req,
      c,
    );
    return { deleted: true };
  });
}

export async function listCorrections(req: Request, status: string | undefined, personId?: string) {
  const p = new Params();
  const where = [peopleScopeSql(req, p)];
  if (status) where.push(`c.status = ${p.add(status)}`);
  if (personId) where.push(`c.person_id = ${p.add(personId)}`);
  return query(
    `SELECT c.id, c.attendance_id AS "attendanceId", c.person_id AS "personId", p.full_name AS "personName", p.ref_id AS "refId",
            c.date, c.previous_value AS "previous", c.proposed_value AS "proposed", c.reason, c.status,
            c.requested_at AS "requestedAt", ru.name AS "requestedBy", c.requested_by AS "requestedById",
            c.reviewed_at AS "reviewedAt", vu.name AS "reviewedBy", c.review_remarks AS "reviewRemarks"
     FROM attendance_corrections c JOIN people p ON p.id = c.person_id
     LEFT JOIN users ru ON ru.id = c.requested_by LEFT JOIN users vu ON vu.id = c.reviewed_by
     WHERE ${where.join(' AND ')} ORDER BY c.requested_at DESC LIMIT 200`,
    p.values,
  );
}

export { datesBetween, AppError };
