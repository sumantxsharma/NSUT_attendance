import type { Request } from 'express';
import type pg from 'pg';
import { DateTime } from 'luxon';
import { datesBetween, isoWeekday, LEAVE_TYPE_LABELS, rulesFor, todayIn, daysInRange, type LeaveType, type PersonType } from '@nsut/shared';
import { one, query, tx } from '../db/pool';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { notify, reviewersFor, userIdForPerson } from '../lib/notify';
import { assertPersonVisible, peopleScopeSql } from '../lib/scope';
import { loadSettings } from '../lib/settings';
import { likePattern, Params } from '../lib/sql';
import { holidaysBetween } from './attendance';

export interface LeaveInput {
  fromDate: string;
  toDate: string;
  leaveType: LeaveType;
  reason: string;
  personId?: string;
  document?: { path: string; name: string } | null;
}

const LEAVE_SELECT = `
  l.id, l.person_id AS "personId", p.full_name AS "personName", p.ref_id AS "refId", p.type AS "personType",
  a.name AS "activityName",
  l.from_date AS "fromDate", l.to_date AS "toDate", l.leave_type AS "leaveType", l.reason, l.status,
  (l.document_path IS NOT NULL) AS "hasDocument", l.document_name AS "documentName",
  l.submitted_at AS "submittedAt", su.name AS "submittedBy",
  l.reviewed_at AS "reviewedAt", ru.name AS "reviewedBy", l.reviewer_remarks AS "reviewerRemarks",
  (l.to_date - l.from_date + 1) AS "days"`;
const LEAVE_JOINS = `
  JOIN people p ON p.id = l.person_id
  LEFT JOIN activities a ON a.id = p.activity_id
  LEFT JOIN users su ON su.id = l.submitted_by LEFT JOIN users ru ON ru.id = l.reviewed_by`;

export async function submitLeave(req: Request, input: LeaveInput) {
  const { system } = await loadSettings();
  const auth = req.auth!;
  let personId: string;
  if (auth.user.role === 'STAFF') {
    if (!auth.user.personId) throw forbidden('Your account is not linked to a profile.');
    if (input.personId && input.personId !== auth.user.personId) throw forbidden();
    personId = auth.user.personId;
  } else {
    if (!input.personId) throw badRequest('Select the person this leave is for.');
    personId = input.personId;
    await assertPersonVisible(req, personId);
  }
  const today = todayIn(system.timezone);
  const earliest = DateTime.fromISO(today).minus({ days: system.leaveAllowBackdatedDays }).toISODate()!;
  if (auth.user.role === 'STAFF' && input.fromDate < earliest)
    throw badRequest(`Leave can be applied at most ${system.leaveAllowBackdatedDays} days in arrears. Contact your coordinator for older dates.`);
  const days = daysInRange(input.fromDate, input.toDate);
  if (days > system.leaveMaxDaysPerRequest) throw badRequest(`A single request can cover at most ${system.leaveMaxDaysPerRequest} days.`);

  return tx(async (c) => {
    const person = await one<{ id: string; full_name: string; status: string }>('SELECT id, full_name, status FROM people WHERE id = $1 AND deleted_at IS NULL', [personId], c);
    if (!person) throw notFound('Person');
    if (person.status !== 'ACTIVE') throw badRequest('Leave cannot be submitted for an inactive profile.');
    const overlap = await one(
      `SELECT id, status FROM leaves WHERE person_id = $1 AND status IN ('PENDING','APPROVED') AND from_date <= $3 AND to_date >= $2 LIMIT 1`,
      [personId, input.fromDate, input.toDate],
      c,
    );
    if (overlap)
      throw conflict(
        overlap.status === 'APPROVED'
          ? 'This leave request overlaps with an existing approved leave.'
          : 'This leave request overlaps with a pending leave request.',
      );
    const row = await one(
      `INSERT INTO leaves (person_id, from_date, to_date, leave_type, reason, document_path, document_name, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [personId, input.fromDate, input.toDate, input.leaveType, input.reason, input.document?.path ?? null, input.document?.name ?? null, auth.user.id],
      c,
    );
    await audit(
      {
        action: 'LEAVE_SUBMIT',
        entityType: 'leave',
        entityId: row!.id,
        summary: `${person.full_name}: ${LEAVE_TYPE_LABELS[input.leaveType]} leave ${input.fromDate} → ${input.toDate}`,
        newValue: { personId, fromDate: input.fromDate, toDate: input.toDate, leaveType: input.leaveType, reason: input.reason },
      },
      req,
      c,
    );
    const reviewers = (await reviewersFor(personId, c)).filter((id) => id !== auth.user.id);
    await notify(
      {
        userIds: reviewers,
        type: 'LEAVE_SUBMITTED',
        title: `Leave request: ${person.full_name}`,
        body: `${LEAVE_TYPE_LABELS[input.leaveType]}, ${input.fromDate} to ${input.toDate} (${days} day${days > 1 ? 's' : ''})`,
        link: '/leave?status=PENDING',
      },
      c,
    );
    return getLeave(req, row!.id, c);
  });
}

export async function getLeave(req: Request, id: string, client?: pg.PoolClient) {
  const p = new Params();
  const idp = p.add(id);
  const row = await one(`SELECT ${LEAVE_SELECT} FROM leaves l ${LEAVE_JOINS} WHERE l.id = ${idp} AND ${peopleScopeSql(req, p)}`, p.values, client);
  if (!row) throw notFound('Leave request');
  return row;
}

export async function listLeaves(
  req: Request,
  f: { status?: string; personId?: string; from?: string; to?: string; q?: string; type?: string; activityId?: string },
) {
  const p = new Params();
  const where = [peopleScopeSql(req, p)];
  if (f.status) where.push(`l.status = ${p.add(f.status)}`);
  if (f.personId) where.push(`l.person_id = ${p.add(f.personId)}`);
  if (f.from) where.push(`l.to_date >= ${p.add(f.from)}`);
  if (f.to) where.push(`l.from_date <= ${p.add(f.to)}`);
  if (f.type) where.push(`p.type = ${p.add(f.type)}`);
  if (f.activityId) where.push(`p.activity_id = ${p.add(f.activityId)}`);
  if (f.q) {
    const q = p.add(likePattern(f.q));
    where.push(`(p.full_name ILIKE ${q} OR p.ref_id ILIKE ${q})`);
  }
  return query(
    `SELECT ${LEAVE_SELECT} FROM leaves l ${LEAVE_JOINS} WHERE ${where.join(' AND ')}
     ORDER BY CASE l.status WHEN 'PENDING' THEN 0 ELSE 1 END, l.submitted_at DESC LIMIT 500`,
    p.values,
  );
}

/**
 * Reflect an approved leave in attendance: each working, non-holiday day in the range
 * becomes LEAVE (LEAVE_SYNC). Days where the person actually attended are left untouched
 * and reported back as conflicts.
 */
async function syncLeaveToAttendance(c: pg.PoolClient, leave: any, personType: PersonType, userId: string, req: Request) {
  const { rules } = await loadSettings();
  const tr = rulesFor(rules, personType);
  const holidays = await holidaysBetween(leave.from_date, leave.to_date, c);
  const applied: string[] = [];
  const skipped: { date: string; reason: string }[] = [];
  for (const date of datesBetween(leave.from_date, leave.to_date)) {
    if (!tr.workingDays.includes(isoWeekday(date))) {
      skipped.push({ date, reason: 'Non-working day' });
      continue;
    }
    if (holidays.has(date)) {
      skipped.push({ date, reason: 'Holiday' });
      continue;
    }
    const existing = await one('SELECT * FROM attendance WHERE person_id = $1 AND date = $2 FOR UPDATE', [leave.person_id, date], c);
    if (existing) {
      if (existing.check_in_at || existing.status === 'PRESENT' || existing.status === 'HALF_DAY') {
        skipped.push({ date, reason: 'Attendance already recorded (present)' });
        continue;
      }
      await c.query(
        `UPDATE attendance SET status = 'LEAVE', leave_id = $2, marking_method = 'LEAVE_SYNC', marked_by = $3, check_in_at = NULL, check_out_at = NULL, duration_minutes = NULL, version = version + 1 WHERE id = $1`,
        [existing.id, leave.id, userId],
      );
      await audit(
        {
          action: 'ATTENDANCE_UPDATE',
          entityType: 'attendance',
          entityId: existing.id,
          summary: `Set to LEAVE for ${date} by approved leave`,
          oldValue: { status: existing.status, remarks: existing.remarks },
          newValue: { status: 'LEAVE', leaveId: leave.id },
          reason: 'Approved leave',
        },
        req,
        c,
      );
    } else {
      await c.query(
        `INSERT INTO attendance (person_id, date, status, marking_method, leave_id, marked_by, remarks) VALUES ($1,$2,'LEAVE','LEAVE_SYNC',$3,$4,$5)`,
        [leave.person_id, date, leave.id, userId, `${LEAVE_TYPE_LABELS[leave.leave_type as LeaveType]} leave`],
      );
    }
    applied.push(date);
  }
  return { applied, skipped };
}

async function unsyncLeave(c: pg.PoolClient, leaveId: string) {
  // Leave-derived days return to "Not Marked"; the list of reverted dates is written to the audit log by the caller.
  const rows = await query(`DELETE FROM attendance WHERE leave_id = $1 AND status = 'LEAVE' RETURNING date`, [leaveId], c);
  return rows.map((r: any) => r.date);
}

export async function reviewLeave(req: Request, id: string, decision: 'APPROVED' | 'REJECTED', remarks: string | null) {
  const current = await getLeave(req, id); // scope check
  if (req.auth!.user.personId && req.auth!.user.personId === current.personId) throw forbidden('You cannot review your own leave request.');
  return tx(async (c) => {
    const leave = await one('SELECT * FROM leaves WHERE id = $1 FOR UPDATE', [id], c);
    if (!leave) throw notFound('Leave request');
    if (leave.status !== 'PENDING') throw conflict(`This leave request has already been ${leave.status.toLowerCase()}.`);
    const person = await one<{ full_name: string; type: PersonType }>('SELECT full_name, type FROM people WHERE id = $1', [leave.person_id], c);
    await c.query(`UPDATE leaves SET status = $2, reviewed_by = $3, reviewed_at = now(), reviewer_remarks = $4 WHERE id = $1`, [
      id,
      decision,
      req.auth!.user.id,
      remarks,
    ]);
    let sync = null;
    if (decision === 'APPROVED') sync = await syncLeaveToAttendance(c, leave, person!.type, req.auth!.user.id, req);
    await audit(
      {
        action: decision === 'APPROVED' ? 'LEAVE_APPROVE' : 'LEAVE_REJECT',
        entityType: 'leave',
        entityId: id,
        summary: `${decision === 'APPROVED' ? 'Approved' : 'Rejected'} leave for ${person!.full_name} (${leave.from_date} → ${leave.to_date})`,
        oldValue: { status: 'PENDING' },
        newValue: { status: decision, attendanceDaysUpdated: sync?.applied ?? [], skipped: sync?.skipped ?? [] },
        reason: remarks,
      },
      req,
      c,
    );
    const staff = await userIdForPerson(leave.person_id, c);
    if (staff)
      await notify(
        {
          userIds: [staff],
          type: decision === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
          title: `Your leave (${leave.from_date} → ${leave.to_date}) was ${decision.toLowerCase()}`,
          body: remarks ?? undefined,
          link: '/leave',
        },
        c,
      );
    return { leave: await getLeave(req, id, c), sync };
  });
}

/** Cancel a pending leave (owner) or an approved leave (reviewer); reverts attendance created from it. */
export async function cancelLeave(req: Request, id: string, remarks: string | null) {
  const current = await getLeave(req, id);
  const auth = req.auth!;
  const isOwner = auth.user.personId === current.personId;
  return tx(async (c) => {
    const leave = await one('SELECT * FROM leaves WHERE id = $1 FOR UPDATE', [id], c);
    if (!leave) throw notFound('Leave request');
    if (leave.status === 'CANCELLED' || leave.status === 'REJECTED') throw conflict(`This leave request is already ${leave.status.toLowerCase()}.`);
    if (auth.user.role === 'STAFF') {
      if (!isOwner) throw forbidden();
      if (leave.status !== 'PENDING') throw forbidden('Approved leave can only be cancelled by your coordinator or the administration.');
    }
    const reverted = leave.status === 'APPROVED' ? await unsyncLeave(c, id) : [];
    await c.query(`UPDATE leaves SET status = 'CANCELLED', reviewed_by = $2, reviewed_at = now(), reviewer_remarks = COALESCE($3, reviewer_remarks) WHERE id = $1`, [
      id,
      auth.user.id,
      remarks,
    ]);
    await audit(
      {
        action: 'LEAVE_CANCEL',
        entityType: 'leave',
        entityId: id,
        summary: `Cancelled leave ${leave.from_date} → ${leave.to_date}`,
        oldValue: { status: leave.status },
        newValue: { status: 'CANCELLED', attendanceDaysReverted: reverted },
        reason: remarks,
      },
      req,
      c,
    );
    const staff = await userIdForPerson(leave.person_id, c);
    if (staff && !isOwner)
      await notify({ userIds: [staff], type: 'LEAVE_CANCELLED', title: `Your leave (${leave.from_date} → ${leave.to_date}) was cancelled`, body: remarks ?? undefined, link: '/leave' }, c);
    return getLeave(req, id, c);
  });
}

export async function leaveDocumentPath(req: Request, id: string) {
  await getLeave(req, id);
  const row = await one<{ document_path: string | null; document_name: string | null }>('SELECT document_path, document_name FROM leaves WHERE id = $1', [id]);
  if (!row?.document_path) throw notFound('Document');
  return row;
}
