import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { CheckCircle2, LogIn, LogOut } from 'lucide-react';
import { formatTimeLocal } from '@nsut/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDuration, monthLabel, unitName } from '../lib/format';
import type { AttRecord, Person, PersonMonth } from '../lib/types';
import { AttendanceCalendar, SummaryStrip } from '../components/AttendanceCalendar';
import { MonthPicker } from '../components/Filters';
import { PanelBox } from '../components/Layout';
import { Flag2, PresenceBadge, StatusBadge } from '../components/Status';
import { DataTable, EmptyState, ErrorState, FormError, Skeleton, TableSkeleton, useToast } from '../components/ui';
import type { PresenceState, TypeRules } from '@nsut/shared';

interface MyToday {
  date: string;
  serverTime: string;
  timezone: string;
  person: Person;
  record: AttRecord | null;
  presence: PresenceState;
  isHoliday: boolean;
  holidayName: string | null;
  isWorkingDay: boolean;
  onApprovedLeave: boolean;
  rules: TypeRules;
  canCheckIn: boolean;
  canCheckOut: boolean;
}

/** Server-aligned clock: display uses the server's time offset, never the device clock blindly. */
function useServerClock(serverTime?: string) {
  const [offset, setOffset] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    if (serverTime) setOffset(Date.parse(serverTime) - Date.now());
  }, [serverTime]);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return Date.now() + offset;
}

export function MyAttendancePage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const today = useQuery({ queryKey: ['my-today'], queryFn: () => api.get<MyToday>('/attendance/me/today'), refetchInterval: 60_000 });
  const tz = today.data?.timezone ?? 'Asia/Kolkata';
  const nowMs = useServerClock(today.data?.serverTime);
  const now = DateTime.fromMillis(nowMs).setZone(tz);
  const [ym, setYm] = useState<{ year: number; month: number } | null>(null);
  const year = ym?.year ?? now.year;
  const month = ym?.month ?? now.month;
  const cal = useQuery({ queryKey: ['person-month', 'me', year, month], queryFn: () => api.get<PersonMonth>('/attendance/me/month', { year, month }) });
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: (kind: 'in' | 'out') => api.post<{ message: string; record: AttRecord }>(kind === 'in' ? '/attendance/check-in' : '/attendance/check-out'),
    onSuccess: (r, kind) => {
      const msg = kind === 'in' ? `Check-in: ${formatTimeLocal(r.record.checkInAt, tz)}` : `Check-out: ${formatTimeLocal(r.record.checkOutAt, tz)} · Duration ${formatDuration(r.record.durationMinutes)}`;
      setConfirmation(`${r.message}. ${msg}`);
      toast({ kind: 'success', title: r.message, body: msg });
      qc.invalidateQueries({ queryKey: ['my-today'] });
      qc.invalidateQueries({ queryKey: ['person-month'] });
    },
    onError: () => qc.invalidateQueries({ queryKey: ['my-today'] }),
  });

  const d = today.data;
  const rec = d?.record;
  const liveMins = rec?.checkInAt && !rec.checkOutAt ? Math.max(0, Math.floor((nowMs - Date.parse(rec.checkInAt)) / 60000)) : rec?.durationMinutes ?? null;
  const history = (cal.data?.days ?? []).filter((x) => x.record).reverse();

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted">{me?.name}</p>
        <h1 className="text-[22px] font-semibold">My Attendance</h1>
        {d && (
          <p className="text-sm text-muted">
            {d.person.refId} · {unitName(d.person)} · Expected {d.rules.officeStart}–{d.rules.officeEnd} (grace {d.rules.graceMinutes} min)
          </p>
        )}
      </div>

      <section className="panel overflow-hidden" aria-labelledby="today-h">
        {today.isLoading ? (
          <div className="p-6">
            <Skeleton className="h-28" />
          </div>
        ) : today.isError ? (
          <ErrorState error={today.error} onRetry={() => today.refetch()} />
        ) : (
          d && (
            <div className="grid md:grid-cols-[1fr_1.1fr]">
              <div className="border-b border-line p-5 md:border-b-0 md:border-r">
                <h2 id="today-h" className="text-2xs font-semibold uppercase tracking-wide text-muted">
                  Today
                </h2>
                <p className="mt-1 text-lg font-semibold text-ink">{DateTime.fromISO(d.date).toFormat('cccc, d MMMM yyyy')}</p>
                <p className="num mt-1 font-mono text-[32px] leading-none text-ink" aria-live="off">
                  {now.toFormat('hh:mm:ss a')}
                </p>
                <p className="mt-1 text-2xs text-muted">Institutional time ({tz})</p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <PresenceBadge presence={d.presence} />
                  {rec?.isLate && <Flag2>Late by {rec.lateMinutes} min</Flag2>}
                  {rec?.isEarlyDeparture && <Flag2>Early by {rec.earlyMinutes} min</Flag2>}
                  {d.isHoliday && <Flag2 tone="gray">Holiday: {d.holidayName}</Flag2>}
                  {!d.isWorkingDay && !d.isHoliday && <Flag2 tone="gray">Non-working day</Flag2>}
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-2xs uppercase tracking-wide text-muted">Check-in</dt>
                    <dd className="num font-semibold">{formatTimeLocal(rec?.checkInAt, tz)}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs uppercase tracking-wide text-muted">Check-out</dt>
                    <dd className="num font-semibold">{formatTimeLocal(rec?.checkOutAt, tz)}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs uppercase tracking-wide text-muted">Duration</dt>
                    <dd className="num font-semibold">{formatDuration(liveMins)}</dd>
                  </div>
                </dl>
              </div>
              <div className="flex flex-col justify-center gap-3 p-5">
                {confirmation && (
                  <div role="status" className="flex items-start gap-2 rounded border border-[#BFDFCB] bg-st-presentBg px-3 py-2.5 text-sm text-st-present">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{confirmation}</span>
                  </div>
                )}
                {d.onApprovedLeave ? (
                  <p className="rounded border border-[#EFD9A8] bg-st-leaveBg px-4 py-6 text-center text-st-leave">You are on approved leave today.</p>
                ) : d.canCheckIn ? (
                  <button
                    type="button"
                    className="flex h-20 w-full items-center justify-center gap-3 rounded-md bg-st-present text-xl font-semibold tracking-wide text-white hover:bg-[#17633A] disabled:opacity-60"
                    onClick={() => act.mutate('in')}
                    disabled={act.isPending}
                    aria-busy={act.isPending}
                  >
                    <LogIn className="h-6 w-6" aria-hidden /> {act.isPending ? 'Marking…' : 'CHECK IN'}
                  </button>
                ) : d.canCheckOut ? (
                  <button
                    type="button"
                    className="flex h-20 w-full items-center justify-center gap-3 rounded-md bg-ink-700 text-xl font-semibold tracking-wide text-white hover:bg-ink-900 disabled:opacity-60"
                    onClick={() => act.mutate('out')}
                    disabled={act.isPending}
                    aria-busy={act.isPending}
                  >
                    <LogOut className="h-6 w-6" aria-hidden /> {act.isPending ? 'Saving…' : 'CHECK OUT'}
                  </button>
                ) : (
                  <p className="rounded border border-line bg-[#FAFBFC] px-4 py-6 text-center text-muted">
                    {rec?.checkOutAt ? 'Attendance complete for today. Thank you.' : rec ? `Today is recorded as ${rec.status.replace('_', ' ').toLowerCase()} by the office.` : 'Attendance is not available right now.'}
                  </p>
                )}
                <FormError error={act.error} />
                <p className="text-center text-xs text-muted">
                  Need to correct a past day? Contact your coordinator. <Link to="/leave">Apply for leave →</Link>
                </p>
              </div>
            </div>
          )
        )}
      </section>

      <PanelBox title={`My month — ${monthLabel(year, month)}`} actions={<MonthPicker year={year} month={month} onChange={(y, m) => setYm({ year: y, month: m })} max={{ year: now.year, month: now.month }} />}>
        {cal.isLoading ? (
          <TableSkeleton rows={5} cols={7} />
        ) : cal.data ? (
          <>
            <SummaryStrip s={cal.data.summary} />
            <div className="p-3 sm:p-4">
              <AttendanceCalendar data={cal.data} />
            </div>
          </>
        ) : (
          <ErrorState error={cal.error} />
        )}
      </PanelBox>

      <PanelBox title="Attendance history">
        {cal.isLoading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : (
          <DataTable
            rows={history}
            rowKey={(x) => x.date}
            empty={<EmptyState title="No attendance records found for this month." />}
            cardTitle={(x) => (
              <div className="flex justify-between">
                <span className="font-medium">{DateTime.fromISO(x.date).toFormat('ccc, dd MMM')}</span>
                <StatusBadge status={x.status} />
              </div>
            )}
            columns={[
              { key: 'date', header: 'Date', hideOnCard: true, cell: (x) => DateTime.fromISO(x.date).toFormat('ccc, dd MMM yyyy') },
              { key: 'status', header: 'Status', hideOnCard: true, cell: (x) => <StatusBadge status={x.status} /> },
              { key: 'in', header: 'In', cell: (x) => <span className="num">{formatTimeLocal(x.record?.checkInAt, tz)} {x.record?.isLate && <Flag2>Late</Flag2>}</span> },
              { key: 'out', header: 'Out', cell: (x) => <span className="num">{formatTimeLocal(x.record?.checkOutAt, tz)}</span> },
              { key: 'dur', header: 'Duration', align: 'right', cell: (x) => formatDuration(x.record?.durationMinutes) },
              { key: 'rem', header: 'Remarks', cell: (x) => <span className="text-xs text-muted">{x.record?.remarks ?? ''}</span> },
            ]}
          />
        )}
      </PanelBox>
    </div>
  );
}
