/**
 * Core domain enums and types shared by API and web.
 * Keep these in sync with database/migrations (Postgres enums).
 */

export const ROLES = ['SUPER_ADMIN', 'OFFICER', 'COORDINATOR', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  OFFICER: 'Authorized Officer',
  COORDINATOR: 'Department / Activity Coordinator',
  STAFF: 'Guest Faculty / Sports Coach',
};

export const PERSON_TYPES = ['GUEST_FACULTY', 'SPORTS_COACH'] as const;
export type PersonType = (typeof PERSON_TYPES)[number];
export const PERSON_TYPE_LABELS: Record<PersonType, string> = {
  GUEST_FACULTY: 'Guest Faculty',
  SPORTS_COACH: 'Sports Coach',
};

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY', 'HOLIDAY', 'NOT_MARKED'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
/** Statuses that can be stored in the DB. NOT_MARKED is derived (no record). */
export const STORED_ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY', 'HOLIDAY'] as const;
export type StoredAttendanceStatus = (typeof STORED_ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LEAVE: 'On Leave',
  HALF_DAY: 'Half Day',
  HOLIDAY: 'Holiday',
  NOT_MARKED: 'Not Marked',
};

/** Presence states used by live views (derived, richer than attendance status). */
export const PRESENCE_STATES = ['CURRENTLY_PRESENT', 'CHECKED_OUT', 'ABSENT', 'ON_LEAVE', 'NOT_MARKED', 'HALF_DAY', 'HOLIDAY'] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];
export const PRESENCE_LABELS: Record<PresenceState, string> = {
  CURRENTLY_PRESENT: 'Currently Present',
  CHECKED_OUT: 'Checked Out',
  ABSENT: 'Absent',
  ON_LEAVE: 'On Leave',
  NOT_MARKED: 'Not Marked',
  HALF_DAY: 'Half Day',
  HOLIDAY: 'Holiday',
};

export const MARKING_METHODS = ['SELF', 'MANUAL', 'LEAVE_SYNC', 'SYSTEM'] as const;
export type MarkingMethod = (typeof MARKING_METHODS)[number];
export const MARKING_METHOD_LABELS: Record<MarkingMethod, string> = {
  SELF: 'Self check-in',
  MANUAL: 'Manual (officer)',
  LEAVE_SYNC: 'Approved leave',
  SYSTEM: 'System',
};

export const LEAVE_TYPES = ['CASUAL', 'MEDICAL', 'DUTY', 'PERSONAL', 'OTHER'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  CASUAL: 'Casual',
  MEDICAL: 'Medical',
  DUTY: 'On Duty',
  PERSONAL: 'Personal',
  OTHER: 'Other',
};

export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const CORRECTION_STATUSES = ['PENDING', 'APPLIED', 'REJECTED'] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

export const RECORD_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const REPORT_TYPES = [
  'daily',
  'monthly',
  'individual',
  'department',
  'activity',
  'absence',
  'leave',
  'late',
  'early',
  'incomplete',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const REPORT_LABELS: Record<ReportType, string> = {
  daily: 'Daily Attendance Report',
  monthly: 'Monthly Attendance Report',
  individual: 'Individual Attendance Report',
  department: 'Department-wise Report',
  activity: 'Sports / Activity-wise Report',
  absence: 'Absence Report',
  leave: 'Leave Report',
  late: 'Late Arrival Report',
  early: 'Early Departure Report',
  incomplete: 'Incomplete Attendance Report',
};

export const EXPORT_FORMATS = ['json', 'csv', 'xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const AUDIT_ACTIONS = [
  'AUTH_LOGIN',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOGOUT',
  'AUTH_PASSWORD_RESET_REQUESTED',
  'AUTH_PASSWORD_RESET',
  'AUTH_PASSWORD_CHANGED',
  'ATTENDANCE_CHECK_IN',
  'ATTENDANCE_CHECK_OUT',
  'ATTENDANCE_CREATE',
  'ATTENDANCE_UPDATE',
  'ATTENDANCE_DELETE',
  'ATTENDANCE_CORRECTION_REQUESTED',
  'ATTENDANCE_CORRECTION_APPROVED',
  'ATTENDANCE_CORRECTION_REJECTED',
  'LEAVE_SUBMIT',
  'LEAVE_APPROVE',
  'LEAVE_REJECT',
  'LEAVE_CANCEL',
  'PERSON_CREATE',
  'PERSON_UPDATE',
  'PERSON_DEACTIVATE',
  'PERSON_ACTIVATE',
  'USER_CREATE',
  'USER_UPDATE',
  'USER_DEACTIVATE',
  'USER_ACTIVATE',
  'USER_RESET_LINK_ISSUED',
  'DEPARTMENT_CREATE',
  'DEPARTMENT_UPDATE',
  'ACTIVITY_CREATE',
  'ACTIVITY_UPDATE',
  'SETTINGS_RULES_UPDATE',
  'SETTINGS_SYSTEM_UPDATE',
  'SETTINGS_LOGO_UPDATE',
  'HOLIDAY_CREATE',
  'HOLIDAY_DELETE',
  'REPORT_EXPORT',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
