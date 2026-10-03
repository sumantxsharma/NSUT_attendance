import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronRight, Minus, RefreshCw } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PERSON_TYPE_LABELS, type PersonType, type PresenceState } from '@nsut/shared';
import { api } from '../lib/api';
import { useAuth, useTz } from '../lib/auth';
import { formatDuration, formatTimeLocal, monthLabel, pct, unitName } from '../lib/format';
import type { Counts, SheetRow } from '../lib/types';
import { PresenceBadge, Flag2 } from '../components/Status';
import { Avatar, DataTable, EmptyState, ErrorState, Skeleton } from '../components/ui';

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
  units: { key: string; name: string; people: number; presentToday: number; absentToday: number; leaveToday: number; notMarkedToday: number; monthPercentage: number | null }[];
  pendingLeave: number;
  contractsExpiring: { id: string; fullName: string; contractEnd: string }[];
}

const PRESENCE_ORDER: PresenceState[] = ['CURRENTLY_PRESENT', 'CHECKED_OUT', 'HALF_DAY', 'ON_LEAVE', 'ABSENT', 'NOT_MARKED', 'HOLIDAY'];
/** Month-percentage below which a unit is flagged. */
const LOW_PCT = 75;

function Card({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('panel flex flex-col', className)}>
      <div className="flex items-center justify-between gap-2 px-5 pt-4">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {action && <div className="text-xs text-muted" data-noprint>{action}</div>}
      </div>
      <div className="flex-1 px-5 pb-5 pt-3">{children}</div>
    </section>
  );
}

function Delta({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur === null || prev === null) return <span className="text-xs text-muted">No data for last month</span>;
  const d = Math.round((cur - prev) * 10) / 10;
  const Icon = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <span className={clsx('inline-flex items-center font-medium', d > 0 ? 'text-st-present' : d < 0 ? 'text-st-absent' : 'text-muted')}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {d > 0 ? '+' : ''}
        {d.toFixed(1)} pts
      </span>
      vs last month ({pct(prev)})
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
          <h1 className="text-xl font-semibold leading-tight tracking-[-0.01em]">Overview</h1>
          <p className="mt-1 text-sm text-muted">
            {DateTime.now().setZone(tz).toFormat('cccc, d LLLL yyyy')}
            {d && ` · Updated ${DateTime.fromISO(d.serverTime).setZone(tz).toFormat('h:mm a')}`}
            {scoped && ` · ${me!.scopes.map((s) => s.activityName).join(', ')}`}
          </p>
        </div>
        <div className="flex items-center gap-2" data-noprint>
          <div className="inline-flex rounded border border-line bg-white p-0.5" role="group" aria-label="Filter by type">
            {(['', 'GUEST_FACULTY', 'SPORTS_COACH'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => setType(t)}
                className={clsx('rounded-[4px] px-3 py-1 text-[13px]', type === t ? 'bg-[#F0F2F5] font-medium text-ink' : 'text-muted hover:text-ink')}
              >
                {t ? PERSON_TYPE_LABELS[t] : 'All'}
              </button>
            ))}
          </div>
          <button className="btn-ghost btn-sm" onClick={() => q.refetch()} aria-label="Refresh" disabled={q.isFetching}>
            <RefreshCw className={clsx('h-4 w-4', q.isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {q.isError && (
        <div className="panel">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Today" className="lg:col-span-2" action={d?.isHoliday ? <span className="font-medium text-st-holiday">Holiday: {d.holidayName}</span> : <Link to="/attendance/today">Open daily sheet</Link>}>
          {d ? <TodaySummary counts={d.counts} /> : <Skeleton className="h-32" />}
        </Card>
        <Card title={d ? `This month · ${monthLabel(d.percentages.month.year, d.percentages.month.month)}` : 'This month'} action={<Link to="/admin/rules">How it is calculated</Link>}>
          {d ? <MonthSummary p={d.percentages} /> : <Skeleton className="h-32" />}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Attendance trend" className="lg:col-span-2" action="Last 30 working days">
          <div className="h-[230px]">{d ? <TrendChart data={d.trend} /> : <Skeleton className="h-full" />}</div>
        </Card>
        <Card title="Needs attention">{d ? <Attention d={d} /> : <Skeleton className="h-40" />}</Card>
      </div>

      <Card title="By sport / activity" action={d && 'Present today · month to date'}>
        {d ? <UnitList units={d.units} /> : <Skeleton className="h-40" />}
      </Card>
    </div>
  );
}

function TodaySummary({ counts: c }: { counts: Counts }) {
  // People with a working day today (the count buckets below are mutually exclusive).
  const expected = c.present + c.onLeave + c.absent + c.notMarked;
  const segments = [
    { label: 'On campus', value: c.currentlyPresent, color: 'bg-st-live', to: '/attendance/live' },
    { label: 'Checked out', value: c.present - c.currentlyPresent, color: 'bg-st-present', to: '/attendance/today?status=PRESENT' },
    { label: 'On leave', value: c.onLeave, color: 'bg-[#C98A00]', to: '/attendance/today?status=LEAVE' },
    { label: 'Absent', value: c.absent, color: 'bg-st-absent', to: '/attendance/today?status=ABSENT' },
    { label: 'Not marked', value: c.notMarked, color: 'bg-[#C5CBD4]', to: '/attendance/today?status=NOT_MARKED' },
  ];
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <p className="text-sm text-muted">
          <span className="num mr-1.5 text-[34px] font-semibold leading-none tracking-tight text-ink">{c.present}</span>
          of {expected} expected present
        </p>
        <p className="text-sm text-muted">
          {c.total} on roll · {c.guestFaculty} faculty, {c.sportsCoaches} coaches
          {c.late > 0 && (
            <>
              {' · '}
              <Link to="/reports/late">{c.late} late</Link>
            </>
          )}
        </p>
      </div>
      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-[#EEF0F3]" role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}>
        {expected > 0 && segments.map((s) => s.value > 0 && <div key={s.label} className={clsx(s.color, 'border-r-2 border-white last:border-r-0')} style={{ width: `${(s.value / expected) * 100}%` }} />)}
      </div>
      <ul className="-mx-2 mt-5 grid grid-cols-2 gap-1 sm:grid-cols-5">
        {segments.map((s) => (
          <li key={s.label}>
            <Link to={s.to} className="block rounded px-2 py-2 text-inherit no-underline hover:bg-[#F6F7F9]">
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <span className={clsx('h-2 w-2 rounded-full', s.color)} aria-hidden />
                {s.label}
              </span>
              <span className="num mt-1 block text-xl font-semibold text-ink">{s.value}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MonthSummary({ p }: { p: DashboardData['percentages'] }) {
  return (
    <div>
      <p className="num text-[34px] font-semibold leading-none tracking-tight text-ink">{pct(p.month.overall)}</p>
      <div className="mt-2">
        <Delta cur={p.month.overall} prev={p.previous.overall} />
      </div>
      <dl className="mt-5 space-y-3">
        {(
          [
            ['Guest Faculty', 'guestFaculty'],
            ['Sports Coaches', 'sportsCoaches'],
          ] as const
        ).map(([label, k]) => (
          <div key={k}>
            <div className="flex justify-between text-sm">
              <dt className="text-muted">{label}</dt>
              <dd className="num font-medium text-ink">{pct(p.month[k])}</dd>
            </div>
            <Bar value={p.month[k]} />
          </div>
        ))}
      </dl>
    </div>
  );
}

function Bar({ value }: { value: number | null }) {
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#EEF0F3]" aria-hidden>
      <div className={clsx('h-full rounded-full', (value ?? 0) < LOW_PCT ? 'bg-st-absent' : 'bg-brand-600')} style={{ width: `${value ?? 0}%` }} />
    </div>
  );
}

function names(rows: SheetRow[]) {
  const n = rows.map((r) => r.person.fullName);
  return n.length > 3 ? `${n.slice(0, 3).join(', ')} and ${n.length - 3} more` : n.join(', ');
}

function Attention({ d }: { d: DashboardData }) {
  const notMarked = d.live.filter((r) => r.presence === 'NOT_MARKED' && r.isWorkingDay);
  const absent = d.live.filter((r) => r.presence === 'ABSENT');
  const items = [
    d.pendingLeave > 0 && { to: '/leave?status=PENDING', title: `${d.pendingLeave} leave request${d.pendingLeave > 1 ? 's' : ''} to review` },
    notMarked.length > 0 && { to: '/attendance/today?status=NOT_MARKED', title: `${notMarked.length} not marked today`, sub: names(notMarked) },
    absent.length > 0 && { to: '/attendance/today?status=ABSENT', title: `${absent.length} absent today`, sub: names(absent) },
    ...d.contractsExpiring.map((c) => ({ to: `/people/${c.id}`, title: `Contract ends ${DateTime.fromISO(c.contractEnd).toFormat('d LLL yyyy')}`, sub: c.fullName })),
  ].filter(Boolean) as { to: string; title: string; sub?: string }[];
  if (items.length === 0)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-sm text-muted">
        <CheckCircle2 className="h-5 w-5 text-st-present" aria-hidden />
        Nothing needs attention.
      </div>
    );
  return (
    <ul className="-mx-2 divide-y divide-[#EEF0F3]">
      {items.map((i) => (
        <li key={i.to + i.title}>
          <Link to={i.to} className="flex items-center gap-3 rounded px-2 py-2.5 text-inherit no-underline hover:bg-[#F6F7F9]">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">{i.title}</span>
              {i.sub && <span className="block truncate text-xs text-muted">{i.sub}</span>}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#98A2B3]" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function UnitList({ units }: { units: DashboardData['units'] }) {
  if (units.length === 0) return <EmptyState title="No sports or activities in your scope." />;
  const rows = [...units].sort((a, b) => (a.monthPercentage ?? 101) - (b.monthPercentage ?? 101) || a.name.localeCompare(b.name));
  return (
    <ul className="grid gap-x-10 md:grid-cols-2">
      {rows.map((u) => {
        const expected = u.presentToday + u.absentToday + u.notMarkedToday;
        const low = (u.monthPercentage ?? 100) < LOW_PCT;
        return (
          <li key={u.key} className="flex items-center gap-4 border-b border-[#EEF0F3] py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink" title={u.name}>
                {u.name}
              </p>
              <p className="text-xs text-muted">
                {expected ? `${u.presentToday}/${expected} present` : 'No working day today'}
                {u.absentToday > 0 && <span className="text-st-absent"> · {u.absentToday} absent</span>}
              </p>
            </div>
            <div className="w-28 shrink-0">
              <p className={clsx('num text-right text-sm font-medium', low ? 'text-st-absent' : 'text-ink')}>{pct(u.monthPercentage)}</p>
              <Bar value={u.monthPercentage} />
            </div>
          </li>
        );
      })}
    </ul>
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
        { key: 'unit', header: 'Sport / Activity', sortValue: (r) => unitName(r.person), cell: (r) => <span className="text-[13px]">{unitName(r.person)}</span> },
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
  const rows = data.filter((d) => d.eligible > 0).map((d) => ({ ...d, label: DateTime.fromISO(d.date).toFormat('d LLL') }));
  if (rows.length === 0) return <EmptyState title="No attendance records found for this period." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="#EEF0F3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#667085' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={32} />
        <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 11, fill: '#667085' }} tickLine={false} axisLine={false} unit="%" />
        <ReferenceLine y={LOW_PCT} stroke="#C5CBD4" strokeDasharray="4 4" />
        <Tooltip
          formatter={(v) => [typeof v === 'number' ? `${v.toFixed(1)}%` : '—', 'Attendance']}
          labelStyle={{ color: '#1B2A41', fontWeight: 600 }}
          contentStyle={{ borderRadius: 6, border: '1px solid #E2E5EA', fontSize: 12, boxShadow: '0 4px 12px rgba(16,24,40,0.08)' }}
          cursor={{ stroke: '#C5CBD4' }}
        />
        <Line type="monotone" dataKey="overall" stroke="#1F4E8C" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
