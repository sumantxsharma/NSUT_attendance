import type { AttendanceStatus, PersonType, PresenceState, Role, Permission, TypeRules, AttendanceRules, SystemSettings, LeaveType, LeaveStatus } from '@nsut/shared';

export interface Me {
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    role: Role;
    personId: string | null;
    personName: string | null;
    personType: PersonType | null;
    refId: string | null;
    lastLogin: string | null;
    permissions: Permission[];
    scopes: { departmentId: string | null; departmentName: string | null; activityId: string | null; activityName: string | null }[];
  };
  csrfToken: string;
}

export interface PublicSettings {
  universityName: string;
  unitName: string;
  timezone: string;
  dateFormat: string;
  hasLogo: boolean;
  logoVersion: string | null;
  demoMode: boolean;
}

export interface Person {
  id: string;
  refId: string;
  fullName: string;
  type: PersonType;
  status: 'ACTIVE' | 'INACTIVE';
  departmentId: string | null;
  departmentName: string | null;
  departmentCode: string | null;
  activityId: string | null;
  activityName: string | null;
  designation: string | null;
  joiningDate: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  assignedHours: number | null;
  hasPhoto: boolean;
  specialization?: string | null;
  email?: string | null;
  phone?: string | null;
  hasLogin?: boolean;
  login?: { id: string; email: string; status: string; lastLogin: string | null } | null;
}

export interface AttRecord {
  id: string;
  personId: string;
  date: string;
  status: AttendanceStatus;
  checkInAt: string | null;
  checkOutAt: string | null;
  durationMinutes: number | null;
  lateMinutes: number;
  isLate: boolean;
  earlyMinutes: number;
  isEarlyDeparture: boolean;
  isIncomplete: boolean;
  markingMethod: string;
  remarks: string | null;
  markedBy: string | null;
  markedByName: string | null;
  leaveId: string | null;
  version: number;
  updatedAt: string;
}

export interface SheetRow {
  person: Person;
  record: AttRecord | null;
  status: AttendanceStatus;
  presence: PresenceState;
  isWorkingDay: boolean;
  expectedHours: string;
  expectedMinutes: number;
  currentMinutes: number | null;
}

export interface Counts {
  total: number;
  guestFaculty: number;
  sportsCoaches: number;
  present: number;
  currentlyPresent: number;
  checkedOut: number;
  halfDay: number;
  absent: number;
  onLeave: number;
  notMarked: number;
  late: number;
}

export interface DailySheet {
  date: string;
  isToday: boolean;
  isHoliday: boolean;
  holidayName: string | null;
  rows: SheetRow[];
  counts: Counts;
  timezone: string;
}

export interface MonthlyRow {
  person: Person;
  eligibleDays: number;
  credits: number;
  present: number;
  absent: number;
  notMarked: number;
  leave: number;
  halfDays: number;
  holidays: number;
  percentage: number | null;
  late: number;
  earlyDepartures: number;
  totalMinutes: number;
}

export interface CalendarDay {
  date: string;
  weekday: number;
  isWorkingDay: boolean;
  isHoliday: boolean;
  holidayName: string | null;
  isToday: boolean;
  isFuture: boolean;
  inContract: boolean;
  status: AttendanceStatus;
  record: AttRecord | null;
  evaluation: { outcome: 'COUNTED' | 'EXCLUDED'; credit: number; reason: string };
  pendingLeave: boolean;
}

export interface PersonMonth {
  person: Person;
  year: number;
  month: number;
  days: CalendarDay[];
  summary: { eligibleDays: number; credits: number; present: number; absent: number; notMarked: number; leave: number; halfDays: number; holidays: number; percentage: number | null };
  rules: TypeRules;
  timezone: string;
}

export interface Leave {
  id: string;
  personId: string;
  personName: string;
  refId: string;
  personType: PersonType;
  departmentName: string | null;
  activityName: string | null;
  fromDate: string;
  toDate: string;
  leaveType: LeaveType;
  reason: string;
  status: LeaveStatus;
  hasDocument: boolean;
  documentName: string | null;
  submittedAt: string;
  submittedBy: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewerRemarks: string | null;
  days: number;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE';
  activePeople: number;
}
export interface Activity {
  id: string;
  name: string;
  category: string;
  status: 'ACTIVE' | 'INACTIVE';
  departmentId: string | null;
  departmentName: string | null;
  activePeople: number;
}

export interface SettingsPayload {
  rules: AttendanceRules;
  system: SystemSettings;
  holidays: { id: string; date: string; name: string }[];
  formula: string[];
}

export interface ReportData {
  type: string;
  title: string;
  period: string;
  filters: { label: string; value: string }[];
  columns: { key: string; label: string; align?: 'left' | 'right' | 'center' }[];
  rows: Record<string, string | number | null>[];
  summary: { label: string; value: string }[];
  notes: string[];
  meta: { university: string; unit: string; generatedAt: string; generatedBy: string; timezone: string; footer: string; logoPath: string | null };
}
