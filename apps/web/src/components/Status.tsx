import clsx from 'clsx';
import { CalendarOff, CheckCircle2, CircleDashed, CircleDot, Flag, LogOut, SunMedium, XCircle } from 'lucide-react';
import { ATTENDANCE_STATUS_LABELS, PRESENCE_LABELS, type AttendanceStatus, type PresenceState } from '@nsut/shared';

/**
 * Status is never conveyed by colour alone: every badge has an icon shape and a text label.
 * Tones map to tailwind `st.*` tokens defined in tailwind.config.js.
 */
const STATUS_STYLE: Record<AttendanceStatus, { cls: string; Icon: typeof CheckCircle2 }> = {
  PRESENT: { cls: 'bg-st-presentBg text-st-present border-[#BFDFCB]', Icon: CheckCircle2 },
  ABSENT: { cls: 'bg-st-absentBg text-st-absent border-[#F1C5C2]', Icon: XCircle },
  LEAVE: { cls: 'bg-st-leaveBg text-st-leave border-[#EFD9A8]', Icon: CalendarOff },
  HALF_DAY: { cls: 'bg-st-halfBg text-st-half border-[#D9C9EE]', Icon: SunMedium },
  HOLIDAY: { cls: 'bg-st-holidayBg text-st-holiday border-[#CCD6DE]', Icon: Flag },
  NOT_MARKED: { cls: 'bg-st-noneBg text-st-none border-[#D6DAE0]', Icon: CircleDashed },
};

const PRESENCE_STYLE: Record<PresenceState, { cls: string; Icon: typeof CheckCircle2 }> = {
  CURRENTLY_PRESENT: { cls: 'bg-st-liveBg text-st-live border-[#BFD3F0]', Icon: CircleDot },
  CHECKED_OUT: { cls: 'bg-st-presentBg text-st-present border-[#BFDFCB]', Icon: LogOut },
  ABSENT: STATUS_STYLE.ABSENT,
  ON_LEAVE: STATUS_STYLE.LEAVE,
  NOT_MARKED: STATUS_STYLE.NOT_MARKED,
  HALF_DAY: STATUS_STYLE.HALF_DAY,
  HOLIDAY: STATUS_STYLE.HOLIDAY,
};

const base = 'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium';

export function StatusBadge({ status, className }: { status: AttendanceStatus; className?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={clsx(base, s.cls, className)}>
      <s.Icon className="h-3.5 w-3.5" aria-hidden />
      {ATTENDANCE_STATUS_LABELS[status]}
    </span>
  );
}

export function PresenceBadge({ presence, className }: { presence: PresenceState; className?: string }) {
  const s = PRESENCE_STYLE[presence];
  return (
    <span className={clsx(base, s.cls, className)}>
      <s.Icon className="h-3.5 w-3.5" aria-hidden />
      {PRESENCE_LABELS[presence]}
    </span>
  );
}

export function Flag2({ children, tone = 'amber' }: { children: React.ReactNode; tone?: 'amber' | 'red' | 'gray' | 'blue' }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded px-1 py-px text-2xs font-semibold uppercase tracking-wide',
        tone === 'amber' && 'bg-st-leaveBg text-st-leave',
        tone === 'red' && 'bg-st-absentBg text-st-absent',
        tone === 'gray' && 'bg-st-noneBg text-st-none',
        tone === 'blue' && 'bg-st-liveBg text-st-live',
      )}
    >
      {children}
    </span>
  );
}

export const STATUS_DOT: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-st-present',
  ABSENT: 'bg-st-absent',
  LEAVE: 'bg-[#C98A00]',
  HALF_DAY: 'bg-st-half',
  HOLIDAY: 'bg-st-holiday',
  NOT_MARKED: 'bg-[#AAB1BC]',
};
export { STATUS_STYLE };
