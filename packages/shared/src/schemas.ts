import { z } from 'zod';
import { LEAVE_TYPES, PERSON_TYPES, ROLES, STORED_ATTENDANCE_STATUSES, RECORD_STATUSES, ATTENDANCE_STATUSES } from './domain';

/** Request validation schemas shared by server (authoritative) and client (UX). */

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')), 'Invalid date');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
export const uuid = z.string().uuid();

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === '' || v === undefined ? null : v));

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(200),
  password: z.string().min(1, 'Password is required').max(200),
});

export const passwordPolicy = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain letters and numbers');

export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordPolicy });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordPolicy });

export const personSchema = z
  .object({
    refId: trimmed(40).min(2, 'Reference ID is required').regex(/^[A-Za-z0-9/-]+$/, 'Letters, numbers, - and / only'),
    fullName: trimmed(120).min(2, 'Full name is required'),
    type: z.enum(PERSON_TYPES),
    activityId: uuid.optional().nullable(),
    designation: optionalText(120),
    specialization: optionalText(200),
    email: z.string().trim().toLowerCase().email('Enter a valid email').max(200).optional().nullable().or(z.literal('').transform(() => null)),
    phone: z
      .string()
      .trim()
      .regex(/^[+0-9 -]{7,20}$/, 'Enter a valid phone number')
      .optional()
      .nullable()
      .or(z.literal('').transform(() => null)),
    joiningDate: isoDate.optional().nullable(),
    contractStart: isoDate.optional().nullable(),
    contractEnd: isoDate.optional().nullable(),
    assignedHours: z.coerce.number().min(0).max(80).optional().nullable(),
  })
  .refine((p) => !(p.contractStart && p.contractEnd) || p.contractEnd >= p.contractStart, {
    message: 'Contract end must be on or after contract start',
    path: ['contractEnd'],
  })
  .refine((p) => !!p.activityId, {
    message: 'Choose a sport / activity',
    path: ['activityId'],
  });

export const createPersonSchema = personSchema.and(
  z.object({
    createLogin: z.boolean().optional().default(false),
    initialPassword: passwordPolicy.optional(),
  }),
);

export const activitySchema = z.object({
  name: trimmed(120).min(2),
  category: trimmed(60).min(2),
  status: z.enum(RECORD_STATUSES).optional(),
});

export const manualAttendanceSchema = z
  .object({
    personId: uuid,
    date: isoDate,
    status: z.enum(STORED_ATTENDANCE_STATUSES),
    checkIn: hhmm.optional().nullable(),
    checkOut: hhmm.optional().nullable(),
    remarks: trimmed(500).optional().nullable(),
  })
  .refine((a) => !(a.checkOut && !a.checkIn), { message: 'You cannot record a check-out without a check-in.', path: ['checkOut'] })
  .refine((a) => !(a.checkIn && a.checkOut) || a.checkOut > a.checkIn, { message: 'Out-time must be after in-time.', path: ['checkOut'] })
  .refine((a) => !((a.status === 'ABSENT' || a.status === 'LEAVE' || a.status === 'HOLIDAY') && a.checkIn), {
    message: 'In/out times are only allowed for Present or Half Day.',
    path: ['checkIn'],
  });

export const correctionSchema = z
  .object({
    status: z.enum(STORED_ATTENDANCE_STATUSES),
    checkIn: hhmm.optional().nullable(),
    checkOut: hhmm.optional().nullable(),
    remarks: trimmed(500).optional().nullable(),
    reason: trimmed(500).min(5, 'A reason of at least 5 characters is required'),
  })
  .refine((a) => !(a.checkOut && !a.checkIn), { message: 'You cannot record a check-out without a check-in.', path: ['checkOut'] })
  .refine((a) => !(a.checkIn && a.checkOut) || a.checkOut > a.checkIn, { message: 'Out-time must be after in-time.', path: ['checkOut'] })
  .refine((a) => !((a.status === 'ABSENT' || a.status === 'LEAVE' || a.status === 'HOLIDAY') && a.checkIn), {
    message: 'In/out times are only allowed for Present or Half Day.',
    path: ['checkIn'],
  });

export const deleteAttendanceSchema = z.object({ reason: trimmed(500).min(5, 'A reason of at least 5 characters is required') });

export const leaveSchema = z
  .object({
    fromDate: isoDate,
    toDate: isoDate,
    leaveType: z.enum(LEAVE_TYPES),
    reason: trimmed(1000).min(5, 'Please describe the reason (at least 5 characters)'),
    personId: uuid.optional(),
  })
  .refine((l) => l.toDate >= l.fromDate, { message: 'To date must be on or after from date', path: ['toDate'] });

export const leaveReviewSchema = z.object({ remarks: trimmed(1000).optional().nullable() });
export const leaveRejectSchema = z.object({ remarks: trimmed(1000).min(3, 'Please give a reason for rejection') });

export const createUserSchema = z.object({
  name: trimmed(120).min(2),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9 -]{7,20}$/)
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  role: z.enum(ROLES),
  password: passwordPolicy,
  personId: uuid.optional().nullable(),
  scopeActivityIds: z.array(uuid).optional().default([]),
});

export const updateUserSchema = z.object({
  name: trimmed(120).min(2).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9 -]{7,20}$/)
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  role: z.enum(ROLES).optional(),
  personId: uuid.optional().nullable(),
  scopeActivityIds: z.array(uuid).optional(),
});

export const holidaySchema = z.object({ date: isoDate, name: trimmed(120).min(2) });

export const monthQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const listFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(PERSON_TYPES).optional(),
  activityId: uuid.optional(),
  personId: uuid.optional(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
});
