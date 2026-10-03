import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { isoDate, LEAVE_STATUSES, leaveRejectSchema, leaveReviewSchema, leaveSchema, PERSON_TYPES, uuid } from '@nsut/shared';
import { ah, forbidden, notFound } from '../lib/errors';
import { MIME_BY_EXT, memoryUpload, resolveUpload, saveValidatedFile } from '../lib/upload';
import { requirePerm } from '../middleware/auth';
import { can } from '@nsut/shared';
import { cancelLeave, getLeave, leaveDocumentPath, listLeaves, reviewLeave, submitLeave } from '../services/leave';

export const leaveRouter = Router();

leaveRouter.post(
  '/',
  requirePerm('leave.self', 'leave.review'),
  memoryUpload(5).single('document'),
  ah(async (req, res) => {
    // Multipart bodies arrive as strings.
    const b = leaveSchema.parse({ ...req.body, personId: req.body.personId || undefined });
    const doc = saveValidatedFile(req.file, ['application/pdf', 'image/png', 'image/jpeg'], 'leave-docs');
    try {
      const leave = await submitLeave(req, { ...b, document: doc });
      res.status(201).json(leave);
    } catch (e) {
      if (doc) fs.rmSync(resolveUpload(doc.path), { force: true });
      throw e;
    }
  }),
);

leaveRouter.get(
  '/',
  requirePerm('leave.self', 'leave.review'),
  ah(async (req, res) => {
    const f = z
      .object({
        status: z.enum(LEAVE_STATUSES).optional(),
        personId: uuid.optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        q: z.string().trim().max(100).optional(),
        type: z.enum(PERSON_TYPES).optional(),
        departmentId: uuid.optional(),
        activityId: uuid.optional(),
      })
      .parse(req.query);
    res.json(await listLeaves(req, f));
  }),
);

leaveRouter.get('/:id', requirePerm('leave.self', 'leave.review'), ah(async (req, res) => res.json(await getLeave(req, uuid.parse(req.params.id)))));

leaveRouter.patch(
  '/:id/approve',
  requirePerm('leave.review'),
  ah(async (req, res) => {
    const { remarks } = leaveReviewSchema.parse(req.body ?? {});
    res.json(await reviewLeave(req, uuid.parse(req.params.id), 'APPROVED', remarks ?? null));
  }),
);

leaveRouter.patch(
  '/:id/reject',
  requirePerm('leave.review'),
  ah(async (req, res) => {
    const { remarks } = leaveRejectSchema.parse(req.body ?? {});
    res.json(await reviewLeave(req, uuid.parse(req.params.id), 'REJECTED', remarks));
  }),
);

leaveRouter.patch(
  '/:id/cancel',
  requirePerm('leave.self', 'leave.review'),
  ah(async (req, res) => {
    const { remarks } = leaveReviewSchema.parse(req.body ?? {});
    if (!can(req.auth!.user.role, 'leave.review') && !req.auth!.user.personId) throw forbidden();
    res.json(await cancelLeave(req, uuid.parse(req.params.id), remarks ?? null));
  }),
);

leaveRouter.get(
  '/:id/document',
  requirePerm('leave.self', 'leave.review'),
  ah(async (req, res) => {
    const row = await leaveDocumentPath(req, uuid.parse(req.params.id));
    const full = resolveUpload(row.document_path!);
    if (!fs.existsSync(full)) throw notFound('Document');
    res.setHeader('Content-Type', MIME_BY_EXT[full.split('.').pop()!] ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(row.document_name ?? 'document').replace(/"/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(full).pipe(res);
  }),
);
