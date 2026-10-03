import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import clsx from 'clsx';
import { CalendarDays, ClipboardEdit, Info, Plus } from 'lucide-react';
import { ATTENDANCE_STATUS_LABELS, formatDateTimeLocal, formatTimeLocal, PERSON_TYPE_LABELS, PRESENCE_LABELS, type AttendanceStatus, type PersonType } from '@nsut/shared';
import { api } from '../lib/api';
import { useAuth, useTz } from '../lib/auth';
import { formatDuration, monthLabel, nowParts, pct, unitName } from '../lib/format';
import { useUrlState } from '../lib/hooks';
import type { AttRecord, DailySheet, MonthlyRow, PersonMonth, SheetRow } from '../lib/types';
import { AttendanceCalendar, SummaryStrip } from '../components/AttendanceCalendar';
import { CorrectionDialog, ManualMarkDialog } from '../components/AttendanceDialogs';
import { cleanFilters, FilterBar, MonthPicker, usePeopleOptions, type FilterValues } from '../components/Filters';
import { PanelBox } from '../components/Layout';
import { Flag2, PresenceBadge, StatusBadge } from '../components/Status';
import { Avatar, Button, DataTable, EmptyState, ErrorState, Modal, PageHeader, TableSkeleton, useToast } from '../components/ui';
import { LiveTable } from './DashboardPage';

// ============================================================ Today / daily sheet
export function TodayAttendancePage() {
  const tz = useTz();
  const { can } = useAuth();
  const today = nowParts(tz).date;
  const [f, setF] = useUrlState<{ date?: string; type?: string; departmentId?: string; activityId?: string; status?: string; q?: string }>({});
  const date = f.date ?? today;
  const q = useQuery({ queryKey: ['daily', date, f], queryFn: () => api.get<DailySheet>('/attendance/daily', { ...cleanFilters(f as FilterValues), date }) });
  const [marking, setMarking] = useState<{ person?: SheetRow['person'] } | null>(null);
  const [correcting, setCorrecting] = useState<{ record: AttRecord; name: string } | null>(null);
  const d = q.data;

  const statusOptions = [
    ...(['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'NOT_MARKED', 'HOLIDAY'] as AttendanceStatus[]).map((s) => ({ value: s, label: ATTENDANCE_STATUS_LABELS[s] })),
    { value: 'CURRENTLY_PRESENT', label: PRESENCE_LABELS.CURRENTLY_PRESENT },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Attendance"
        title={date === today ? "Today's Attendance" : 'Daily Attendance'}
        subtitle={
          <>
            {DateTime.fromISO(date).toFormat('cccc, d MMMM yyyy')}
            {d?.isHoliday && <span className="ml-2 font-medium text-st-holiday">· Holiday: {d.holidayName}</span>}
          </>
        }
        actions={
          <>
            <Link to={`/reports/daily?date=${date}`} className="btn-secondary no-underline">
              Report / export
            </Link>
            {can('attendance.mark') && (
              <Button variant="primary" onClick={() => setMarking({})}>
                <Plus className="h-4 w-4" /> Mark attendance
              </Button>
            )}
          </>
        }
      />
      <PanelBox
        title={
          d ? (
            <span className="text-sm font-normal text-muted">
              <b className="text-ink">{d.counts.total}</b> people · <b className="text-st-present">{d.counts.present}</b> present · <b className="text-st-absent">{d.counts.absent}</b> absent ·{' '}
              <b className="text-st-leave">{d.counts.onLeave}</b> on leave · <b>{d.counts.notMarked}</b> not marked
            </span>
          ) : (
            'Loading…'
          )
        }
      >
        <div className="border-b border-line px-4 py-3">
          <FilterBar value={f as FilterValues} onChange={(v) => setF({ ...v, date: f.date } as any, true)} show={['q', 'type', 'department', 'activity', 'status']} statusOptions={statusOptions}>
            <label>
              <span className="sr-only">Date</span>
              <input type="date" className="input w-auto" max={today} value={date} onChange={(e) => setF({ date: e.target.value === today ? undefined : e.target.value })} />
            </label>
          </FilterBar>
        </div>
        {q.isLoading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={d!.rows}
            rowKey={(r) => r.person.id}
            caption="Daily attendance"
            empty={<EmptyState title="No attendance records found for the selected filters." body="Try clearing a filter or choosing another date." />}
            cardTitle={(r) => (
              <div className="flex items-center justify-between gap-2">
                <Link to={`/people/${r.person.id}`} className="font-medium">
                  {r.person.fullName}
                </Link>
                <PresenceBadge presence={r.presence} />
              </div>
            )}
            columns={[
              {
                key: 'name',
                header: 'Name',
                hideOnCard: true,
                sortValue: (r) => r.person.fullName,
                cell: (r) => (
                  <div className="flex items-center gap-2.5">
                    <Avatar name={r.person.fullName} personId={r.person.id} hasPhoto={r.person.hasPhoto} size={28} />
                    <div>
                      <Link to={`/people/${r.person.id}`} className="whitespace-nowrap font-medium text-ink">
                        {r.person.fullName}
                      </Link>
                      <p className="whitespace-nowrap font-mono text-2xs text-muted">{r.person.refId}</p>
                    </div>
                  </div>
                ),
              },
              { key: 'type', header: 'Type', sortValue: (r) => r.person.type, cell: (r) => <span className="whitespace-nowrap">{PERSON_TYPE_LABELS[r.person.type]}</span> },
              { key: 'unit', header: 'Department / Sport', sortValue: (r) => unitName(r.person), cell: (r) => <span className="text-[13px]">{unitName(r.person)}</span> },
              { key: 'status', header: 'Status', hideOnCard: true, sortValue: (r) => r.presence, cell: (r) => (r.status === 'NOT_MARKED' && !r.isWorkingDay ? <span className="text-xs text-muted">Non-working day</span> : <PresenceBadge presence={r.presence} />) },
              {
                key: 'in',
                header: 'In-Time',
                sortValue: (r) => r.record?.checkInAt ?? null,
                cell: (r) => (
                  <span className="num whitespace-nowrap">
                    {formatTimeLocal(r.record?.checkInAt, tz)} {r.record?.isLate && <Flag2>+{r.record.lateMinutes}m</Flag2>}
                  </span>
                ),
              },
              {
                key: 'out',
                header: 'Out-Time',
                sortValue: (r) => r.record?.checkOutAt ?? null,
                cell: (r) => (
                  <span className="num whitespace-nowrap">
                    {formatTimeLocal(r.record?.checkOutAt, tz)} {r.record?.isEarlyDeparture && <Flag2>Early</Flag2>} {r.record?.isIncomplete && <Flag2 tone="red">No out</Flag2>}
                  </span>
                ),
              },
              { key: 'dur', header: 'Duration', align: 'right', sortValue: (r) => r.currentMinutes, cell: (r) => formatDuration(r.currentMinutes) },
              { key: 'remarks', header: 'Remarks', cell: (r) => <span className="line-clamp-1 max-w-[180px] text-xs text-muted">{r.record?.remarks ?? ''}</span> },
              ...(can('attendance.mark') || can('attendance.correct')
                ? [
                    {
                      key: 'act',
                      header: <span className="sr-only">Actions</span>,
                      align: 'right' as const,
                      cell: (r: SheetRow) =>
                        r.record
                          ? can('attendance.correct') && (
                              <Button size="sm" variant="ghost" onClick={() => setCorrecting({ record: r.record!, name: r.person.fullName })} aria-label={`Correct attendance for ${r.person.fullName}`}>
                                <ClipboardEdit className="h-4 w-4" /> Correct
                              </Button>
                            )
                          : can('attendance.mark') &&
                            r.person.status === 'ACTIVE' && (
                              <Button size="sm" onClick={() => setMarking({ person: r.person })} aria-label={`Mark attendance for ${r.person.fullName}`}>
                                Mark
                              </Button>
                            ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </PanelBox>
      <ManualMarkDialog open={!!marking} onOpenChange={(o) => !o && setMarking(null)} preset={{ date, person: marking?.person }} maxDate={today} />
      <CorrectionDialog open={!!correcting} onOpenChange={(o) => !o && setCorrecting(null)} record={correcting?.record ?? null} personName={correcting?.name ?? ''} />
    </div>
  );
}

// ============================================================ Live presence
export function LivePresencePage() {
  const tz = useTz();
  const [f, setF] = useUrlState<{ type?: string; departmentId?: string; activityId?: string; status?: string }>({});
  const q = useQuery({ queryKey: ['daily', 'live', f], queryFn: () => api.get<DailySheet>('/attendance/today', cleanFilters(f as FilterValues)), refetchInterval: 30_000 });
  const d = q.data;
  const groups: { key: string; label: string; match: (r: SheetRow) => boolean }[] = [
    { key: 'CURRENTLY_PRESENT', label: 'Currently Present', match: (r) => r.presence === 'CURRENTLY_PRESENT' },
    { key: 'CHECKED_OUT', label: 'Checked Out', match: (r) => r.presence === 'CHECKED_OUT' || r.presence === 'HALF_DAY' },
    { key: 'ABSENT', label: 'Absent', match: (r) => r.presence === 'ABSENT' },
    { key: 'ON_LEAVE', label: 'On Leave', match: (r) => r.presence === 'ON_LEAVE' },
    { key: 'NOT_MARKED', label: 'Not Marked', match: (r) => r.presence === 'NOT_MARKED' || r.presence === 'HOLIDAY' },
  ];
  const sel = f.status;
  const rows = d ? (sel ? d.rows.filter(groups.find((g) => g.key === sel)?.match ?? (() => true)) : d.rows) : [];
  return (
    <div>
      <PageHeader
        eyebrow="Attendance"
        title="Who is Present Now?"
        subtitle={d ? `As of ${DateTime.now().setZone(tz).toFormat('hh:mm a')} · refreshes every 30 seconds` : 'Loading…'}
      />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Presence state">
        <button role="tab" aria-selected={!sel} className={clsx('btn-sm btn', !sel ? 'border-ink-700 bg-ink-700 text-white' : 'border-line bg-white')} onClick={() => setF({ status: undefined })}>
          Everyone <span className="num">{d?.rows.length ?? ''}</span>
        </button>
        {groups.map((g) => (
          <button key={g.key} role="tab" aria-selected={sel === g.key} className={clsx('btn-sm btn', sel === g.key ? 'border-ink-700 bg-ink-700 text-white' : 'border-line bg-white')} onClick={() => setF({ status: g.key })}>
            {g.label} <span className="num">{d ? d.rows.filter(g.match).length : ''}</span>
          </button>
        ))}
      </div>
      <PanelBox>
        <div className="border-b border-line px-4 py-3">
          <FilterBar value={f as FilterValues} onChange={(v) => setF({ ...v, status: f.status } as any, true)} show={['type', 'department', 'activity']} />
        </div>
        {q.isLoading ? <TableSkeleton rows={8} cols={7} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <LiveTable rows={rows} tz={tz} showExpected />}
      </PanelBox>
    </div>
  );
}

// ============================================================ Calendar
export function CalendarPage() {
  const tz = useTz();
  const now = nowParts(tz);
  const [f, setF] = useUrlState<{ personId?: string; year?: string; month?: string }>({});
  const people = usePeopleOptions();
  const personId = f.personId ?? people.data?.find((p) => p.status === 'ACTIVE')?.id;
  const year = Number(f.year ?? now.year);
  const month = Number(f.month ?? now.month);
  const q = useQuery({ queryKey: ['person-month', personId, year, month], queryFn: () => api.get<PersonMonth>(`/attendance/person/${personId}`, { year, month }), enabled: !!personId });
  const [marking, setMarking] = useState<string | null>(null);
  return (
    <div>
      <PageHeader
        eyebrow="Attendance"
        title="Attendance Calendar"
        subtitle="Select a person and month. Click a date for details."
        actions={
          <>
            <label>
              <span className="sr-only">Person</span>
              <select className="input w-auto max-w-[280px]" value={personId ?? ''} onChange={(e) => setF({ personId: e.target.value })}>
                {(people.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} ({p.refId}){p.status === 'INACTIVE' ? ' — inactive' : ''}
                  </option>
                ))}
              </select>
            </label>
            <MonthPicker year={year} month={month} onChange={(y, m) => setF({ year: String(y), month: String(m) })} max={now} />
          </>
        }
      />
      {q.isLoading || !personId ? (
        <div className="panel p-4">
          <TableSkeleton rows={5} cols={7} />
        </div>
      ) : q.isError ? (
        <div className="panel">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : (
        q.data && (
          <PanelBox
            title={
              <span>
                <Link to={`/people/${q.data.person.id}`}>{q.data.person.fullName}</Link> <span className="font-normal text-muted">— {monthLabel(year, month)}</span>
              </span>
            }
            actions={
              <Link to={`/reports/individual?personId=${personId}&year=${year}&month=${month}`} className="btn-secondary btn-sm no-underline">
                Individual report
              </Link>
            }
          >
            <SummaryStrip s={q.data.summary} />
            <div className="p-3 sm:p-4">
              <AttendanceCalendar data={q.data} onMark={(d) => setMarking(d)} />
            </div>
          </PanelBox>
        )
      )}
      <ManualMarkDialog open={!!marking} onOpenChange={(o) => !o && setMarking(null)} preset={{ date: marking ?? undefined, person: q.data?.person }} maxDate={now.date} />
    </div>
  );
}

// ============================================================ Monthly
export function MonthlyPage() {
  const tz = useTz();
  const now = nowParts(tz);
  const nav = useNavigate();
  const [f, setF] = useUrlState<{ year?: string; month?: string; type?: string; departmentId?: string; activityId?: string; personId?: string; q?: string }>({});
  const year = Number(f.year ?? now.year);
  const month = Number(f.month ?? now.month);
  const filters = cleanFilters({ type: f.type as PersonType, departmentId: f.departmentId, activityId: f.activityId, personId: f.personId, q: f.q });
  const q = useQuery({ queryKey: ['monthly', year, month, filters], queryFn: () => api.get<{ rows: MonthlyRow[] }>('/attendance/monthly', { year, month, ...filters }) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ formula: string[] }>('/settings') });
  const [showFormula, setShowFormula] = useState(false);
  const rows = q.data?.rows ?? [];
  const elig = rows.reduce((s, r) => s + r.eligibleDays, 0);
  const cred = rows.reduce((s, r) => s + r.credits, 0);
  return (
    <div>
      <PageHeader
        eyebrow="Attendance"
        title="Monthly Records"
        subtitle={`${monthLabel(year, month)} · ${rows.length} people · overall ${pct(elig ? Math.round((cred / elig) * 1000) / 10 : null)}`}
        actions={
          <>
            <Button onClick={() => setShowFormula(true)}>
              <Info className="h-4 w-4" /> How % is calculated
            </Button>
            <Link to={`/reports/monthly?year=${year}&month=${month}${Object.entries(filters).map(([k, v]) => `&${k}=${v}`).join('')}`} className="btn-secondary no-underline">
              Report / export
            </Link>
          </>
        }
      />
      <PanelBox>
        <div className="border-b border-line px-4 py-3">
          <FilterBar value={f as FilterValues} onChange={(v) => setF({ ...v, year: f.year, month: f.month } as any, true)} show={['q', 'type', 'department', 'activity', 'person']}>
            <MonthPicker year={year} month={month} onChange={(y, m) => setF({ year: String(y), month: String(m) })} max={now} />
          </FilterBar>
        </div>
        {q.isLoading ? (
          <TableSkeleton rows={10} cols={8} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={rows}
            rowKey={(r) => r.person.id}
            caption="Monthly attendance"
            defaultSort={{ key: 'name', dir: 'asc' }}
            onRowClick={(r) => nav(`/attendance/calendar?personId=${r.person.id}&year=${year}&month=${month}`)}
            empty={<EmptyState title="No attendance records found for the selected filters." />}
            cardTitle={(r) => (
              <div className="flex justify-between">
                <span className="font-medium">{r.person.fullName}</span>
                <span className="num font-semibold">{pct(r.percentage)}</span>
              </div>
            )}
            columns={[
              {
                key: 'name',
                header: 'Person',
                hideOnCard: true,
                sortValue: (r) => r.person.fullName,
                cell: (r) => (
                  <div>
                    <Link to={`/people/${r.person.id}`} className="font-medium text-ink">
                      {r.person.fullName}
                    </Link>
                    {r.person.status === 'INACTIVE' && <Flag2 tone="gray">Inactive</Flag2>}
                    <p className="text-xs text-muted">
                      {PERSON_TYPE_LABELS[r.person.type]} · {unitName(r.person)}
                    </p>
                  </div>
                ),
              },
              { key: 'wd', header: 'Working Days', align: 'right', sortValue: (r) => r.eligibleDays, cell: (r) => r.eligibleDays },
              { key: 'p', header: 'Present', align: 'right', sortValue: (r) => r.present, cell: (r) => r.present },
              { key: 'a', header: 'Absent', align: 'right', sortValue: (r) => r.absent + r.notMarked, cell: (r) => (
                <span title={`${r.absent} absent, ${r.notMarked} not marked`}>
                  {r.absent + r.notMarked}
                  {r.notMarked > 0 && <span className="text-2xs text-muted"> ({r.notMarked} n/m)</span>}
                </span>
              ) },
              { key: 'l', header: 'Leave', align: 'right', sortValue: (r) => r.leave, cell: (r) => r.leave },
              { key: 'h', header: 'Half Days', align: 'right', sortValue: (r) => r.halfDays, cell: (r) => r.halfDays },
              { key: 'late', header: 'Late', align: 'right', sortValue: (r) => r.late, cell: (r) => r.late },
              { key: 'hrs', header: 'Hours', align: 'right', sortValue: (r) => r.totalMinutes, cell: (r) => (r.totalMinutes / 60).toFixed(1) },
              {
                key: 'pct',
                header: 'Attendance %',
                align: 'right',
                sortValue: (r) => r.percentage,
                cell: (r) => <span className={clsx('num font-semibold', r.percentage !== null && r.percentage < 75 ? 'text-st-absent' : 'text-ink')}>{pct(r.percentage)}</span>,
              },
            ]}
          />
        )}
      </PanelBox>
      <Modal open={showFormula} onOpenChange={setShowFormula} title="How attendance % is calculated" description="Derived from database records under the current institutional rules.">
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          {(settings.data?.formula ?? []).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          “Absent” in this table includes working days with no record (“n/m” = not marked). Rules can be changed by a Super Admin under <Link to="/admin/rules">Attendance Rules</Link>.
        </p>
      </Modal>
    </div>
  );
}

// ============================================================ Corrections
interface CorrectionRow {
  id: string;
  attendanceId: string | null;
  personId: string;
  personName: string;
  refId: string;
  date: string;
  previous: any;
  proposed: any;
  reason: string;
  status: 'PENDING' | 'APPLIED' | 'REJECTED';
  requestedAt: string;
  requestedBy: string | null;
  requestedById: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewRemarks: string | null;
}

export function describeSnapshot(v: any, tz: string) {
  if (!v) return '—';
  if (v.deleted) return 'Record deleted';
  const st = v.status ? ATTENDANCE_STATUS_LABELS[v.status as AttendanceStatus] ?? v.status : '';
  const inT = v.checkInAt ? formatTimeLocal(v.checkInAt, tz) : v.checkIn ? DateTime.fromFormat(v.checkIn, 'HH:mm').toFormat('hh:mm a') : null;
  const outT = v.checkOutAt ? formatTimeLocal(v.checkOutAt, tz) : v.checkOut ? DateTime.fromFormat(v.checkOut, 'HH:mm').toFormat('hh:mm a') : null;
  return `${st}${inT ? ` · ${inT} – ${outT ?? '—'}` : ''}`;
}

export function CorrectionsPage() {
  const tz = useTz();
  const { can, me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useUrlState<{ status?: string }>({});
  const q = useQuery({ queryKey: ['corrections', f.status], queryFn: () => api.get<CorrectionRow[]>('/attendance/corrections/list', { status: f.status }) });
  const review = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => api.patch(`/attendance/corrections/${id}/${decision}`, {}),
    onSuccess: (_d, v) => {
      toast({ kind: 'success', title: v.decision === 'approve' ? 'Correction applied' : 'Correction rejected' });
      qc.invalidateQueries({ queryKey: ['corrections'] });
      qc.invalidateQueries({ queryKey: ['daily'] });
    },
    onError: (e: Error) => toast({ kind: 'error', title: 'Could not review correction', body: e.message }),
  });
  return (
    <div>
      <PageHeader eyebrow="Attendance" title="Attendance Corrections" subtitle="Every change to an attendance record, with the previous value, new value and reason." />
      <div className="mb-3 flex gap-2" role="tablist">
        {[
          ['', 'All'],
          ['PENDING', 'Awaiting approval'],
          ['APPLIED', 'Applied'],
          ['REJECTED', 'Rejected'],
        ].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={(f.status ?? '') === k} className={clsx('btn btn-sm', (f.status ?? '') === k ? 'border-ink-700 bg-ink-700 text-white' : 'border-line bg-white')} onClick={() => setF({ status: k || undefined })}>
            {l}
          </button>
        ))}
      </div>
      <PanelBox>
        {q.isLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : q.isError ? (
          <ErrorState error={q.error} />
        ) : (
          <DataTable
            rows={q.data!}
            rowKey={(r) => r.id}
            empty={<EmptyState icon={<CalendarDays className="h-8 w-8" />} title="No corrections found." body="Corrections made from the daily sheet, calendar or profile appear here." />}
            cardTitle={(r) => <span className="font-medium">{r.personName}</span>}
            columns={[
              { key: 'when', header: 'Requested', sortValue: (r) => r.requestedAt, cell: (r) => <span className="num text-xs">{formatDateTimeLocal(r.requestedAt, tz)}</span> },
              { key: 'person', header: 'Person', hideOnCard: true, cell: (r) => <Link to={`/people/${r.personId}`}>{r.personName}</Link> },
              { key: 'date', header: 'Date', sortValue: (r) => r.date, cell: (r) => DateTime.fromISO(r.date).toFormat('dd MMM yyyy') },
              { key: 'prev', header: 'Previous', cell: (r) => <span className="text-xs">{describeSnapshot(r.previous, tz)}</span> },
              { key: 'new', header: 'Changed to', cell: (r) => <span className="text-xs font-medium">{describeSnapshot(r.proposed, tz)}</span> },
              { key: 'reason', header: 'Reason', cell: (r) => <span className="line-clamp-2 max-w-[220px] text-xs">{r.reason}</span> },
              { key: 'by', header: 'By', cell: (r) => <span className="text-xs">{r.requestedBy ?? '—'}</span> },
              {
                key: 'status',
                header: 'Status',
                cell: (r) =>
                  r.status === 'PENDING' ? (
                    can('attendance.correction.review') && r.requestedById !== me?.id ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="primary" loading={review.isPending && review.variables?.id === r.id} onClick={() => review.mutate({ id: r.id, decision: 'approve' })}>
                          Approve
                        </Button>
                        <Button size="sm" onClick={() => review.mutate({ id: r.id, decision: 'reject' })}>
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <Flag2>Pending</Flag2>
                    )
                  ) : (
                    <Flag2 tone={r.status === 'APPLIED' ? 'blue' : 'red'}>{r.status === 'APPLIED' ? 'Applied' : 'Rejected'}</Flag2>
                  ),
              },
            ]}
          />
        )}
      </PanelBox>
    </div>
  );
}

export { StatusBadge };
