import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import clsx from 'clsx';
import { Camera, Pencil, Plus, UserMinus, UserPlus, Users } from 'lucide-react';
import { LEAVE_TYPE_LABELS, PERSON_TYPE_LABELS, formatDateTimeLocal, type PersonType } from '@nsut/shared';
import { api } from '../lib/api';
import { useAuth, useTz } from '../lib/auth';
import { monthLabel, nowParts, unitName } from '../lib/format';
import { useUrlState } from '../lib/hooks';
import type { Activity, Leave, Person, PersonMonth } from '../lib/types';
import { AttendanceCalendar, SummaryStrip } from '../components/AttendanceCalendar';
import { ManualMarkDialog } from '../components/AttendanceDialogs';
import { FilterBar, MonthPicker, useOrg, type FilterValues } from '../components/Filters';
import { PanelBox } from '../components/Layout';
import { Flag2, StatusBadge } from '../components/Status';
import { Avatar, Button, DataTable, EmptyState, ErrorState, Field, FormError, Modal, PageHeader, Pagination, Skeleton, TableSkeleton, fieldErrors, useToast } from '../components/ui';
import { describeSnapshot } from './AttendancePages';
import { LeaveStatusBadge } from './LeavePage';

// ============================================================ List
export function PeopleListPage({ type }: { type: PersonType }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useUrlState<{ q?: string; activityId?: string; status?: string; page?: string }>({});
  const page = Number(f.page ?? 1);
  const q = useQuery({
    queryKey: ['people', type, f],
    queryFn: () => api.get<{ total: number; page: number; pageSize: number; rows: Person[] }>('/people', { type, q: f.q, activityId: f.activityId, status: f.status ?? 'ACTIVE', page, pageSize: 25 }),
    placeholderData: (prev) => prev,
  });
  const isGF = type === 'GUEST_FACULTY';
  return (
    <div>
      <PageHeader
        eyebrow="People"
        title={isGF ? 'Guest Faculty' : 'Sports Coaches'}
        subtitle={q.data ? `${q.data.total} ${(f.status ?? 'ACTIVE') === 'ACTIVE' ? 'active ' : ''}${isGF ? 'faculty members' : 'coaches'}` : ' '}
        actions={
          can('people.write') && (
            <Link to={`/people/new?type=${type}`} className="btn-primary no-underline">
              <Plus className="h-4 w-4" /> Add {isGF ? 'Guest Faculty' : 'Coach'}
            </Link>
          )
        }
      />
      <PanelBox>
        <div className="border-b border-line px-4 py-3">
          <FilterBar value={f as FilterValues} onChange={(v) => setF({ ...(v as any), status: f.status, page: undefined }, true)} show={['q', 'activity']}>
            <label>
              <span className="sr-only">Record status</span>
              <select className="input w-auto" value={f.status ?? 'ACTIVE'} onChange={(e) => setF({ status: e.target.value === 'ACTIVE' ? undefined : e.target.value, page: undefined })}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="ALL">All</option>
              </select>
            </label>
          </FilterBar>
        </div>
        {q.isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <>
            <DataTable
              rows={q.data!.rows}
              rowKey={(p) => p.id}
              onRowClick={(p) => nav(`/people/${p.id}`)}
              caption={isGF ? 'Guest Faculty' : 'Sports Coaches'}
              empty={<EmptyState icon={<Users className="h-8 w-8" />} title="No personnel match your search." />}
              cardTitle={(p) => (
                <Link to={`/people/${p.id}`} className="font-medium">
                  {p.fullName}
                </Link>
              )}
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  hideOnCard: true,
                  sortValue: (p) => p.fullName,
                  cell: (p) => (
                    <div className="flex items-center gap-2.5">
                      <Avatar name={p.fullName} personId={p.id} hasPhoto={p.hasPhoto} size={30} />
                      <div>
                        <Link to={`/people/${p.id}`} className="font-medium text-ink">
                          {p.fullName}
                        </Link>
                        {p.status === 'INACTIVE' && <Flag2 tone="gray">Inactive</Flag2>}
                        <p className="text-xs text-muted">{p.designation}</p>
                      </div>
                    </div>
                  ),
                },
                { key: 'ref', header: 'Ref. ID', sortValue: (p) => p.refId, cell: (p) => <span className="font-mono text-xs">{p.refId}</span> },
                { key: 'unit', header: 'Sport / Activity', sortValue: (p) => unitName(p), cell: (p) => unitName(p) },
                { key: 'spec', header: 'Specialization', cell: (p) => <span className="text-[13px] text-muted">{p.specialization ?? '—'}</span> },
                { key: 'contract', header: 'Contract ends', sortValue: (p) => p.contractEnd, cell: (p) => <ContractEnd date={p.contractEnd} /> },
                { key: 'hours', header: 'Assigned hrs/wk', align: 'right', cell: (p) => p.assignedHours ?? '—' },
                { key: 'login', header: 'Login', cell: (p) => (p.hasLogin ? 'Yes' : <span className="text-muted">No</span>) },
              ]}
            />
            <Pagination page={page} pageSize={25} total={q.data!.total} onPage={(p) => setF({ page: String(p) })} />
          </>
        )}
      </PanelBox>
    </div>
  );
}

function ContractEnd({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted">—</span>;
  const days = Math.floor(DateTime.fromISO(date).diffNow('days').days);
  return (
    <span className="num whitespace-nowrap">
      {DateTime.fromISO(date).toFormat('dd MMM yyyy')} {days < 0 ? <Flag2 tone="gray">Ended</Flag2> : days <= 30 ? <Flag2 tone="red">{days}d left</Flag2> : null}
    </span>
  );
}

// ============================================================ Profile
export function PersonProfilePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const tz = useTz();
  const now = nowParts(tz);
  const qc = useQueryClient();
  const toast = useToast();
  const [ym, setYm] = useState({ year: now.year, month: now.month });
  const person = useQuery({ queryKey: ['person', id], queryFn: () => api.get<Person>(`/people/${id}`) });
  const cal = useQuery({ queryKey: ['person-month', id, ym.year, ym.month], queryFn: () => api.get<PersonMonth>(`/attendance/person/${id}`, ym) });
  const current = useQuery({ queryKey: ['person-month', id, now.year, now.month], queryFn: () => api.get<PersonMonth>(`/attendance/person/${id}`, { year: now.year, month: now.month }) });
  const leaves = useQuery({ queryKey: ['leave', 'person', id], queryFn: () => api.get<Leave[]>('/leave', { personId: id }), enabled: can('leave.review') });
  const corrections = useQuery({ queryKey: ['corrections', 'person', id], queryFn: () => api.get<any[]>('/attendance/corrections/list', { personId: id }), enabled: can('attendance.read') });
  const [statusDlg, setStatusDlg] = useState(false);
  const [reason, setReason] = useState('');
  const [marking, setMarking] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toggle = useMutation({
    mutationFn: () => api.post(`/people/${id}/${person.data!.status === 'ACTIVE' ? 'deactivate' : 'activate'}`, { reason }),
    onSuccess: () => {
      toast({ kind: 'success', title: person.data!.status === 'ACTIVE' ? 'Profile deactivated' : 'Profile reactivated' });
      setStatusDlg(false);
      qc.invalidateQueries();
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('photo', file);
      return api.upload(`/people/${id}/photo`, fd);
    },
    onSuccess: () => {
      toast({ kind: 'success', title: 'Photograph updated' });
      qc.invalidateQueries({ queryKey: ['person', id] });
    },
    onError: (e: Error) => toast({ kind: 'error', title: 'Upload failed', body: e.message }),
  });

  if (person.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40" />
      </div>
    );
  if (person.isError) return <div className="panel"><ErrorState error={person.error} /></div>;
  const p = person.data!;
  const recent = (current.data?.days ?? []).filter((x) => x.record).slice(-7).reverse();

  return (
    <div className="space-y-5">
      <div className="panel p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="relative w-fit">
            <Avatar name={p.fullName} personId={p.id} hasPhoto={p.hasPhoto} size={96} />
            {can('people.write') && (
              <>
                <button className="absolute bottom-0 right-0 rounded-full border border-line bg-white p-1.5 shadow hover:bg-[#F0F2F5]" onClick={() => fileRef.current?.click()} aria-label="Upload photograph">
                  <Camera className="h-4 w-4" />
                </button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
              </>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted">{PERSON_TYPE_LABELS[p.type]}</p>
            <h1 className="text-[22px] font-semibold leading-tight">
              {p.fullName} {p.status === 'INACTIVE' && <Flag2 tone="gray">Inactive</Flag2>}
            </h1>
            <p className="text-sm text-muted">
              {p.designation}
              {p.specialization ? ` · ${p.specialization}` : ''}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
              <Info k="Employee / Ref. ID" v={<span className="font-mono">{p.refId}</span>} />
              <Info k="Sport / Activity" v={p.activityName ?? '—'} />
              <Info k="Joining date" v={p.joiningDate ? DateTime.fromISO(p.joiningDate).toFormat('dd MMM yyyy') : '—'} />
              <Info k="Contract period" v={p.contractStart ? `${DateTime.fromISO(p.contractStart).toFormat('dd MMM yyyy')} – ${p.contractEnd ? DateTime.fromISO(p.contractEnd).toFormat('dd MMM yyyy') : 'open'}` : '—'} />
              <Info k="Assigned hours" v={p.assignedHours ? `${p.assignedHours} hrs / week` : '—'} />
              {can('people.read') && <Info k="Email" v={p.email ?? '—'} />}
              {can('people.read') && <Info k="Phone" v={p.phone ?? '—'} />}
              {can('people.read') && <Info k="Login" v={p.login ? `${p.login.status === 'ACTIVE' ? 'Active' : 'Disabled'}${p.login.lastLogin ? ` · last ${DateTime.fromISO(p.login.lastLogin).toRelative()}` : ''}` : 'No login'} />}
            </dl>
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-col" data-noprint>
            {can('people.write') && (
              <Link to={`/people/${p.id}/edit`} className="btn-secondary no-underline">
                <Pencil className="h-4 w-4" /> Edit profile
              </Link>
            )}
            {can('people.write') && (
              <Button onClick={() => { setReason(''); setStatusDlg(true); }} variant={p.status === 'ACTIVE' ? 'ghost' : 'secondary'} className={p.status === 'ACTIVE' ? 'text-st-absent' : ''}>
                {p.status === 'ACTIVE' ? <UserMinus className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {p.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
              </Button>
            )}
            <Link to={`/reports/individual?personId=${p.id}`} className="btn-secondary no-underline">
              Individual report
            </Link>
          </div>
        </div>
      </div>

      <PanelBox title={`Attendance Summary — ${monthLabel(now.year, now.month)}`}>{current.data ? <SummaryStrip s={current.data.summary} /> : <Skeleton className="m-4 h-12" />}</PanelBox>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <PanelBox title="Attendance Calendar" actions={<MonthPicker year={ym.year} month={ym.month} onChange={(y, m) => setYm({ year: y, month: m })} max={now} />}>
          <div className="p-3 sm:p-4">{cal.data ? <AttendanceCalendar data={cal.data} onMark={(d) => setMarking(d)} /> : <TableSkeleton rows={5} cols={7} />}</div>
        </PanelBox>
        <PanelBox title="Recent Attendance">
          <DataTable
            rows={recent}
            rowKey={(x) => x.date}
            empty={<EmptyState title="No attendance recorded this month yet." />}
            columns={[
              { key: 'd', header: 'Date', cell: (x) => DateTime.fromISO(x.date).toFormat('ccc dd MMM') },
              { key: 's', header: 'Status', cell: (x) => <StatusBadge status={x.status} /> },
              {
                key: 't',
                header: 'In – Out',
                cell: (x) => (
                  <span className="num text-xs">
                    {x.record?.checkInAt ? DateTime.fromISO(x.record.checkInAt).setZone(tz).toFormat('hh:mm a') : '—'} – {x.record?.checkOutAt ? DateTime.fromISO(x.record.checkOutAt).setZone(tz).toFormat('hh:mm a') : '—'}
                  </span>
                ),
              },
            ]}
          />
        </PanelBox>
      </div>

      {can('leave.review') && (
        <PanelBox title="Leave History">
          {leaves.isLoading ? (
            <TableSkeleton rows={3} cols={5} />
          ) : (
            <DataTable
              rows={leaves.data ?? []}
              rowKey={(l) => l.id}
              empty={<EmptyState title="No leave requests." />}
              columns={[
                { key: 'range', header: 'Period', cell: (l) => `${DateTime.fromISO(l.fromDate).toFormat('dd MMM')} – ${DateTime.fromISO(l.toDate).toFormat('dd MMM yyyy')}` },
                { key: 'days', header: 'Days', align: 'right', cell: (l) => l.days },
                { key: 'type', header: 'Type', cell: (l) => LEAVE_TYPE_LABELS[l.leaveType] },
                { key: 'reason', header: 'Reason', cell: (l) => <span className="text-[13px]">{l.reason}</span> },
                { key: 'status', header: 'Status', cell: (l) => <LeaveStatusBadge status={l.status} /> },
                { key: 'by', header: 'Reviewed by', cell: (l) => <span className="text-xs text-muted">{l.reviewedBy ?? '—'}</span> },
              ]}
            />
          )}
        </PanelBox>
      )}

      {can('attendance.read') && (
        <PanelBox title="Audit / Corrections" actions={can('audit.read') && <Link to={`/audit?q=${encodeURIComponent(p.fullName)}`} className="text-sm">Full audit log →</Link>}>
          <DataTable
            rows={corrections.data ?? []}
            rowKey={(c: any) => c.id}
            empty={<EmptyState title="No corrections have been made to this person’s attendance." />}
            columns={[
              { key: 'when', header: 'When', cell: (c: any) => <span className="num text-xs">{formatDateTimeLocal(c.requestedAt, tz)}</span> },
              { key: 'date', header: 'For date', cell: (c: any) => DateTime.fromISO(c.date).toFormat('dd MMM yyyy') },
              { key: 'prev', header: 'Previous', cell: (c: any) => <span className="text-xs">{describeSnapshot(c.previous, tz)}</span> },
              { key: 'new', header: 'Changed to', cell: (c: any) => <span className="text-xs font-medium">{describeSnapshot(c.proposed, tz)}</span> },
              { key: 'reason', header: 'Reason', cell: (c: any) => <span className="text-xs">{c.reason}</span> },
              { key: 'by', header: 'By', cell: (c: any) => <span className="text-xs">{c.requestedBy}</span> },
              { key: 'st', header: 'Status', cell: (c: any) => <Flag2 tone={c.status === 'APPLIED' ? 'blue' : c.status === 'PENDING' ? 'amber' : 'red'}>{c.status}</Flag2> },
            ]}
          />
        </PanelBox>
      )}

      <Modal
        open={statusDlg}
        onOpenChange={setStatusDlg}
        title={p.status === 'ACTIVE' ? `Deactivate ${p.fullName}?` : `Reactivate ${p.fullName}?`}
        description={p.status === 'ACTIVE' ? 'They will no longer appear in active attendance lists and their login will be disabled. Historical records are kept.' : 'They will appear in attendance lists again and their login will be re-enabled.'}
        footer={
          <>
            <Button onClick={() => setStatusDlg(false)}>Cancel</Button>
            <Button variant={p.status === 'ACTIVE' ? 'danger' : 'primary'} loading={toggle.isPending} onClick={() => toggle.mutate()}>
              {p.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
            </Button>
          </>
        }
      >
        <Field label="Reason (recorded in audit log)">{(pp) => <textarea {...pp} rows={2} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Contract completed" />}</Field>
        <div className="mt-3">
          <FormError error={toggle.error} />
        </div>
      </Modal>
      <ManualMarkDialog open={!!marking} onOpenChange={(o) => !o && setMarking(null)} preset={{ date: marking ?? undefined, person: p }} maxDate={now.date} />
    </div>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs uppercase tracking-wide text-muted">{k}</dt>
      <dd className="truncate">{v}</dd>
    </div>
  );
}

// ============================================================ Create / edit
export function PersonFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { activities } = useOrg();
  const typeParam = new URLSearchParams(location.search).get('type') as PersonType | null;
  const existing = useQuery({ queryKey: ['person', id], queryFn: () => api.get<Person>(`/people/${id}`), enabled: editing });
  const [form, setForm] = useState<any>({
    refId: '',
    fullName: '',
    type: typeParam ?? 'GUEST_FACULTY',
    activityId: '',
    designation: typeParam === 'SPORTS_COACH' ? 'Coach' : 'Guest Faculty (Physical Education)',
    specialization: '',
    email: '',
    phone: '',
    joiningDate: '',
    contractStart: '',
    contractEnd: '',
    assignedHours: '',
    createLogin: true,
    initialPassword: '',
  });
  useEffect(() => {
    if (existing.data) {
      const p = existing.data;
      setForm((f: any) => ({
        ...f,
        refId: p.refId,
        fullName: p.fullName,
        type: p.type,
        activityId: p.activityId ?? '',
        designation: p.designation ?? '',
        specialization: p.specialization ?? '',
        email: p.email ?? '',
        phone: p.phone ?? '',
        joiningDate: p.joiningDate ?? '',
        contractStart: p.contractStart ?? '',
        contractEnd: p.contractEnd ?? '',
        assignedHours: p.assignedHours ?? '',
      }));
    }
  }, [existing.data]);
  const m = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        activityId: form.activityId || null,
        joiningDate: form.joiningDate || null,
        contractStart: form.contractStart || null,
        contractEnd: form.contractEnd || null,
        assignedHours: form.assignedHours === '' ? null : Number(form.assignedHours),
        initialPassword: form.createLogin ? form.initialPassword : undefined,
      };
      if (editing) {
        delete body.createLogin;
        delete body.initialPassword;
        return api.patch<{ ok: true }>(`/people/${id}`, body);
      }
      return api.post<{ id: string }>('/people', body);
    },
    onSuccess: (r: any) => {
      toast({ kind: 'success', title: editing ? 'Profile updated' : 'Profile created' });
      qc.invalidateQueries({ queryKey: ['people'] });
      qc.invalidateQueries({ queryKey: ['person', id] });
      qc.invalidateQueries({ queryKey: ['people-options'] });
      nav(`/people/${editing ? id : r.id}`);
    },
  });
  const fe = fieldErrors(m.error);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const isGF = form.type === 'GUEST_FACULTY';
  if (editing && existing.isLoading) return <Skeleton className="h-96" />;
  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="People" title={editing ? `Edit ${existing.data?.fullName}` : `Add ${isGF ? 'Guest Faculty' : 'Sports Coach'}`} />
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
        noValidate
      >
        <fieldset className="grid gap-4 border-b border-line p-5 sm:grid-cols-2">
          <legend className="sr-only">Identity</legend>
          <Field label="Person type" required>
            {(p) => (
              <select {...p} className="input" value={form.type} onChange={set('type')}>
                {Object.entries(PERSON_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Employee / Reference ID" required error={fe.refId} hint="Unique. Letters, numbers, - and /">
            {(p) => <input {...p} className="input font-mono" value={form.refId} onChange={set('refId')} />}
          </Field>
          <Field label="Full name" required error={fe.fullName} className="sm:col-span-2">
            {(p) => <input {...p} className="input" value={form.fullName} onChange={set('fullName')} />}
          </Field>
          <Field label="Sport / Activity" required error={fe.activityId}>
            {(p) => (
              <select {...p} className="input" value={form.activityId} onChange={set('activityId')}>
                <option value="">Select…</option>
                {activities.map((a: Activity) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Designation" error={fe.designation}>
            {(p) => <input {...p} className="input" value={form.designation} onChange={set('designation')} />}
          </Field>
          <Field label="Specialization" error={fe.specialization}>
            {(p) => <input {...p} className="input" value={form.specialization} onChange={set('specialization')} />}
          </Field>
        </fieldset>
        <fieldset className="grid gap-4 border-b border-line p-5 sm:grid-cols-2">
          <legend className="sr-only">Contact</legend>
          <Field label="Email" error={fe.email} hint="Used for sign-in if a login is created">
            {(p) => <input {...p} type="email" className="input" value={form.email} onChange={set('email')} />}
          </Field>
          <Field label="Phone" error={fe.phone}>
            {(p) => <input {...p} type="tel" className="input" value={form.phone} onChange={set('phone')} />}
          </Field>
        </fieldset>
        <fieldset className="grid gap-4 border-b border-line p-5 sm:grid-cols-4">
          <legend className="sr-only">Contract</legend>
          <Field label="Joining date" error={fe.joiningDate}>
            {(p) => <input {...p} type="date" className="input" value={form.joiningDate} onChange={set('joiningDate')} />}
          </Field>
          <Field label="Contract start" error={fe.contractStart}>
            {(p) => <input {...p} type="date" className="input" value={form.contractStart} onChange={set('contractStart')} />}
          </Field>
          <Field label="Contract end" error={fe.contractEnd}>
            {(p) => <input {...p} type="date" className="input" value={form.contractEnd} onChange={set('contractEnd')} />}
          </Field>
          <Field label="Assigned hrs / week" error={fe.assignedHours}>
            {(p) => <input {...p} type="number" min={0} max={80} step={0.5} className="input" value={form.assignedHours} onChange={set('assignedHours')} />}
          </Field>
        </fieldset>
        {!editing && (
          <fieldset className="grid gap-4 border-b border-line p-5 sm:grid-cols-2">
            <legend className="sr-only">Login</legend>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={form.createLogin} onChange={(e) => setForm({ ...form, createLogin: e.target.checked })} />
              Create a login so this person can check in / out and apply for leave
            </label>
            {form.createLogin && (
              <Field label="Initial password" required error={fe.initialPassword} hint="At least 10 characters with letters and numbers. Share it securely; they can change it after signing in.">
                {(p) => <input {...p} type="text" autoComplete="new-password" className="input font-mono" value={form.initialPassword} onChange={set('initialPassword')} />}
              </Field>
            )}
          </fieldset>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 p-4">
          <div className="mr-auto">
            <FormError error={m.error} />
          </div>
          <Button onClick={() => nav(-1)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={m.isPending}>
            {editing ? 'Save changes' : 'Create profile'}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ============================================================ Sports & activities
export function ActivitiesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['activities', 'all'], queryFn: () => api.get<Activity[]>('/activities', { all: true }) });
  const [edit, setEdit] = useState<any | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const body = { name: edit.name, category: edit.category, status: edit.status };
      return edit.id ? api.patch(`/activities/${edit.id}`, body) : api.post('/activities', body);
    },
    onSuccess: () => {
      toast({ kind: 'success', title: 'Saved' });
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
  const fe = fieldErrors(m.error);
  const manage = can('org.manage');
  return (
    <div>
      <PageHeader
        title="Sports & Activities"
        subtitle="Every Guest Faculty member and coach belongs to one sport / activity."
        actions={
          manage && (
            <Button variant="primary" onClick={() => setEdit({ name: '', category: '', status: 'ACTIVE' })}>
              <Plus className="h-4 w-4" /> Add sport / activity
            </Button>
          )
        }
      />
      <PanelBox>
        {q.isLoading ? (
          <TableSkeleton rows={6} cols={4} />
        ) : (
          <DataTable
            rows={q.data ?? []}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No sports or activities yet." />}
            columns={[
              { key: 'name', header: 'Name', sortValue: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'cat', header: 'Category', sortValue: (r) => r.category, cell: (r) => r.category },
              { key: 'people', header: 'Active personnel', align: 'right' as const, sortValue: (r) => r.activePeople, cell: (r) => r.activePeople },
              { key: 'status', header: 'Status', cell: (r) => (r.status === 'ACTIVE' ? 'Active' : <Flag2 tone="gray">Inactive</Flag2>) },
              ...(manage
                ? [
                    {
                      key: 'edit',
                      header: <span className="sr-only">Edit</span>,
                      align: 'right' as const,
                      cell: (r: Activity) => (
                        <Button size="sm" variant="ghost" onClick={() => setEdit({ ...r })}>
                          Edit
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </PanelBox>
      <Modal
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={edit?.id ? `Edit ${edit.name}` : 'Add sport / activity'}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
              Save
            </Button>
          </>
        }
      >
        {edit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={fe.name} className="sm:col-span-2">
              {(p) => <input {...p} className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />}
            </Field>
            <Field label="Category" required error={fe.category} hint="e.g. Outdoor, Indoor, Fitness">
              {(p) => <input {...p} className="input" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} />}
            </Field>
            <Field label="Status">
              {(p) => (
                <select {...p} className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              )}
            </Field>
            <div className="sm:col-span-2">
              <FormError error={m.error} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export { clsx };
