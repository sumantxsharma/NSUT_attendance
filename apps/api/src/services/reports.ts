import type { Request } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import {
  ATTENDANCE_STATUS_LABELS,
  datesBetween,
  describeFormula,
  evaluateDay,
  formatDateLocal,
  formatDuration,
  formatTimeLocal,
  isoDate,
  LEAVE_TYPE_LABELS,
  PERSON_TYPE_LABELS,
  PERSON_TYPES,
  REPORT_LABELS,
  rulesFor,
  todayIn,
  uuid,
  type AttendanceStatus,
  type LeaveType,
  type ReportType,
} from '@nsut/shared';
import { one } from '../db/pool';
import { badRequest } from '../lib/errors';
import { loadSettings } from '../lib/settings';
import { buildDays, dailySheet, holidaysBetween, monthlySummary, personMonth, recordsFor, scopedPeople, serializeRecord, type Filters } from './attendance';
import { listLeaves } from './leave';

export interface ReportColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: number;
}
export interface Report {
  type: ReportType;
  title: string;
  period: string;
  filters: { label: string; value: string }[];
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  summary: { label: string; value: string }[];
  notes: string[];
  meta: { university: string; unit: string; generatedAt: string; generatedBy: string; timezone: string; footer: string; logoPath: string | null };
}

export const reportQuerySchema = z.object({
  date: isoDate.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  personId: uuid.optional(),
  type: z.enum(PERSON_TYPES).optional(),
  activityId: uuid.optional(),
  status: z.string().max(30).optional(),
  q: z.string().max(100).optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);
const unitOf = (r: { activityName?: string | null }) => r.activityName ?? '—';

async function describeFilters(q: ReportQuery) {
  const out: { label: string; value: string }[] = [];
  if (q.type) out.push({ label: 'Person type', value: PERSON_TYPE_LABELS[q.type] });
  if (q.activityId) {
    const a = await one('SELECT name FROM activities WHERE id = $1', [q.activityId]);
    out.push({ label: 'Sport / Activity', value: a?.name ?? 'Unknown' });
  }
  if (q.personId) {
    const p = await one('SELECT full_name, ref_id FROM people WHERE id = $1', [q.personId]);
    out.push({ label: 'Person', value: p ? `${p.full_name} (${p.ref_id})` : 'Unknown' });
  }
  if (q.status) out.push({ label: 'Status', value: (ATTENDANCE_STATUS_LABELS as any)[q.status] ?? q.status });
  if (q.q) out.push({ label: 'Search', value: q.q });
  if (out.length === 0) out.push({ label: 'Filters', value: 'None (all records within your access)' });
  return out;
}

function resolveMonth(q: ReportQuery, tz: string) {
  const now = DateTime.now().setZone(tz);
  return { year: q.year ?? now.year, month: q.month ?? now.month };
}

function resolveRange(q: ReportQuery, tz: string, capToToday = true) {
  const now = DateTime.now().setZone(tz);
  let from = q.from;
  let to = q.to;
  if (!from || !to) {
    const { year, month } = resolveMonth(q, tz);
    const s = DateTime.fromObject({ year, month, day: 1 });
    from = from ?? s.toISODate()!;
    to = to ?? s.endOf('month').toISODate()!;
  }
  const today = now.toISODate()!;
  if (capToToday && to > today) to = today;
  if (from > to) throw badRequest('The start date must be on or before the end date.');
  if (datesBetween(from, to).length > 366) throw badRequest('Please choose a range of at most one year.');
  return { from, to };
}

const filtersOf = (q: ReportQuery): Filters => ({ type: q.type, activityId: q.activityId, personId: q.personId, q: q.q });

export async function buildReport(req: Request, type: ReportType, q: ReportQuery): Promise<Report> {
  const { rules, system } = await loadSettings();
  const tz = system.timezone;
  const fmt = system.dateFormat;
  const base = {
    type,
    title: REPORT_LABELS[type],
    filters: await describeFilters(q),
    notes: [] as string[],
    meta: {
      university: system.universityName,
      unit: system.unitName,
      generatedAt: DateTime.now().setZone(tz).toFormat('dd MMM yyyy, hh:mm a') + ` (${tz})`,
      generatedBy: `${req.auth!.user.name} (${req.auth!.user.email})`,
      timezone: tz,
      footer: system.reportFooter,
      logoPath: system.logoPath,
    },
  };

  switch (type) {
    case 'daily': {
      const date = q.date ?? todayIn(tz);
      const sheet = await dailySheet(req, date, { ...filtersOf(q), status: q.status });
      return {
        ...base,
        period: formatDateLocal(date, `cccc, ${fmt}`) + (sheet.isHoliday ? ` — Holiday: ${sheet.holidayName}` : ''),
        columns: [
          { key: 'refId', label: 'Ref. ID', width: 70 },
          { key: 'name', label: 'Name', width: 130 },
          { key: 'type', label: 'Type', width: 80 },
          { key: 'unit', label: 'Sport / Activity', width: 130 },
          { key: 'status', label: 'Status', width: 80 },
          { key: 'in', label: 'In-Time', align: 'center', width: 60 },
          { key: 'out', label: 'Out-Time', align: 'center', width: 60 },
          { key: 'duration', label: 'Duration', align: 'right', width: 60 },
          { key: 'late', label: 'Late (min)', align: 'right', width: 55 },
          { key: 'remarks', label: 'Remarks', width: 120 },
        ],
        rows: sheet.rows.map((r) => ({
          refId: r.person.refId,
          name: r.person.fullName,
          type: PERSON_TYPE_LABELS[r.person.type],
          unit: unitOf(r.person),
          status: r.presence === 'CURRENTLY_PRESENT' ? 'Present (in)' : ATTENDANCE_STATUS_LABELS[r.status],
          in: formatTimeLocal(r.record?.checkInAt, tz),
          out: formatTimeLocal(r.record?.checkOutAt, tz),
          duration: formatDuration(r.record?.durationMinutes),
          late: r.record?.isLate ? r.record.lateMinutes : null,
          remarks: r.record?.remarks ?? '',
        })),
        summary: [
          { label: 'Total personnel', value: String(sheet.counts.total) },
          { label: 'Present (incl. half day)', value: String(sheet.counts.present) },
          { label: 'Absent', value: String(sheet.counts.absent) },
          { label: 'On leave', value: String(sheet.counts.onLeave) },
          { label: 'Not marked', value: String(sheet.counts.notMarked) },
          { label: 'Late arrivals', value: String(sheet.counts.late) },
        ],
      };
    }

    case 'monthly': {
      const { year, month } = resolveMonth(q, tz);
      const m = await monthlySummary(req, year, month, filtersOf(q));
      const elig = m.rows.reduce((s, r) => s + r.eligibleDays, 0);
      const cred = m.rows.reduce((s, r) => s + r.credits, 0);
      return {
        ...base,
        period: DateTime.fromObject({ year, month }).toFormat('MMMM yyyy'),
        columns: [
          { key: 'refId', label: 'Ref. ID', width: 70 },
          { key: 'name', label: 'Name', width: 130 },
          { key: 'type', label: 'Type', width: 80 },
          { key: 'unit', label: 'Sport / Activity', width: 130 },
          { key: 'working', label: 'Working Days', align: 'right', width: 55 },
          { key: 'present', label: 'Present', align: 'right', width: 50 },
          { key: 'half', label: 'Half Days', align: 'right', width: 50 },
          { key: 'absent', label: 'Absent', align: 'right', width: 50 },
          { key: 'notMarked', label: 'Not Marked', align: 'right', width: 55 },
          { key: 'leave', label: 'Leave', align: 'right', width: 45 },
          { key: 'late', label: 'Late', align: 'right', width: 40 },
          { key: 'pct', label: 'Attendance %', align: 'right', width: 65 },
        ],
        rows: m.rows.map((r) => ({
          refId: r.person.refId,
          name: r.person.fullName,
          type: PERSON_TYPE_LABELS[r.person.type],
          unit: unitOf(r.person),
          working: r.eligibleDays,
          present: r.present,
          half: r.halfDays,
          absent: r.absent,
          notMarked: r.notMarked,
          leave: r.leave,
          late: r.late,
          pct: pct(r.percentage),
        })),
        summary: [
          { label: 'Personnel', value: String(m.rows.length) },
          { label: 'Eligible person-days', value: String(elig) },
          { label: 'Credited days', value: String(cred) },
          { label: 'Overall attendance', value: pct(elig ? Math.round((cred / elig) * 1000) / 10 : null) },
        ],
        notes: describeFormula(rules),
      };
    }

    case 'individual': {
      if (!q.personId) throw badRequest('Select a person for the individual report.');
      const { year, month } = resolveMonth(q, tz);
      const pm = await personMonth(req, q.personId, year, month);
      return {
        ...base,
        title: `${REPORT_LABELS.individual} — ${pm.person.fullName}`,
        period: DateTime.fromObject({ year, month }).toFormat('MMMM yyyy'),
        columns: [
          { key: 'date', label: 'Date', width: 80 },
          { key: 'day', label: 'Day', width: 40 },
          { key: 'status', label: 'Status', width: 80 },
          { key: 'in', label: 'In-Time', align: 'center', width: 60 },
          { key: 'out', label: 'Out-Time', align: 'center', width: 60 },
          { key: 'duration', label: 'Duration', align: 'right', width: 60 },
          { key: 'late', label: 'Late (min)', align: 'right', width: 55 },
          { key: 'early', label: 'Early (min)', align: 'right', width: 55 },
          { key: 'counted', label: 'Counted as', width: 150 },
          { key: 'remarks', label: 'Remarks', width: 140 },
        ],
        rows: pm.days
          .filter((d) => !d.isFuture)
          .map((d) => ({
            date: formatDateLocal(d.date, fmt),
            day: DateTime.fromISO(d.date).toFormat('ccc'),
            status: d.isHoliday && !d.record ? `Holiday` : ATTENDANCE_STATUS_LABELS[d.status],
            in: formatTimeLocal(d.record?.checkInAt, tz),
            out: formatTimeLocal(d.record?.checkOutAt, tz),
            duration: formatDuration(d.record?.durationMinutes),
            late: d.record?.isLate ? d.record.lateMinutes : null,
            early: d.record?.isEarlyDeparture ? d.record.earlyMinutes : null,
            counted: d.evaluation.outcome === 'COUNTED' ? `${d.evaluation.credit} credit` : `Excluded: ${d.evaluation.reason}`,
            remarks: d.holidayName ?? d.record?.remarks ?? '',
          })),
        summary: [
          { label: 'Person', value: `${pm.person.fullName} (${pm.person.refId})` },
          { label: 'Type', value: PERSON_TYPE_LABELS[pm.person.type] },
          { label: 'Sport / Activity', value: unitOf(pm.person) },
          { label: 'Working days', value: String(pm.summary.eligibleDays) },
          { label: 'Present', value: String(pm.summary.present) },
          { label: 'Half days', value: String(pm.summary.halfDays) },
          { label: 'Absent', value: String(pm.summary.absent) },
          { label: 'Not marked', value: String(pm.summary.notMarked) },
          { label: 'Leave', value: String(pm.summary.leave) },
          { label: 'Attendance', value: pct(pm.summary.percentage) },
        ],
        notes: describeFormula(rules),
      };
    }

    case 'activity': {
      const { year, month } = resolveMonth(q, tz);
      const m = await monthlySummary(req, year, month, filtersOf(q));
      const groups = new Map<string, typeof m.rows>();
      for (const r of m.rows) {
        const key = r.person.activityName ?? 'Unassigned';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      }
      const rows = [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, rs]) => {
          const elig = rs.reduce((s, r) => s + r.eligibleDays, 0);
          const cred = rs.reduce((s, r) => s + r.credits, 0);
          return {
            unit: name,
            people: rs.length,
            working: elig,
            present: rs.reduce((s, r) => s + r.present, 0),
            half: rs.reduce((s, r) => s + r.halfDays, 0),
            absent: rs.reduce((s, r) => s + r.absent + r.notMarked, 0),
            leave: rs.reduce((s, r) => s + r.leave, 0),
            late: rs.reduce((s, r) => s + r.late, 0),
            pct: pct(elig ? Math.round((cred / elig) * 1000) / 10 : null),
            below75: rs.filter((r) => r.percentage !== null && r.percentage < 75).length,
          };
        });
      return {
        ...base,
        period: DateTime.fromObject({ year, month }).toFormat('MMMM yyyy'),
        columns: [
          { key: 'unit', label: 'Sport / Activity', width: 170 },
          { key: 'people', label: 'Personnel', align: 'right', width: 60 },
          { key: 'working', label: 'Person-days', align: 'right', width: 65 },
          { key: 'present', label: 'Present', align: 'right', width: 55 },
          { key: 'half', label: 'Half Days', align: 'right', width: 55 },
          { key: 'absent', label: 'Absent / Unmarked', align: 'right', width: 75 },
          { key: 'leave', label: 'Leave', align: 'right', width: 50 },
          { key: 'late', label: 'Late', align: 'right', width: 45 },
          { key: 'pct', label: 'Attendance %', align: 'right', width: 70 },
          { key: 'below75', label: 'Below 75%', align: 'right', width: 60 },
        ],
        rows,
        summary: [
          { label: 'Sports / activities', value: String(rows.length) },
          { label: 'Personnel', value: String(m.rows.length) },
        ],
        notes: describeFormula(rules),
      };
    }

    case 'absence':
    case 'late':
    case 'early':
    case 'incomplete': {
      const { from, to } = resolveRange(q, tz);
      const today = todayIn(tz);
      const people = await scopedPeople(req, filtersOf(q), { includeInactiveWithRecords: { from, to } });
      const recs = await recordsFor(
        people.map((p) => p.id),
        from,
        to,
      );
      const holidays = await holidaysBetween(from, to);
      const recMap = new Map(recs.map((r) => [`${r.person_id}|${r.date}`, r]));
      const dates = datesBetween(from, to);
      const out: Record<string, string | number | null>[] = [];
      for (const p of people) {
        const tr = rulesFor(rules, p.type);
        const personRecs = new Map(dates.map((d) => [d, recMap.get(`${p.id}|${d}`)!]).filter(([, r]) => r) as [string, any][]);
        const days = buildDays(p, dates, personRecs, holidays, today);
        for (const d of days) {
          const raw = personRecs.get(d.date) ?? null;
          const rec = serializeRecord(raw, p.type, rules, tz);
          const common = {
            date: formatDateLocal(d.date, fmt),
            refId: p.ref_id,
            name: p.full_name,
            type: PERSON_TYPE_LABELS[p.type],
            unit: p.activity_name ?? '—',
          };
          if (type === 'absence') {
            const ev = evaluateDay(d, tr, rules);
            if (ev.outcome === 'COUNTED' && (d.status === 'ABSENT' || d.status === 'NOT_MARKED'))
              out.push({ ...common, status: ATTENDANCE_STATUS_LABELS[d.status as AttendanceStatus], remarks: rec?.remarks ?? '' });
          } else if (type === 'late' && rec?.isLate) {
            out.push({ ...common, in: formatTimeLocal(rec.checkInAt, tz), expected: `${tr.officeStart} + ${tr.graceMinutes} min`, minutes: rec.lateMinutes });
          } else if (type === 'early' && rec?.isEarlyDeparture) {
            out.push({ ...common, out: formatTimeLocal(rec.checkOutAt, tz), expected: `${tr.officeEnd} − ${tr.earlyDepartureGraceMinutes} min`, minutes: rec.earlyMinutes });
          } else if (type === 'incomplete' && rec?.isIncomplete) {
            out.push({ ...common, in: formatTimeLocal(rec.checkInAt, tz), remarks: 'Checked in, no check-out recorded' });
          }
        }
      }
      out.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.name).localeCompare(String(b.name)));
      const commonCols: ReportColumn[] = [
        { key: 'date', label: 'Date', width: 75 },
        { key: 'refId', label: 'Ref. ID', width: 70 },
        { key: 'name', label: 'Name', width: 130 },
        { key: 'type', label: 'Type', width: 80 },
        { key: 'unit', label: 'Sport / Activity', width: 130 },
      ];
      const extra: Record<string, ReportColumn[]> = {
        absence: [
          { key: 'status', label: 'Status', width: 80 },
          { key: 'remarks', label: 'Remarks', width: 160 },
        ],
        late: [
          { key: 'in', label: 'In-Time', align: 'center', width: 60 },
          { key: 'expected', label: 'Expected by', width: 90 },
          { key: 'minutes', label: 'Late (min)', align: 'right', width: 60 },
        ],
        early: [
          { key: 'out', label: 'Out-Time', align: 'center', width: 60 },
          { key: 'expected', label: 'Expected until', width: 90 },
          { key: 'minutes', label: 'Early (min)', align: 'right', width: 60 },
        ],
        incomplete: [
          { key: 'in', label: 'In-Time', align: 'center', width: 60 },
          { key: 'remarks', label: 'Issue', width: 160 },
        ],
      };
      const distinct = new Set(out.map((r) => r.refId)).size;
      const summary = [
        { label: 'Records', value: String(out.length) },
        { label: 'Distinct personnel', value: String(distinct) },
      ];
      if (type === 'late' || type === 'early') {
        const total = out.reduce((s, r) => s + Number(r.minutes ?? 0), 0);
        summary.push({ label: 'Average minutes', value: out.length ? (total / out.length).toFixed(0) : '0' });
      }
      return {
        ...base,
        period: `${formatDateLocal(from, fmt)} to ${formatDateLocal(to, fmt)}`,
        columns: [...commonCols, ...extra[type]],
        rows: out,
        summary,
        notes:
          type === 'absence'
            ? ['Includes working days recorded as Absent and eligible working days with no attendance record (Not Marked).']
            : type === 'incomplete'
              ? ['Past days where a check-in exists without a check-out. Officers should correct these records.']
              : [],
      };
    }

    case 'leave': {
      const { from, to } = resolveRange(q, tz, false);
      const status = q.status && ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(q.status) ? q.status : undefined;
      const rows = await listLeaves(req, { from, to, status, personId: q.personId, type: q.type, activityId: q.activityId, q: q.q });
      return {
        ...base,
        filters: base.filters.map((f) => (f.label === 'Status' && status ? { label: 'Status', value: status } : f)),
        period: `${formatDateLocal(from, fmt)} to ${formatDateLocal(to, fmt)}`,
        columns: [
          { key: 'refId', label: 'Ref. ID', width: 65 },
          { key: 'name', label: 'Name', width: 120 },
          { key: 'unit', label: 'Sport / Activity', width: 110 },
          { key: 'leaveType', label: 'Type', width: 55 },
          { key: 'from', label: 'From', width: 70 },
          { key: 'to', label: 'To', width: 70 },
          { key: 'days', label: 'Days', align: 'right', width: 35 },
          { key: 'status', label: 'Status', width: 65 },
          { key: 'reviewedBy', label: 'Reviewed by', width: 90 },
          { key: 'reason', label: 'Reason', width: 140 },
        ],
        rows: rows.map((l: any) => ({
          refId: l.refId,
          name: l.personName,
          unit: l.activityName ?? '—',
          leaveType: LEAVE_TYPE_LABELS[l.leaveType as LeaveType],
          from: formatDateLocal(l.fromDate, fmt),
          to: formatDateLocal(l.toDate, fmt),
          days: l.days,
          status: l.status.charAt(0) + l.status.slice(1).toLowerCase(),
          reviewedBy: l.reviewedBy ?? '—',
          reason: l.reason,
        })),
        summary: [
          { label: 'Requests', value: String(rows.length) },
          { label: 'Approved', value: String(rows.filter((l: any) => l.status === 'APPROVED').length) },
          { label: 'Pending', value: String(rows.filter((l: any) => l.status === 'PENDING').length) },
          { label: 'Rejected', value: String(rows.filter((l: any) => l.status === 'REJECTED').length) },
          { label: 'Approved leave days', value: String(rows.filter((l: any) => l.status === 'APPROVED').reduce((s: number, l: any) => s + l.days, 0)) },
        ],
      };
    }
  }
}
