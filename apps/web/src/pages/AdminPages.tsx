import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import clsx from 'clsx';
import { Check, Copy, KeyRound, Plus, Trash2, Upload } from 'lucide-react';
import {
  describeFormula,
  formatDateTimeLocal,
  PERSON_TYPE_LABELS,
  ROLE_LABELS,
  ROLES,
  type AttendanceRules,
  type PersonType,
  type Role,
  type SystemSettings,
  type TypeRules,
} from '@nsut/shared';
import { api } from '../lib/api';
import { useAuth, useTz } from '../lib/auth';
import { useUrlState } from '../lib/hooks';
import type { SettingsPayload } from '../lib/types';
import { useOrg, usePeopleOptions } from '../components/Filters';
import { PanelBox } from '../components/Layout';
import { Flag2 } from '../components/Status';
import { Button, DataTable, EmptyState, ErrorState, Field, FormError, Modal, PageHeader, Pagination, Skeleton, TableSkeleton, fieldErrors, useToast } from '../components/ui';

// ============================================================ Users
interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  status: 'ACTIVE' | 'INACTIVE';
  personId: string | null;
  personName: string | null;
  lastLogin: string | null;
  locked: boolean;
  scopes: { departmentId: string | null; departmentName: string | null; activityId: string | null; activityName: string | null }[];
}

export function UsersPage() {
  const tz = useTz();
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useUrlState<{ q?: string; role?: string; status?: string }>({});
  const q = useQuery({ queryKey: ['users', f], queryFn: () => api.get<UserRow[]>('/users', f) });
  const [edit, setEdit] = useState<Partial<UserRow> & { password?: string; scopeDepartmentIds?: string[]; scopeActivityIds?: string[] } | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => (action === 'reset-link' ? api.post<{ url: string }>(`/users/${id}/reset-link`) : api.post(`/users/${id}/${action}`)),
    onSuccess: (r: any, v) => {
      if (v.action === 'reset-link') setResetLink(r.url);
      else toast({ kind: 'success', title: v.action === 'deactivate' ? 'User deactivated' : v.action === 'unlock' ? 'Account unlocked' : 'User activated' });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e: Error) => toast({ kind: 'error', title: 'Action failed', body: e.message }),
  });
  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Users"
        subtitle="Accounts, roles and coordinator scope. Staff logins can also be created from a person’s profile."
        actions={
          <Button variant="primary" onClick={() => setEdit({ role: 'OFFICER', name: '', email: '', password: '', scopeDepartmentIds: [], scopeActivityIds: [] })}>
            <Plus className="h-4 w-4" /> Add user
          </Button>
        }
      />
      <PanelBox>
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3" data-noprint>
          <input className="input w-60" placeholder="Name or email" value={f.q ?? ''} onChange={(e) => setF({ q: e.target.value })} aria-label="Search users" />
          <select className="input w-auto" value={f.role ?? ''} onChange={(e) => setF({ role: e.target.value })} aria-label="Role">
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <select className="input w-auto" value={f.status ?? ''} onChange={(e) => setF({ status: e.target.value })} aria-label="Status">
            <option value="">Any status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
        {q.isLoading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : q.isError ? (
          <ErrorState error={q.error} />
        ) : (
          <DataTable
            rows={q.data!}
            rowKey={(u) => u.id}
            empty={<EmptyState title="No users match your filters." />}
            cardTitle={(u) => <span className="font-medium">{u.name}</span>}
            columns={[
              {
                key: 'name',
                header: 'Name',
                hideOnCard: true,
                sortValue: (u) => u.name,
                cell: (u) => (
                  <div>
                    <span className="font-medium text-ink">{u.name}</span> {u.status === 'INACTIVE' && <Flag2 tone="gray">Inactive</Flag2>} {u.locked && <Flag2 tone="red">Locked</Flag2>}
                    <p className="text-xs text-muted">{u.email}</p>
                  </div>
                ),
              },
              { key: 'role', header: 'Role', sortValue: (u) => u.role, cell: (u) => ROLE_LABELS[u.role] },
              {
                key: 'scope',
                header: 'Scope / Profile',
                cell: (u) =>
                  u.role === 'STAFF' ? (
                    u.personId ? <Link to={`/people/${u.personId}`}>{u.personName}</Link> : '—'
                  ) : u.role === 'COORDINATOR' ? (
                    <span className="text-xs">{u.scopes.map((s) => s.departmentName ?? s.activityName).join(', ')}</span>
                  ) : (
                    <span className="text-xs text-muted">All</span>
                  ),
              },
              { key: 'login', header: 'Last sign-in', sortValue: (u) => u.lastLogin, cell: (u) => <span className="num text-xs">{u.lastLogin ? formatDateTimeLocal(u.lastLogin, tz) : 'Never'}</span> },
              {
                key: 'act',
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                cell: (u) => (
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEdit({ ...u, scopeDepartmentIds: u.scopes.map((s) => s.departmentId!).filter(Boolean), scopeActivityIds: u.scopes.map((s) => s.activityId!).filter(Boolean) })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: u.id, action: 'reset-link' })} title="Issue a password reset link">
                      <KeyRound className="h-4 w-4" />
                      <span className="sr-only">Reset link</span>
                    </Button>
                    {u.locked && (
                      <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: u.id, action: 'unlock' })}>
                        Unlock
                      </Button>
                    )}
                    {u.id !== me?.id && (
                      <Button size="sm" variant="ghost" className={u.status === 'ACTIVE' ? 'text-st-absent' : ''} onClick={() => act.mutate({ id: u.id, action: u.status === 'ACTIVE' ? 'deactivate' : 'activate' })}>
                        {u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </PanelBox>
      <UserDialog value={edit} onClose={() => setEdit(null)} />
      <Modal
        open={!!resetLink}
        onOpenChange={(o) => {
          if (!o) {
            setResetLink(null);
            setCopied(false);
          }
        }}
        title="Password reset link"
        description="Valid for 24 hours and usable once. It is shown only now — share it with the user through a trusted channel."
        footer={<Button onClick={() => setResetLink(null)}>Done</Button>}
      >
        <div className="flex gap-2">
          <input readOnly className="input font-mono text-xs" value={resetLink ?? ''} onFocus={(e) => e.target.select()} aria-label="Reset link" />
          <Button
            onClick={() => {
              navigator.clipboard?.writeText(resetLink ?? '');
              setCopied(true);
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function UserDialog({ value, onClose }: { value: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { departments, activities } = useOrg();
  const people = usePeopleOptions();
  const [u, setU] = useState<any>(null);
  useEffect(() => {
    setU(value);
    m.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const m = useMutation({
    mutationFn: () => {
      const body = { name: u.name, phone: u.phone || null, role: u.role, personId: u.role === 'STAFF' ? u.personId || null : null, scopeDepartmentIds: u.scopeDepartmentIds ?? [], scopeActivityIds: u.scopeActivityIds ?? [] };
      return u.id ? api.patch(`/users/${u.id}`, body) : api.post('/users', { ...body, email: u.email, password: u.password });
    },
    onSuccess: () => {
      toast({ kind: 'success', title: u.id ? 'User updated' : 'User created' });
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  if (!u) return null;
  const fe = fieldErrors(m.error);
  const toggle = (key: 'scopeDepartmentIds' | 'scopeActivityIds', id: string) => setU({ ...u, [key]: (u[key] ?? []).includes(id) ? u[key].filter((x: string) => x !== id) : [...(u[key] ?? []), id] });
  return (
    <Modal
      open={!!value}
      onOpenChange={(o) => !o && onClose()}
      wide
      title={u.id ? `Edit ${u.email}` : 'Add user'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            {u.id ? 'Save changes' : 'Create user'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={fe.name}>
          {(p) => <input {...p} className="input" value={u.name ?? ''} onChange={(e) => setU({ ...u, name: e.target.value })} />}
        </Field>
        <Field label="Email" required error={fe.email} hint={u.id ? 'Email cannot be changed' : undefined}>
          {(p) => <input {...p} type="email" className="input" disabled={!!u.id} value={u.email ?? ''} onChange={(e) => setU({ ...u, email: e.target.value })} />}
        </Field>
        <Field label="Phone" error={fe.phone}>
          {(p) => <input {...p} className="input" value={u.phone ?? ''} onChange={(e) => setU({ ...u, phone: e.target.value })} />}
        </Field>
        <Field label="Role" required>
          {(p) => (
            <select {...p} className="input" value={u.role} onChange={(e) => setU({ ...u, role: e.target.value })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {!u.id && (
          <Field label="Initial password" required error={fe.password} hint="At least 10 characters with letters and numbers.">
            {(p) => <input {...p} type="text" autoComplete="new-password" className="input font-mono" value={u.password ?? ''} onChange={(e) => setU({ ...u, password: e.target.value })} />}
          </Field>
        )}
        {u.role === 'STAFF' && (
          <Field label="Linked profile" required error={fe.personId}>
            {(p) => (
              <select {...p} className="input" value={u.personId ?? ''} onChange={(e) => setU({ ...u, personId: e.target.value })}>
                <option value="">Select…</option>
                {(people.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.fullName} ({x.refId})
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {u.role === 'COORDINATOR' && (
          <fieldset className="sm:col-span-2">
            <legend className="label">Scope — this coordinator can see only these departments / activities</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded border border-line p-3">
                <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted">Departments</p>
                {departments.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 py-0.5 text-sm">
                    <input type="checkbox" checked={(u.scopeDepartmentIds ?? []).includes(d.id)} onChange={() => toggle('scopeDepartmentIds', d.id)} /> {d.name}
                  </label>
                ))}
              </div>
              <div className="rounded border border-line p-3">
                <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted">Sports / activities</p>
                {activities.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 py-0.5 text-sm">
                    <input type="checkbox" checked={(u.scopeActivityIds ?? []).includes(a.id)} onChange={() => toggle('scopeActivityIds', a.id)} /> {a.name}
                  </label>
                ))}
              </div>
            </div>
          </fieldset>
        )}
        <div className="sm:col-span-2">
          <FormError error={m.error} />
        </div>
      </div>
    </Modal>
  );
}

// ============================================================ Roles
export function RolesPage() {
  const q = useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ roles: { role: Role; label: string; permissions: string[] }[]; permissions: { key: string; label: string }[] }>('/roles') });
  return (
    <div>
      <PageHeader eyebrow="Administration" title="Roles & Permissions" subtitle="Permissions are enforced by the server on every request. Coordinators additionally see only their assigned departments / activities." />
      <PanelBox>
        {!q.data ? (
          <TableSkeleton rows={10} cols={5} />
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Permission matrix">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Permission</th>
                  {q.data.roles.map((r) => (
                    <th key={r.role} scope="col" className="text-center">
                      {r.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.permissions.map((p) => (
                  <tr key={p.key}>
                    <th scope="row" className="!bg-white !text-sm !font-normal !normal-case !tracking-normal !text-ink">
                      {p.label}
                    </th>
                    {q.data.roles.map((r) => {
                      const has = r.permissions.includes(p.key);
                      return (
                        <td key={r.role} className="text-center">
                          {has ? <Check className="mx-auto h-4 w-4 text-st-present" aria-label="Allowed" /> : <span className="text-[#C5CBD4]" aria-label="Not allowed">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelBox>
    </div>
  );
}

// ============================================================ Rules (editable-document style)
function Inline({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span className="inline-flex align-baseline" aria-label={label}>
      {children}
    </span>
  );
}
const inlineCls = 'mx-0.5 inline-block rounded-sm border-0 border-b-2 border-dashed border-brand-600 bg-brand-50 px-1 py-0 text-center font-semibold text-brand-800 focus:border-solid focus:outline-none focus:ring-2 focus:ring-brand-100';

function TimeIn({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <input type="time" aria-label={label} className={clsx(inlineCls, 'w-[108px]')} value={value} onChange={(e) => onChange(e.target.value)} />;
}
function NumIn({ value, onChange, label, step = 1, max = 999, w = 'w-14' }: { value: number; onChange: (v: number) => void; label: string; step?: number; max?: number; w?: string }) {
  return <input type="number" aria-label={label} min={0} max={max} step={step} className={clsx(inlineCls, w)} value={value} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />;
}
function Choice<T extends string | boolean>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <select aria-label={label} className={clsx(inlineCls, 'text-left')} value={String(value)} onChange={(e) => onChange(options.find(([v]) => String(v) === e.target.value)![0])}>
      {options.map(([v, l]) => (
        <option key={String(v)} value={String(v)}>
          {l}
        </option>
      ))}
    </select>
  );
}
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function RulesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsPayload>('/settings') });
  const [rules, setRules] = useState<AttendanceRules | null>(null);
  useEffect(() => {
    if (q.data && !rules) setRules(q.data.rules);
  }, [q.data, rules]);
  const save = useMutation({
    mutationFn: () => api.put('/settings/rules', rules),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Attendance rules saved', body: 'Percentages and late/early flags now use the new rules. The change is in the audit log.' });
      qc.invalidateQueries();
    },
  });
  if (!rules) return q.isError ? <ErrorState error={q.error} /> : <Skeleton className="h-96" />;
  const dirty = JSON.stringify(rules) !== JSON.stringify(q.data?.rules);
  const setType = (t: PersonType, patch: Partial<TypeRules>) => setRules({ ...rules, byType: { ...rules.byType, [t]: { ...rules.byType[t], ...patch } } });
  const editable = can('rules.manage');

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Administration"
        title="Attendance Rules"
        subtitle="Edit the highlighted values directly. Nothing is hard-coded — all calculations read these rules."
        actions={
          editable && (
            <>
              <Button disabled={!dirty} onClick={() => setRules(q.data!.rules)}>
                Discard changes
              </Button>
              <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                Save rules
              </Button>
            </>
          )
        }
      />
      <fieldset disabled={!editable} className="panel space-y-6 p-6 text-[15px] leading-9 text-ink">
        {(['GUEST_FACULTY', 'SPORTS_COACH'] as PersonType[]).map((t) => {
          const r = rules.byType[t];
          return (
            <section key={t} aria-labelledby={`rules-${t}`}>
              <h2 id={`rules-${t}`} className="mb-1 text-base font-semibold">
                {PERSON_TYPE_LABELS[t]}
              </h2>
              <p>
                {t === 'GUEST_FACULTY' ? 'Guest Faculty members' : 'Sports Coaches'} are expected from <Inline label="start"><TimeIn label={`${t} office start`} value={r.officeStart} onChange={(v) => setType(t, { officeStart: v })} /></Inline> to{' '}
                <TimeIn label={`${t} office end`} value={r.officeEnd} onChange={(v) => setType(t, { officeEnd: v })} />. A check-in is <b>late</b> after a grace period of{' '}
                <NumIn label={`${t} grace minutes`} value={r.graceMinutes} max={180} onChange={(v) => setType(t, { graceMinutes: v })} /> minutes, and a check-out is an <b>early departure</b> if it is more than{' '}
                <NumIn label={`${t} early departure grace`} value={r.earlyDepartureGraceMinutes} max={180} onChange={(v) => setType(t, { earlyDepartureGraceMinutes: v })} /> minutes before the end time.
              </p>
              <p>
                A day counts as a <b>full day</b> with at least <NumIn label={`${t} full-day hours`} value={r.minHoursFullDay} step={0.5} max={24} onChange={(v) => setType(t, { minHoursFullDay: v })} /> hours, and as a{' '}
                <b>half day</b> with at least <NumIn label={`${t} half-day hours`} value={r.minHoursHalfDay} step={0.5} max={24} onChange={(v) => setType(t, { minHoursHalfDay: v })} /> hours.
              </p>
              <p className="flex flex-wrap items-center gap-x-1">
                Working days:
                {DAY_NAMES.map((d, i) => {
                  const on = r.workingDays.includes(i + 1);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setType(t, { workingDays: on ? r.workingDays.filter((x) => x !== i + 1) : [...r.workingDays, i + 1].sort() })}
                      className={clsx('mx-0.5 rounded-sm border px-2 py-0 text-sm leading-7', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-muted line-through')}
                    >
                      {d}
                    </button>
                  );
                })}
              </p>
            </section>
          );
        })}
        <section className="border-t border-line pt-5" aria-labelledby="rules-calc">
          <h2 id="rules-calc" className="mb-1 text-base font-semibold">
            Attendance percentage
          </h2>
          <p>
            Approved leave days are{' '}
            <Choice
              label="Leave handling"
              value={rules.excludeLeaveFromDenominator ? 'exclude' : rules.leaveCountsAsPresent ? 'present' : 'absent'}
              options={[
                ['exclude', 'excluded from working days'],
                ['present', 'counted as present'],
                ['absent', 'counted as absent'],
              ]}
              onChange={(v) => setRules({ ...rules, excludeLeaveFromDenominator: v === 'exclude', leaveCountsAsPresent: v === 'present' })}
            />
            . Institutional holidays are{' '}
            <Choice label="Holidays" value={rules.countHolidays} options={[[false, 'not working days'], [true, 'counted as paid working days']]} onChange={(v) => setRules({ ...rules, countHolidays: v })} />
            , and non-working weekdays are{' '}
            <Choice label="Weekends" value={rules.countWeekends} options={[[false, 'ignored unless the person attended'], [true, 'counted as working days']]} onChange={(v) => setRules({ ...rules, countWeekends: v })} />.
          </p>
          <p>
            A half day earns <NumIn label="Half-day weight" value={rules.halfDayWeight} step={0.05} max={1} w="w-16" onChange={(v) => setRules({ ...rules, halfDayWeight: v })} /> of a day’s credit. On check-out, the day’s status is{' '}
            <Choice
              label="Auto classification"
              value={rules.autoClassifyByHours}
              options={[
                [true, 'set automatically from hours worked'],
                [false, 'always Present'],
              ]}
              onChange={(v) => setRules({ ...rules, autoClassifyByHours: v })}
            />
            .
          </p>
        </section>
        <section className="border-t border-line pt-5" aria-labelledby="rules-corr">
          <h2 id="rules-corr" className="mb-1 text-base font-semibold">
            Corrections
          </h2>
          <p>
            Corrections made by Authorized Officers{' '}
            <Choice label="Correction approval" value={rules.manualCorrectionRequiresApproval} options={[[false, 'take effect immediately'], [true, 'need Super Admin approval']]} onChange={(v) => setRules({ ...rules, manualCorrectionRequiresApproval: v })} />
            . Every correction requires a reason and is recorded in the audit log either way.
          </p>
        </section>
        <section className="rounded border border-line bg-[#FAFBFC] px-4 py-3 text-sm leading-6" aria-label="Formula preview">
          <p className="mb-1 font-semibold">Resulting formula</p>
          <ul className="list-disc pl-5 text-muted">
            {describeFormula(rules).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
        <FormError error={save.error} />
      </fieldset>
    </div>
  );
}

// ============================================================ System settings
export function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsPayload>('/settings') });
  const [sys, setSys] = useState<SystemSettings | null>(null);
  const [hol, setHol] = useState({ date: '', name: '' });
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (q.data && !sys) setSys(q.data.system);
  }, [q.data, sys]);
  const save = useMutation({
    mutationFn: () => {
      const { logoPath: _l, ...rest } = sys!;
      return api.put('/settings/system', rest);
    },
    onSuccess: () => {
      toast({ kind: 'success', title: 'Settings saved' });
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['public-settings'] });
    },
  });
  const logo = useMutation({
    mutationFn: (file: File | null) => {
      if (!file) return api.del('/settings/logo');
      const fd = new FormData();
      fd.append('logo', file);
      return api.upload('/settings/logo', fd);
    },
    onSuccess: () => {
      toast({ kind: 'success', title: 'Logo updated' });
      qc.invalidateQueries({ queryKey: ['public-settings'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e: Error) => toast({ kind: 'error', title: 'Logo upload failed', body: e.message }),
  });
  const addHol = useMutation({
    mutationFn: () => api.post('/holidays', hol),
    onSuccess: () => {
      setHol({ date: '', name: '' });
      qc.invalidateQueries();
    },
  });
  const delHol = useMutation({ mutationFn: (id: string) => api.del(`/holidays/${id}`), onSuccess: () => qc.invalidateQueries() });
  if (!sys) return q.isError ? <ErrorState error={q.error} /> : <Skeleton className="h-96" />;
  const fe = fieldErrors(save.error);
  const set = (k: keyof SystemSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setSys({ ...sys, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value });
  const upcoming = (q.data?.holidays ?? []).filter((h) => h.date >= DateTime.now().minus({ months: 3 }).toISODate()!);
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader eyebrow="Administration" title="System Settings" />
      <PanelBox title="Institution & branding">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="University name" required error={fe.universityName} className="sm:col-span-2">
            {(p) => <input {...p} className="input" value={sys.universityName} onChange={set('universityName')} />}
          </Field>
          <Field label="Academic / administrative unit" error={fe.unitName} className="sm:col-span-2">
            {(p) => <input {...p} className="input" value={sys.unitName} onChange={set('unitName')} />}
          </Field>
          <div className="sm:col-span-2">
            <p className="label">University logo</p>
            <div className="flex flex-wrap items-center gap-3">
              {q.data?.system.logoPath ? (
                <img src={`/api/settings/logo?t=${Date.now()}`} alt="Current logo" className="h-14 w-14 rounded border border-line object-contain p-1" />
              ) : (
                <span className="inline-flex h-14 w-14 items-center justify-center rounded border border-dashed border-line text-[9px] uppercase text-muted">Logo</span>
              )}
              <Button onClick={() => fileRef.current?.click()} loading={logo.isPending}>
                <Upload className="h-4 w-4" /> Upload official logo
              </Button>
              {q.data?.system.logoPath && (
                <Button variant="ghost" onClick={() => logo.mutate(null)}>
                  Remove
                </Button>
              )}
              <input ref={fileRef} type="file" className="hidden" accept="image/png,image/jpeg" onChange={(e) => e.target.files?.[0] && logo.mutate(e.target.files[0])} />
            </div>
            <p className="mt-1 text-xs text-muted">PNG or JPEG, up to 1 MB. Only upload the official logo supplied by the University. A neutral placeholder is shown until then.</p>
          </div>
          <Field label="Report footer" error={fe.reportFooter} className="sm:col-span-2">
            {(p) => <textarea {...p} rows={2} className="input" value={sys.reportFooter} onChange={set('reportFooter')} />}
          </Field>
        </div>
      </PanelBox>
      <PanelBox title="Time & format">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Timezone" required error={fe.timezone} hint="IANA name. All official times are calculated in this zone.">
            {(p) => <input {...p} className="input" value={sys.timezone} onChange={set('timezone')} />}
          </Field>
          <Field label="Date format">
            {(p) => (
              <select {...p} className="input" value={sys.dateFormat} onChange={set('dateFormat')}>
                <option value="dd MMM yyyy">28 Sep 2026</option>
                <option value="dd/MM/yyyy">28/09/2026</option>
                <option value="yyyy-MM-dd">2026-09-28</option>
              </select>
            )}
          </Field>
        </div>
      </PanelBox>
      <PanelBox title="Leave rules">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Maximum days per request" error={fe.leaveMaxDaysPerRequest}>
            {(p) => <input {...p} type="number" min={1} max={365} className="input" value={sys.leaveMaxDaysPerRequest} onChange={set('leaveMaxDaysPerRequest')} />}
          </Field>
          <Field label="Staff may apply up to N days in arrears" error={fe.leaveAllowBackdatedDays}>
            {(p) => <input {...p} type="number" min={0} max={60} className="input" value={sys.leaveAllowBackdatedDays} onChange={set('leaveAllowBackdatedDays')} />}
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <div className="mr-auto">
            <FormError error={save.error} />
          </div>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save settings
          </Button>
        </div>
      </PanelBox>
      <PanelBox title="Holidays" actions={<span className="text-xs text-muted">Working days are defined per type under Attendance Rules</span>}>
        <form
          className="flex flex-wrap items-end gap-2 border-b border-line px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            addHol.mutate();
          }}
        >
          <Field label="Date">{(p) => <input {...p} type="date" className="input w-auto" value={hol.date} onChange={(e) => setHol({ ...hol, date: e.target.value })} />}</Field>
          <Field label="Name" className="min-w-[220px] flex-1">
            {(p) => <input {...p} className="input" value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} />}
          </Field>
          <Button type="submit" loading={addHol.isPending} disabled={!hol.date || hol.name.length < 2}>
            <Plus className="h-4 w-4" /> Add holiday
          </Button>
          <div className="w-full">
            <FormError error={addHol.error} />
          </div>
        </form>
        <DataTable
          rows={upcoming}
          rowKey={(h) => h.id}
          empty={<EmptyState title="No holidays configured." />}
          columns={[
            { key: 'date', header: 'Date', cell: (h) => DateTime.fromISO(h.date).toFormat('ccc, dd MMM yyyy') },
            { key: 'name', header: 'Holiday', cell: (h) => h.name },
            {
              key: 'x',
              header: <span className="sr-only">Remove</span>,
              align: 'right',
              cell: (h) => (
                <Button size="sm" variant="ghost" onClick={() => delHol.mutate(h.id)} aria-label={`Remove ${h.name}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              ),
            },
          ]}
        />
      </PanelBox>
    </div>
  );
}

// ============================================================ Audit logs
interface AuditRow {
  id: number;
  createdAt: string;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
}

export function AuditPage() {
  const tz = useTz();
  const [f, setF] = useUrlState<{ q?: string; action?: string; entityType?: string; from?: string; to?: string; page?: string }>({});
  const page = Number(f.page ?? 1);
  const q = useQuery({ queryKey: ['audit', f], queryFn: () => api.get<{ total: number; rows: AuditRow[] }>('/audit-logs', { ...f, page, pageSize: 50 }), placeholderData: (p) => p });
  const actions = useQuery({ queryKey: ['audit-actions'], queryFn: () => api.get<string[]>('/audit-logs/actions') });
  const [open, setOpen] = useState<AuditRow | null>(null);
  return (
    <div>
      <PageHeader eyebrow="Accountability" title="Audit Logs" subtitle="Append-only record of sign-ins, attendance changes, leave decisions, user and configuration changes. Entries cannot be edited or deleted." />
      <PanelBox>
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3" data-noprint>
          <input className="input w-64" placeholder="Search summary, user, reason" value={f.q ?? ''} onChange={(e) => setF({ q: e.target.value, page: undefined })} aria-label="Search audit log" />
          <select className="input w-auto" value={f.action ?? ''} onChange={(e) => setF({ action: e.target.value, page: undefined })} aria-label="Action">
            <option value="">All actions</option>
            {(actions.data ?? []).map((a) => (
              <option key={a} value={a}>
                {a.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
          <select className="input w-auto" value={f.entityType ?? ''} onChange={(e) => setF({ entityType: e.target.value, page: undefined })} aria-label="Record type">
            <option value="">All records</option>
            {['attendance', 'leave', 'person', 'user', 'settings', 'department', 'activity', 'holiday', 'report'].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm">
            <span className="text-muted">From</span>
            <input type="date" className="input w-auto" value={f.from ?? ''} onChange={(e) => setF({ from: e.target.value, page: undefined })} />
          </label>
          <label className="flex items-center gap-1 text-sm">
            <span className="text-muted">To</span>
            <input type="date" className="input w-auto" value={f.to ?? ''} onChange={(e) => setF({ to: e.target.value, page: undefined })} />
          </label>
        </div>
        {q.isLoading ? (
          <TableSkeleton rows={10} cols={5} />
        ) : q.isError ? (
          <ErrorState error={q.error} />
        ) : (
          <>
            <DataTable
              rows={q.data!.rows}
              rowKey={(r) => String(r.id)}
              onRowClick={setOpen}
              empty={<EmptyState title="No audit entries match your filters." />}
              cardTitle={(r) => <span className="font-medium">{r.summary}</span>}
              columns={[
                { key: 'ts', header: 'Timestamp', cell: (r) => <span className="num whitespace-nowrap text-xs">{formatDateTimeLocal(r.createdAt, tz)}</span> },
                { key: 'user', header: 'User', cell: (r) => <span className="text-[13px]">{r.userName ?? 'System'}</span> },
                { key: 'action', header: 'Action', cell: (r) => <span className="font-mono text-2xs">{r.action}</span> },
                { key: 'record', header: 'Record', hideOnCard: true, cell: (r) => <span className="text-[13px]">{r.summary}</span> },
                { key: 'old', header: 'Old value', cell: (r) => <ValuePreview v={r.oldValue} /> },
                { key: 'new', header: 'New value', cell: (r) => <ValuePreview v={r.newValue} /> },
              ]}
            />
            <Pagination page={page} pageSize={50} total={q.data!.total} onPage={(p) => setF({ page: String(p) })} />
          </>
        )}
      </PanelBox>
      <Modal open={!!open} onOpenChange={(o) => !o && setOpen(null)} wide title={open?.summary ?? ''} description={open && `${formatDateTimeLocal(open.createdAt, tz)} · ${open.userName ?? 'System'} · ${open.action}`}>
        {open && (
          <div className="space-y-3 text-sm">
            {open.reason && (
              <p>
                <b>Reason:</b> {open.reason}
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted">Old value</p>
                <pre className="max-h-72 overflow-auto rounded border border-line bg-[#FAFBFC] p-2 text-2xs">{open.oldValue ? JSON.stringify(open.oldValue, null, 2) : '—'}</pre>
              </div>
              <div>
                <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted">New value</p>
                <pre className="max-h-72 overflow-auto rounded border border-line bg-[#FAFBFC] p-2 text-2xs">{open.newValue ? JSON.stringify(open.newValue, null, 2) : '—'}</pre>
              </div>
            </div>
            <p className="text-xs text-muted">
              Record: {open.entityType} {open.entityId ?? ''} · IP {open.ip ?? '—'} · {open.userAgent ?? ''}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ValuePreview({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-muted">—</span>;
  const s = typeof v === 'object' ? Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && typeof x !== 'object').slice(0, 3).map(([k, x]) => `${k}: ${String(x).slice(0, 24)}`).join(', ') : String(v);
  return <span className="line-clamp-2 max-w-[220px] font-mono text-2xs text-muted">{s || '{…}'}</span>;
}

// ============================================================ Profile
export function ProfilePage() {
  const { me } = useAuth();
  const tz = useTz();
  const toast = useToast();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const m = useMutation({
    mutationFn: () => api.post<{ message: string }>('/auth/password/change', { currentPassword: pw.currentPassword, newPassword: pw.newPassword }),
    onSuccess: (r) => {
      toast({ kind: 'success', title: 'Password changed', body: r.message });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
    },
  });
  if (!me) return null;
  const fe = fieldErrors(m.error);
  const mismatch = pw.confirm.length > 0 && pw.confirm !== pw.newPassword;
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader eyebrow="Account" title="Profile" />
      <PanelBox title="Account">
        <dl className="grid gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-2xs uppercase tracking-wide text-muted">Name</dt>
            <dd>{me.name}</dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-muted">Email</dt>
            <dd>{me.email}</dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-muted">Role</dt>
            <dd>{ROLE_LABELS[me.role]}</dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-muted">Last sign-in</dt>
            <dd>{me.lastLogin ? formatDateTimeLocal(me.lastLogin, tz) : '—'}</dd>
          </div>
          {me.personId && (
            <div>
              <dt className="text-2xs uppercase tracking-wide text-muted">Linked profile</dt>
              <dd>
                {me.personName} ({me.refId})
              </dd>
            </div>
          )}
          {me.scopes.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="text-2xs uppercase tracking-wide text-muted">Assigned scope</dt>
              <dd>{me.scopes.map((s) => s.departmentName ?? s.activityName).join(', ')}</dd>
            </div>
          )}
        </dl>
      </PanelBox>
      <PanelBox title="Change password">
        <form
          className="grid max-w-md gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!mismatch) m.mutate();
          }}
        >
          <Field label="Current password" error={fe.currentPassword}>
            {(p) => <input {...p} type="password" autoComplete="current-password" className="input" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}
          </Field>
          <Field label="New password" error={fe.newPassword} hint="At least 10 characters with letters and numbers.">
            {(p) => <input {...p} type="password" autoComplete="new-password" className="input" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}
          </Field>
          <Field label="Confirm new password" error={mismatch ? 'Passwords do not match.' : undefined}>
            {(p) => <input {...p} type="password" autoComplete="new-password" className="input" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />}
          </Field>
          <FormError error={m.error} />
          <div>
            <Button type="submit" variant="primary" loading={m.isPending} disabled={!pw.currentPassword || !pw.newPassword || mismatch}>
              Change password
            </Button>
          </div>
        </form>
      </PanelBox>
    </div>
  );
}
