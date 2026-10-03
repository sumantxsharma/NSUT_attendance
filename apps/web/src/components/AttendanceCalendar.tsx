import { useState } from 'react';
import clsx from 'clsx';
import { DateTime } from 'luxon';
import { ATTENDANCE_STATUS_LABELS, formatDuration, formatTimeLocal, MARKING_METHOD_LABELS, type AttendanceStatus, type MarkingMethod } from '@nsut/shared';
import { useAuth, useTz } from '../lib/auth';
import type { CalendarDay, PersonMonth } from '../lib/types';
import { CorrectionDialog } from './AttendanceDialogs';
import { STATUS_STYLE, StatusBadge, Flag2 } from './Status';
import { Button, Modal } from './ui';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHORT: Record<AttendanceStatus, string> = { PRESENT: 'P', ABSENT: 'A', LEAVE: 'L', HALF_DAY: 'H', HOLIDAY: 'Hol', NOT_MARKED: '—' };

export function AttendanceCalendar({ data, onMark }: { data: PersonMonth; onMark?: (date: string) => void }) {
  const tz = useTz();
  const { can } = useAuth();
  const [selected, setSelected] = useState<CalendarDay | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const first = DateTime.fromObject({ year: data.year, month: data.month, day: 1 });
  const lead = first.weekday - 1;
  const cells: (CalendarDay | null)[] = [...Array(lead).fill(null), ...data.days];
  while (cells.length % 7) cells.push(null);

  return (
    <div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded border border-line bg-line" role="grid" aria-label={`Attendance calendar, ${first.toFormat('MMMM yyyy')}`}>
        <div role="row" className="contents">
          {WEEKDAYS.map((w) => (
            <div key={w} role="columnheader" className="bg-[#F7F8FA] py-1.5 text-center text-2xs font-semibold uppercase tracking-wide text-muted">
              {w}
            </div>
          ))}
        </div>
        {Array.from({ length: cells.length / 7 }, (_, wk) => (
          <div key={wk} role="row" className="contents">
        {cells.slice(wk * 7, wk * 7 + 7).map((d, j) => {
          const i = wk * 7 + j;
          if (!d) return <div key={`e${i}`} className="min-h-[64px] bg-[#FAFBFC] sm:min-h-[84px]" role="gridcell" aria-hidden />;
          const excluded = d.isFuture || !d.inContract;
          const nonWorking = !d.isWorkingDay && !d.record;
          const s = STATUS_STYLE[d.status];
          // Future days show only what is already scheduled (e.g. approved leave); otherwise "upcoming".
          const showStatus = d.inContract && (d.record ? true : !d.isFuture && !(nonWorking && d.status === 'NOT_MARKED'));
          const label = `${DateTime.fromISO(d.date).toFormat('d MMMM')}: ${d.record ? ATTENDANCE_STATUS_LABELS[d.status] : d.isFuture ? 'upcoming' : !d.inContract ? 'outside contract' : nonWorking && d.status === 'NOT_MARKED' ? 'non-working day' : ATTENDANCE_STATUS_LABELS[d.status]}${d.holidayName ? `, ${d.holidayName}` : ''}`;
          return (
            <button
              key={d.date}
              type="button"
              role="gridcell"
              aria-label={label}
              onClick={() => setSelected(d)}
              className={clsx(
                'group relative flex min-h-[64px] flex-col items-start gap-1 p-1.5 text-left transition-colors hover:bg-brand-50 focus-visible:z-10 sm:min-h-[84px] sm:p-2',
                (excluded || nonWorking) && !d.record ? 'bg-[#F4F5F7] text-[#9AA1AC]' : 'bg-white',
                d.isToday && 'ring-2 ring-inset ring-brand-600',
              )}
            >
              <span className={clsx('num text-xs font-semibold', d.isToday ? 'text-brand-700' : 'text-ink')}>{DateTime.fromISO(d.date).day}</span>
              {showStatus && (
                <span className={clsx('inline-flex items-center gap-1 rounded border px-1 py-px text-[10.5px] font-medium', s.cls)}>
                  <s.Icon className="h-3 w-3" aria-hidden />
                  <span className="hidden sm:inline">{ATTENDANCE_STATUS_LABELS[d.status]}</span>
                  <span className="sm:hidden">{SHORT[d.status]}</span>
                </span>
              )}
              {d.record?.checkInAt && <span className="num hidden text-[10.5px] text-muted sm:block">{formatTimeLocal(d.record.checkInAt, tz)}</span>}
              {d.holidayName && <span className="hidden truncate text-[10px] text-st-holiday sm:block">{d.holidayName}</span>}
              {d.record?.isLate && (
                <span className="absolute right-1 top-1 hidden sm:inline">
                  <Flag2>Late</Flag2>
                </span>
              )}
              {d.pendingLeave && (
                <span className="absolute right-1 top-1 hidden sm:inline">
                  <Flag2 tone="gray">Leave?</Flag2>
                </span>
              )}
            </button>
          );
        })}
          </div>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted" aria-label="Legend">
        {(Object.keys(STATUS_STYLE) as AttendanceStatus[]).map((s) => (
          <li key={s}>
            <StatusBadge status={s} />
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm ring-2 ring-brand-600" aria-hidden /> Today
        </li>
        <li className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-line bg-[#FAFBFC]" aria-hidden /> Non-working / outside contract
        </li>
      </ul>

      <Modal
        open={!!selected && !correcting}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected ? DateTime.fromISO(selected.date).toFormat('cccc, dd MMMM yyyy') : ''}
        description={data.person.fullName}
        footer={
          selected && (
            <>
              {selected.record && can('attendance.correct') && (
                <Button variant="primary" onClick={() => setCorrecting(true)}>
                  Correct record
                </Button>
              )}
              {!selected.record && !selected.isFuture && can('attendance.mark') && onMark && (
                <Button
                  variant="primary"
                  onClick={() => {
                    const d = selected.date;
                    setSelected(null);
                    onMark(d);
                  }}
                >
                  Mark attendance
                </Button>
              )}
              <Button onClick={() => setSelected(null)}>Close</Button>
            </>
          )
        }
      >
        {selected && (
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
            <dt className="text-muted">Status</dt>
            <dd>
              <StatusBadge status={selected.status} />
            </dd>
            {selected.holidayName && (
              <>
                <dt className="text-muted">Holiday</dt>
                <dd>{selected.holidayName}</dd>
              </>
            )}
            <dt className="text-muted">In-time</dt>
            <dd className="num">
              {formatTimeLocal(selected.record?.checkInAt, tz)} {selected.record?.isLate && <Flag2>Late by {selected.record.lateMinutes} min</Flag2>}
            </dd>
            <dt className="text-muted">Out-time</dt>
            <dd className="num">
              {formatTimeLocal(selected.record?.checkOutAt, tz)} {selected.record?.isEarlyDeparture && <Flag2>Early by {selected.record.earlyMinutes} min</Flag2>}
              {selected.record?.isIncomplete && <Flag2 tone="red">No check-out</Flag2>}
            </dd>
            <dt className="text-muted">Duration</dt>
            <dd className="num">{formatDuration(selected.record?.durationMinutes)}</dd>
            <dt className="text-muted">Marked via</dt>
            <dd>
              {selected.record ? MARKING_METHOD_LABELS[selected.record.markingMethod as MarkingMethod] : '—'}
              {selected.record?.markedByName && <span className="text-muted"> · {selected.record.markedByName}</span>}
            </dd>
            <dt className="text-muted">Remarks</dt>
            <dd>{selected.record?.remarks ?? '—'}</dd>
            <dt className="text-muted">Counted as</dt>
            <dd>
              {selected.evaluation.outcome === 'COUNTED' ? `Working day · ${selected.evaluation.credit} credit` : `Excluded — ${selected.evaluation.reason}`}
            </dd>
            {selected.pendingLeave && (
              <>
                <dt className="text-muted">Leave</dt>
                <dd>A leave request covering this day is pending review.</dd>
              </>
            )}
          </dl>
        )}
      </Modal>
      <CorrectionDialog
        open={correcting}
        onOpenChange={(o) => {
          setCorrecting(o);
          if (!o) setSelected(null);
        }}
        record={selected?.record ?? null}
        personName={data.person.fullName}
      />
    </div>
  );
}

export function SummaryStrip({ s }: { s: PersonMonth['summary'] }) {
  const items = [
    ['Working days', s.eligibleDays],
    ['Present', s.present],
    ['Half days', s.halfDays],
    ['Absent', s.absent],
    ['Not marked', s.notMarked],
    ['Leave', s.leave],
  ] as const;
  return (
    <dl className="grid grid-cols-3 divide-x divide-y divide-line border-y border-line sm:grid-cols-7 sm:divide-y-0">
      {items.map(([k, v]) => (
        <div key={k} className="px-3 py-2.5">
          <dt className="text-2xs uppercase tracking-wide text-muted">{k}</dt>
          <dd className="num text-lg font-semibold text-ink">{v}</dd>
        </div>
      ))}
      <div className="col-span-3 bg-brand-50/60 px-3 py-2.5 sm:col-span-1">
        <dt className="text-2xs uppercase tracking-wide text-brand-700">Attendance</dt>
        <dd className="num text-lg font-semibold text-brand-800">{s.percentage === null ? '—' : `${s.percentage.toFixed(1)}%`}</dd>
      </div>
    </dl>
  );
}
