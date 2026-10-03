import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, CalendarClock, ClipboardList, Minus, RefreshCw } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PERSON_TYPE_LABELS, type PersonType, type PresenceState } from '@nsut/shared';
import { api } from '../lib/api';
import { useAuth, useTz } from '../lib/auth';
import { formatDuration, formatTimeLocal, greeting, monthLabel, pct, relativeTime, unitName } from '../lib/format';
import type { Counts, SheetRow } from '../lib/types';
import { PanelBox } from '../components/Layout';
import { PresenceBadge, Flag2 } from '../components/Status';
import { Avatar, DataTable, EmptyState, ErrorState, Skeleton, TableSkeleton } from '../components/ui';

interface DashboardData {
  date: string;
  serverTime: string;
  timezone: string;
  isHoliday: boolean;
  holidayName: string | null;
  counts: Counts;
  live: SheetRow[];
  percentages: {
    month: { year: number; month: number; overall: number | null; guestFaculty: number | null; sportsCoaches: number | null };
    previous: { year: number; month: number; overall: number | null; guestFaculty: number | null; sportsCoaches: number | null };
  };
  trend: { date: string; overall: number | null; guestFaculty: number | null; sportsCoaches: number | null; eligible: number }[];
  units: { key: string; name: string; kind: 'department' | 'activity'; people: number; presentToday: number; absentToday: number; leaveToday: number; notMarkedToday: number; monthPercentage: number | null }[];
  recent: { kind: string; at: string; personId: string; personName: string; detail: string | null; actor: string | null }[];
  pendingLeave: number;
  contractsExpiring: { id: string; fullName: string; contractEnd: string }[];
}

const PRESENCE_ORDER: PresenceState[] = ['CURRENTLY_PRESENT', 'CHECKED_OUT', 'HALF_DAY', 'ON_LEAVE', 'ABSENT', 'NOT_MARKED', 'HOLIDAY'];

function Delta({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur === null || prev === null) return <span className="text-xs text-muted">No comparison</span>;
  const d = Math.round((cur - prev) * 10) / 10;
  const Icon = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus;
  return (
    <span className={clsx('inline-flex items-center gap-0.5 text-xs font-medium', d > 0 ? 'text-st-present' : d < 0 ? 'text-st-absent' : 'text-muted')}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {d > 0 ? '+' : ''}
      {d.toFixed(1)} pts <span className="font-normal text-muted">vs {pct(prev)} last month</span>
    </span>
  );
}

export function DashboardPage() {
  const { me } = useAuth();
  const tz = useTz();
  const [type, setType] = useState<PersonType | ''>('');
  const q = useQuery({
    queryKey: ['dashboard', type],
    queryFn: () => api.get<DashboardData>('/dashboard', { type: type || undefined }),
    refetchInterval: 60_000,
  });
  const d = q.data;
  const scoped = me?.role === 'COORDINATOR';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            {greeting(tz)}, {me?.name.split(' ').slice(0, 2).join(' ')}
          </p>
          <h1 className="text-[22px] font-semibold leading-tight">Attendance Overview — {DateTime.now().setZone(tz).toFormat('d MMMM yyyy')}</h1>
          <p className="mt-0.5 text-xs text-muted">
            {scoped ? `Showing your assigned ${me!.scopes.map((s) => s.departmentName ?? s.activityName).join(', ')}. ` : ''}
            {d ? `Updated ${DateTime.fromISO(d.serverTime).setZone(tz).toFormat('hh:mm a')} · refreshes every minute` : 'Loading…'}
            {d?.isHoliday && <span className="ml-2 font-medium text-st-holiday">Holiday: {d.holidayName}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2" data-noprint>
          <div className="inline-flex rounded border border-[#C5CBD4] bg-white p-0.5" role="group" aria-label="Filter by type">
            {(['', 'GUEST_FACULTY', 'SPORTS_COACH'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)} className={clsx('rounded-sm px-3 py-1.5 text-[13px]', type === t ? 'bg-ink-700 text-white' : 'text-ink hover:bg-[#F0F2F5]')}>
                {t ? PERSON_TYPE_LABELS[t] : 'All'}
              </button>
            ))}
          </div>
          <button className="btn-secondary btn-sm" onClick={() => q.refetch()} aria-label="Refresh" disabled={q.isFetching}>
            <RefreshCw className={clsx('h-4 w-4', q.isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {q.isError && (
        <div className="panel">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </div>
      )}

      {/* Today's overview — one strip, not a wall of cards */}
      <section className="panel" aria-label="Today's overview">
        {!d ? (
          <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 lg:grid-cols-7">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : (
          <ul className="grid grid-cols-2 divide-line sm:grid-cols-4 lg:grid-cols-7 lg:divide-x [&>*]:border-b [&>*]:border-line lg:[&>*]:border-b-0">
            <OverviewStat label="Total personnel" value={d.counts.total} sub={`${d.counts.guestFaculty} faculty · ${d.counts.sportsCoaches} coaches`} to="/attendance/today" />
            <OverviewStat label="Present today" value={d.counts.present} tone="bg-st-present" sub={d.counts.total ? `${Math.round((d.counts.present / d.counts.total) * 100)}% of personnel` : undefined} to="/attendance/today?status=PRESENT" />
            <OverviewStat label="Currently present" value={d.counts.currentlyPresent} tone="bg-st-live" sub="Checked in, not out" to="/attendance/live" />
            <OverviewStat label="Absent" value={d.counts.absent} tone="bg-st-absent" to="/attendance/today?status=ABSENT" />
            <OverviewStat label="On leave" value={d.counts.onLeave} tone="bg-[#C98A00]" to="/attendance/today?status=LEAVE" />
            <OverviewStat label="Not marked" value={d.counts.notMarked} tone="bg-[#AAB1BC]" sub="Working day, no record" to="/attendance/today?status=NOT_MARKED" />
            <OverviewStat label="Late arrivals" value={d.counts.late} sub="After grace period" to="/reports/late" />
          </ul>
        )}
      </section>

          {/* Live presence */}
      <PanelBox
        title="Live Presence"
        actions={
          <Link to="/attendance/live" className="text-sm">
            Open full view →
          </Link>
        }
      >
        {!d ? (
          <TableSkeleton rows={6} cols={6} />
        ) : (
          <LiveTable rows={[...d.live].sort((a, b) => PRESENCE_ORDER.indexOf(a.presence) - PRESENCE_ORDER.indexOf(b.presence) || a.person.fullName.localeCompare(b.person.fullName)).slice(0, 10)} tz={tz} />
        )}
        {d && d.live.length > 10 && (
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            Showing 10 of {d.live.length}. <Link to="/attendance/today">See everyone</Link>
          </p>
        )}
      </PanelBox>


      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {/* Trend */}
          <PanelBox title="Attendance Trend — last 30 days" actions={<span className="text-xs text-muted">Daily attendance % among people expected that day</span>}>
            <div className="h-[260px] px-2 py-3">{d ? <TrendChart data={d.trend} /> : <Skeleton className="h-full" />}</div>
          </PanelBox>

          {/* Department / activity */}
          <PanelBox title="Department / Activity Summary" actions={d && <span className="text-xs text-muted">Today, and {monthLabel(d.percentages.month.year, d.percentages.month.month)} to date</span>}>
            {!d ? <TableSkeleton rows={5} cols={6} /> : <UnitsTable units={d.units} />}
          </PanelBox>
        </div>

        <div className="space-y-5">
          {/* Attendance % */}
          <PanelBox title={d ? `Attendance % — ${monthLabel(d.percentages.month.year, d.percentages.month.month)}` : 'Attendance %'}>
            {!d ? (
              <div className="space-y-3 p-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : (
              <dl className="divide-y divide-line">
                {(
                  [
                    ['Overall', 'overall'],
                    ['Guest Faculty', 'guestFaculty'],
                    ['Sports Coaches', 'sportsCoaches'],
                  ] as const
                ).map(([label, k]) => (
                  <div key={k} className="flex items-baseline justify-between gap-2 px-4 py-3">
                    <dt className="text-sm text-ink">{label}</dt>
                    <dd className="text-right">
                      <span className="num block text-xl font-semibold text-ink">{pct(d.percentages.month[k])}</span>
                      <Delta cur={d.percentages.month[k]} prev={d.percentages.previous[k]} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {d && (
              <p className="border-t border-line px-4 py-2 text-2xs text-muted">
                Calculated from records under the current <Link to="/admin/rules">attendance rules</Link>.
              </p>
            )}
          </PanelBox>

          {d && (d.pendingLeave > 0 || d.contractsExpiring.length > 0) && (
            <PanelBox title="Needs attention">
              <ul className="divide-y divide-line text-sm">
                {d.pendingLeave > 0 && (
                  <li className="flex items-center gap-3 px-4 py-3">
                    <ClipboardList className="h-4 w-4 text-st-leave" aria-hidden />
                    <Link to="/leave?status=PENDING">
                      {d.pendingLeave} leave request{d.pendingLeave > 1 ? 's' : ''} awaiting review
                    </Link>
                  </li>
                )}
                {d.contractsExpiring.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <CalendarClock className="h-4 w-4 text-muted" aria-hidden />
                    <span>
                      <Link to={`/people/${c.id}`}>{c.fullName}</Link> — contract ends {DateTime.fromISO(c.contractEnd).toFormat('dd MMM yyyy')}
                    </span>
                  </li>
                ))}
              </ul>
            </PanelBox>
          )}

          <PanelBox title="Recent Activity">
            {!d ? (
              <TableSkeleton rows={6} cols={1} />
            ) : d.recent.length === 0 ? (
              <EmptyState title="No recent activity" />
            ) : (
              <ol className="divide-y divide-line">
                {d.recent.map((r, i) => (
                  <li key={i} className="px-4 py-2.5 text-sm">
                    <p>
                      <Link to={`/people/${r.personId}`} className="font-medium">
                        {r.personName}
                      </Link>{' '}
                      <span className="text-muted">{describe(r)}</span>
                    </p>
                    <p className="text-2xs text-muted">
                      {DateTime.fromISO(r.at).setZone(tz).toFormat('dd MMM, hh:mm a')} · {relativeTime(r.at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </PanelBox>
        </div>
      </div>
    </div>
  );
}

function describe(r: DashboardData['recent'][number]) {
  switch (r.kind) {
    case 'CHECK_IN':
      return 'checked in';
    case 'CHECK_OUT':
      return 'checked out';
    case 'LEAVE_APPROVED':
      return `— leave ${r.detail} approved${r.actor ? ` by ${r.actor}` : ''}`;
    case 'LEAVE_REJECTED':
      return `— leave ${r.detail} rejected${r.actor ? ` by ${r.actor}` : ''}`;
    case 'LEAVE_SUBMITTED':
      return `requested leave ${r.detail}`;
    case 'CORRECTION':
      return `— attendance corrected (${r.detail})${r.actor ? ` by ${r.actor}` : ''}`;
    default:
      return r.kind;
  }
}

function OverviewStat({ label, value, sub, tone, to }: { label: string; value: number; sub?: string; tone?: string; to: string }) {
  return (
    <li className="odd:border-r sm:[&:not(:nth-child(4n))]:border-r lg:border-r-0">
      <Link to={to} className="block h-full px-4 py-3.5 text-inherit no-underline hover:bg-[#FAFBFC]">
        <span className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
          {tone && <span className={clsx('inline-block h-2 w-2 rounded-full', tone)} aria-hidden />}
          {label}
        </span>
        <span className="num mt-1.5 block text-[28px] font-semibold leading-none text-ink">{value}</span>
        {sub && <span className="mt-1 block text-xs text-muted">{sub}</span>}
      </Link>
    </li>
  );
}

export function LiveTable({ rows, tz, showExpected }: { rows: SheetRow[]; tz: string; showExpected?: boolean }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.person.id}
      caption="Live presence"
      empty={<EmptyState title="No one is currently marked as present." body="Check-ins will appear here as they happen." />}
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
              <div className="min-w-0">
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
        { key: 'status', header: 'Status', hideOnCard: true, sortValue: (r) => PRESENCE_ORDER.indexOf(r.presence), cell: (r) => <PresenceBadge presence={r.presence} /> },
        {
          key: 'in',
          header: 'In-Time',
          sortValue: (r) => r.record?.checkInAt ?? null,
          cell: (r) => (
            <span className="num">
              {formatTimeLocal(r.record?.checkInAt, tz)} {r.record?.isLate && <Flag2>Late</Flag2>}
            </span>
          ),
        },
        { key: 'out', header: 'Out-Time', sortValue: (r) => r.record?.checkOutAt ?? null, cell: (r) => <span className="num">{formatTimeLocal(r.record?.checkOutAt, tz)}</span> },
        {
          key: 'dur',
          header: showExpected ? 'Current duration' : 'Duration',
          align: 'right',
          sortValue: (r) => r.currentMinutes,
          cell: (r) => <span className={clsx(r.presence === 'CURRENTLY_PRESENT' && 'text-st-live')}>{formatDuration(r.currentMinutes)}</span>,
        },
        ...(showExpected ? [{ key: 'exp', header: 'Expected', cell: (r: SheetRow) => <span className="num text-[13px] text-muted">{r.expectedHours} · {r.expectedMinutes / 60}h</span> }] : []),
      ]}
    />
  );
}

function TrendChart({ data }: { data: DashboardData['trend'] }) {
  const rows = data.filter((d) => d.eligible > 0).map((d) => ({ ...d, label: DateTime.fromISO(d.date).toFormat('dd MMM') }));
  if (rows.length === 0) return <EmptyState title="No attendance records found for this period." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="#ECEEF2" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#5B6472' }} tickLine={false} axisLine={{ stroke: '#DDE1E7' }} interval="preserveStartEnd" minTickGap={24} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 11, fill: '#5B6472' }} tickLine={false} axisLine={false} unit="%" />
        <Tooltip
          formatter={(v, name) => [typeof v === 'number' ? `${v.toFixed(1)}%` : '—', name]}
          labelStyle={{ color: '#1B2A41', fontWeight: 600 }}
          contentStyle={{ borderRadius: 6, border: '1px solid #DDE1E7', fontSize: 12 }}
          cursor={{ stroke: '#9AA1AC', strokeDasharray: '3 3' }}
        />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: '#1B2A41' }} />
        <Line type="monotone" dataKey="overall" name="Overall" stroke="#1B2A41" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} connectNulls />
        <Line type="monotone" dataKey="guestFaculty" name="Guest Faculty" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
        <Line type="monotone" dataKey="sportsCoaches" name="Sports Coaches" stroke="var(--series-2)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls strokeDasharray="5 3" />
      </LineChart>
    </ResponsiveContainer>
  );
}

function UnitsTable({ units }: { units: DashboardData['units'] }) {
  return (
    <DataTable
      rows={units}
      rowKey={(u) => u.key}
      caption="Department and activity summary"
      defaultSort={{ key: 'pct', dir: 'asc' }}
      empty={<EmptyState title="No departments or activities in your scope." />}
      cardTitle={(u) => <span className="font-medium">{u.name}</span>}
      columns={[
        {
          key: 'name',
          header: 'Department / Sport',
          hideOnCard: true,
          sortValue: (u) => u.name,
          cell: (u) => (
            <div>
              <span className="font-medium">{u.name}</span>
              <p className="text-2xs text-muted">{u.kind === 'department' ? 'Department' : 'Sport'}</p>
            </div>
          ),
        },
        { key: 'people', header: 'Personnel', align: 'right', sortValue: (u) => u.people, cell: (u) => u.people },
        { key: 'present', header: 'Present', align: 'right', sortValue: (u) => u.presentToday, cell: (u) => u.presentToday },
        { key: 'absent', header: 'Absent', align: 'right', sortValue: (u) => u.absentToday, cell: (u) => (u.absentToday ? <span className="text-st-absent">{u.absentToday}</span> : 0) },
        { key: 'leave', header: 'Leave', align: 'right', sortValue: (u) => u.leaveToday, cell: (u) => u.leaveToday },
        { key: 'nm', header: 'Not marked', align: 'right', sortValue: (u) => u.notMarkedToday, cell: (u) => u.notMarkedToday },
        {
          key: 'pct',
          header: 'Month %',
          sortValue: (u) => u.monthPercentage,
          cell: (u) => (
            <div className="flex items-center gap-2">
              <div className="h-2 w-16 shrink-0 overflow-hidden rounded-sm bg-[#ECEEF2]" aria-hidden>
                <div className={clsx('h-full rounded-sm', (u.monthPercentage ?? 0) < 75 ? 'bg-st-absent' : 'bg-[var(--series-1)]')} style={{ width: `${u.monthPercentage ?? 0}%` }} />
              </div>
              <span className="num w-12 text-right text-[13px]">{pct(u.monthPercentage)}</span>
              {(u.monthPercentage ?? 100) < 75 ? <Flag2 tone="red">Low</Flag2> : <span className="w-[30px]" />}
            </div>
          ),
        },
      ]}
    />
  );
}
