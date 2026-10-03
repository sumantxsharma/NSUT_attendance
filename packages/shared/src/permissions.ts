import type { Role } from './domain';

/**
 * Permission catalogue. Routes check permissions, never role names directly,
 * so the matrix below is the single place to change who can do what.
 */
export const PERMISSIONS = [
  'dashboard.view',
  'attendance.read',
  'attendance.mark',
  'attendance.correct',
  'attendance.delete',
  'attendance.correction.review',
  'attendance.self',
  'people.read',
  'people.write',
  'org.manage',
  'leave.review',
  'leave.self',
  'reports.generate',
  'reports.export',
  'users.manage',
  'rules.manage',
  'settings.manage',
  'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'dashboard.view': 'View dashboard',
  'attendance.read': 'View attendance',
  'attendance.mark': 'Mark attendance manually',
  'attendance.correct': 'Correct attendance records',
  'attendance.delete': 'Delete attendance records',
  'attendance.correction.review': 'Approve / reject attendance corrections',
  'attendance.self': 'Check in / check out (self)',
  'people.read': 'View Guest Faculty / Coaches',
  'people.write': 'Create / edit / deactivate Guest Faculty / Coaches',
  'org.manage': 'Manage sports / activities',
  'leave.review': 'Approve / reject leave',
  'leave.self': 'Submit own leave requests',
  'reports.generate': 'Generate reports',
  'reports.export': 'Export reports (CSV / XLSX / PDF)',
  'users.manage': 'Create / edit / deactivate users',
  'rules.manage': 'Configure attendance rules',
  'settings.manage': 'Manage system settings',
  'audit.read': 'View audit logs',
};

const ALL = [...PERMISSIONS] as Permission[];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ALL.filter((p) => p !== 'attendance.self' && p !== 'leave.self'),
  OFFICER: [
    'dashboard.view',
    'attendance.read',
    'attendance.mark',
    'attendance.correct',
    'people.read',
    'leave.review',
    'reports.generate',
    'reports.export',
  ],
  COORDINATOR: [
    'dashboard.view',
    'attendance.read',
    'people.read',
    'leave.review',
    'reports.generate',
    'reports.export',
  ],
  STAFF: ['attendance.self', 'leave.self'],
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Roles whose data visibility is limited to assigned sports/activities. */
export function isScopedRole(role: Role): boolean {
  return role === 'COORDINATOR';
}
