import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { ATTENDANCE_STATUS_LABELS, PERSON_TYPE_LABELS, type PersonType } from '@nsut/shared';
import { api } from '../lib/api';
import type { Activity, Department, Person } from '../lib/types';

export function useOrg() {
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/departments'), staleTime: 60_000 });
  const activities = useQuery({ queryKey: ['activities'], queryFn: () => api.get<Activity[]>('/activities'), staleTime: 60_000 });
  return { departments: departments.data ?? [], activities: activities.data ?? [] };
}

export function usePeopleOptions(type?: PersonType) {
  return useQuery({
    queryKey: ['people-options', type],
    queryFn: () => api.get<{ rows: Person[] }>('/people', { type, pageSize: 200, status: 'ALL' }).then((r) => r.rows),
    staleTime: 60_000,
  });
}

export interface FilterValues {
  type?: PersonType | '';
  departmentId?: string;
  activityId?: string;
  status?: string;
  personId?: string;
  q?: string;
}

/** A single row of combinable filters. Omit a key from `show` to hide that control. */
export function FilterBar({
  value,
  onChange,
  show = ['type', 'department', 'activity'],
  statusOptions,
  children,
}: {
  value: FilterValues;
  onChange: (v: FilterValues) => void;
  show?: ('q' | 'type' | 'department' | 'activity' | 'status' | 'person')[];
  statusOptions?: { value: string; label: string }[];
  children?: React.ReactNode;
}) {
  const { departments, activities } = useOrg();
  const people = usePeopleOptions(value.type || undefined);
  const set = (patch: Partial<FilterValues>) => onChange({ ...value, ...patch });
  const active = Object.entries(value).filter(([, v]) => v).length;
  return (
    <div className="flex flex-wrap items-end gap-2" data-noprint role="group" aria-label="Filters">
      {children}
      {show.includes('q') && (
        <label className="min-w-[180px] flex-1 sm:flex-none">
          <span className="sr-only">Search</span>
          <input className="input" placeholder="Name or ref. ID" value={value.q ?? ''} onChange={(e) => set({ q: e.target.value })} />
        </label>
      )}
      {show.includes('type') && (
        <label>
          <span className="sr-only">Person type</span>
          <select className="input w-auto" value={value.type ?? ''} onChange={(e) => set({ type: e.target.value as PersonType, personId: '' })}>
            <option value="">All types</option>
            {Object.entries(PERSON_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}
      {show.includes('department') && value.type !== 'SPORTS_COACH' && (
        <label>
          <span className="sr-only">Department</span>
          <select className="input w-auto max-w-[240px]" value={value.departmentId ?? ''} onChange={(e) => set({ departmentId: e.target.value })}>
            <option value="">All departments</option>
            {departments
              .filter((d) => d.code !== 'SPORTS')
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {show.includes('activity') && value.type !== 'GUEST_FACULTY' && (
        <label>
          <span className="sr-only">Sport / activity</span>
          <select className="input w-auto" value={value.activityId ?? ''} onChange={(e) => set({ activityId: e.target.value })}>
            <option value="">All sports</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {show.includes('person') && (
        <label>
          <span className="sr-only">Person</span>
          <select className="input w-auto max-w-[240px]" value={value.personId ?? ''} onChange={(e) => set({ personId: e.target.value })}>
            <option value="">All people</option>
            {(people.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} ({p.refId})
              </option>
            ))}
          </select>
        </label>
      )}
      {show.includes('status') && (
        <label>
          <span className="sr-only">Status</span>
          <select className="input w-auto" value={value.status ?? ''} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All statuses</option>
            {(statusOptions ?? Object.entries(ATTENDANCE_STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {active > 0 && (
        <button type="button" className="btn-ghost btn-sm" onClick={() => onChange({})}>
          Clear filters
        </button>
      )}
    </div>
  );
}

export function MonthPicker({ year, month, onChange, max }: { year: number; month: number; onChange: (y: number, m: number) => void; max?: { year: number; month: number } }) {
  const cur = DateTime.fromObject({ year, month });
  const next = cur.plus({ months: 1 });
  const atMax = max ? next.year > max.year || (next.year === max.year && next.month > max.month) : false;
  return (
    <div className="inline-flex items-center rounded border border-[#C5CBD4] bg-white" role="group" aria-label="Month">
      <button type="button" className="h-9 px-2.5 text-ink hover:bg-[#F0F2F5]" aria-label="Previous month" onClick={() => onChange(cur.minus({ months: 1 }).year, cur.minus({ months: 1 }).month)}>
        ‹
      </button>
      <input
        type="month"
        aria-label="Select month"
        className="h-9 border-x border-[#C5CBD4] px-2 text-sm focus:outline-none"
        value={cur.toFormat('yyyy-MM')}
        max={max ? DateTime.fromObject({ year: max.year, month: max.month }).toFormat('yyyy-MM') : undefined}
        onChange={(e) => {
          const d = DateTime.fromFormat(e.target.value, 'yyyy-MM');
          if (d.isValid) onChange(d.year, d.month);
        }}
      />
      <button type="button" className="h-9 px-2.5 text-ink hover:bg-[#F0F2F5] disabled:opacity-40" aria-label="Next month" disabled={atMax} onClick={() => onChange(next.year, next.month)}>
        ›
      </button>
    </div>
  );
}

export function cleanFilters(f: FilterValues) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v) out[k] = String(v);
  return out;
}
