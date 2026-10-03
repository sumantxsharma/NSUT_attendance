import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { correctionSchema, deleteAttendanceSchema, isoDate, listFilterSchema, manualAttendanceSchema, monthQuery, todayIn, uuid } from '@nsut/shared';
import { ah } from '../lib/errors';
import { getTz } from '../lib/settings';
import { requirePerm } from '../middleware/auth';
import {
  checkIn,
  checkOut,
  correctAttendance,
  dailySheet,
  deleteAttendance,
  listCorrections,
  manualMark,
  monthlySummary,
  myToday,
  personMonth,
  reviewCorrection,
} from '../services/attendance';

export const attendanceRouter = Router();

// ------------------------------------------------------------ self service
attendanceRouter.get('/me/today', requirePerm('attendance.self'), ah(async (req, res) => res.json(await myToday(req))));

attendanceRouter.post(
  '/check-in',
  requirePerm('attendance.self'),
  ah(async (req, res) => {
    const record = await checkIn(req);
    res.status(201).json({ message: 'Attendance marked successfully', record });
  }),
);

attendanceRouter.post(
  '/check-out',
  requirePerm('attendance.self'),
  ah(async (req, res) => {
    const record = await checkOut(req);
    res.json({ message: 'Checked out successfully', record });
  }),
);

attendanceRouter.get(
  '/me/month',
  requirePerm('attendance.self'),
  ah(async (req, res) => {
    const tz = await getTz();
    const now = DateTime.now().setZone(tz);
    const q = monthQuery.partial().parse(req.query);
    res.json(await personMonth(req, req.auth!.user.personId!, q.year ?? now.year, q.month ?? now.month));
  }),
);

// ------------------------------------------------------------ officer views
attendanceRouter.get(
  '/today',
  requirePerm('attendance.read'),
  ah(async (req, res) => {
    const f = listFilterSchema.parse(req.query);
    res.json(await dailySheet(req, todayIn(await getTz()), f));
  }),
);

attendanceRouter.get(
  '/daily',
  requirePerm('attendance.read'),
  ah(async (req, res) => {
    const f = listFilterSchema.extend({ date: isoDate.optional() }).parse(req.query);
    res.json(await dailySheet(req, f.date ?? todayIn(await getTz()), f));
  }),
);

attendanceRouter.get(
  '/monthly',
  requirePerm('attendance.read'),
  ah(async (req, res) => {
    const tz = await getTz();
    const now = DateTime.now().setZone(tz);
    const q = monthQuery.partial().merge(listFilterSchema).parse(req.query);
    res.json(await monthlySummary(req, q.year ?? now.year, q.month ?? now.month, q));
  }),
);

attendanceRouter.get(
  '/person/:id',
  requirePerm('attendance.read', 'attendance.self'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const tz = await getTz();
    const now = DateTime.now().setZone(tz);
    const q = monthQuery.partial().parse(req.query);
    res.json(await personMonth(req, id, q.year ?? now.year, q.month ?? now.month));
  }),
);

attendanceRouter.post(
  '/manual',
  requirePerm('attendance.mark'),
  ah(async (req, res) => {
    const input = manualAttendanceSchema.parse(req.body);
    res.status(201).json({ message: 'Attendance recorded', record: await manualMark(req, input) });
  }),
);

attendanceRouter.patch(
  '/:id',
  requirePerm('attendance.correct'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const body = correctionSchema.and(z.object({ version: z.number().int().optional() })).parse(req.body);
    const out = await correctAttendance(req, id, body);
    res.json({ message: out.pendingApproval ? 'Correction submitted for approval' : 'Attendance corrected', ...out });
  }),
);

attendanceRouter.delete(
  '/:id',
  requirePerm('attendance.delete'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { reason } = deleteAttendanceSchema.parse(req.body);
    res.json(await deleteAttendance(req, id, reason));
  }),
);

// ------------------------------------------------------------ corrections
attendanceRouter.get(
  '/corrections/list',
  requirePerm('attendance.read'),
  ah(async (req, res) => {
    const q = z.object({ status: z.enum(['PENDING', 'APPLIED', 'REJECTED']).optional(), personId: uuid.optional() }).parse(req.query);
    res.json(await listCorrections(req, q.status, q.personId));
  }),
);

attendanceRouter.patch(
  '/corrections/:id/:decision',
  requirePerm('attendance.correction.review'),
  ah(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const decision = z.enum(['approve', 'reject']).parse(req.params.decision);
    const { remarks } = z.object({ remarks: z.string().trim().max(500).optional().nullable() }).parse(req.body ?? {});
    res.json(await reviewCorrection(req, id, decision === 'approve', remarks ?? null));
  }),
);
