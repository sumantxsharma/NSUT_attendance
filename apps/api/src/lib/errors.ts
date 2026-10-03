import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Please sign in to continue.') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have permission to perform this action.') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'CONFLICT', msg, details);

/** Map Postgres constraint violations to meaningful, non-leaky messages. */
const CONSTRAINT_MESSAGES: Record<string, [number, string]> = {
  attendance_person_date_uq: [409, 'Attendance has already been marked for this person on this date.'],
  attendance_checkout_ck: [400, 'You cannot check out before checking in.'],
  attendance_order_ck: [400, 'Check-out time must be after check-in time.'],
  leaves_no_overlap: [409, 'This leave request overlaps with an existing pending or approved leave.'],
  leaves_range_ck: [400, 'To date must be on or after from date.'],
  people_ref_uq: [409, 'A person with this Employee/Reference ID already exists.'],
  users_email_uq: [409, 'A user with this email already exists.'],
  users_person_uq: [409, 'This person already has a login account.'],
  departments_code_uq: [409, 'A department with this code already exists.'],
  departments_name_uq: [409, 'A department with this name already exists.'],
  activities_name_uq: [409, 'A sport/activity with this name already exists.'],
  holidays_date_key: [409, 'A holiday already exists on this date.'],
  attendance_corrections_one_pending: [409, 'A correction for this date is already awaiting approval.'],
  people_gf_dept_ck: [400, 'Guest Faculty must belong to a department.'],
  people_sc_activity_ck: [400, 'Sports Coaches must be assigned a sport/activity.'],
  users_staff_person_ck: [400, 'A staff login must be linked to a Guest Faculty / Coach profile.'],
};

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    const first = err.issues[0]?.message ?? 'Invalid input.';
    return res.status(400).json({ error: { code: 'VALIDATION', message: first, fields } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed request body.' } });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'The uploaded file is too large.' } });
  }
  // Postgres errors
  if (err?.constraint && CONSTRAINT_MESSAGES[err.constraint]) {
    const [status, message] = CONSTRAINT_MESSAGES[err.constraint];
    return res.status(status).json({ error: { code: 'CONSTRAINT', message } });
  }
  if (err?.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'This record already exists.' } });
  if (err?.code === '23503') return res.status(409).json({ error: { code: 'IN_USE', message: 'This record is referenced by other records.' } });
  if (err?.code === '23514' || err?.code === '22P02' || err?.code === '22007' || err?.code === '22008')
    return res.status(400).json({ error: { code: 'INVALID', message: 'The submitted values are not valid.' } });

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
}

/** Wrap async route handlers so rejections reach the error handler. */
export const ah =
  <T extends Request = Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req as T, res, next).catch(next);
