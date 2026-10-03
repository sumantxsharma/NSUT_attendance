import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import clsx from 'clsx';
import { Bell, CalendarOff, ClipboardCheck, FileText, LayoutDashboard, ListChecks, LogOut, Menu, Search, Settings2, User, Users } from 'lucide-react';
import { APP_NAME, APP_SUBTITLE, ROLE_LABELS, type Permission } from '@nsut/shared';
import { api } from '../lib/api';
import { useAuth, usePublicSettings } from '../lib/auth';
import { relativeTime, unitName } from '../lib/format';
import type { Person } from '../lib/types';

interface Tab {
  to: string;
  label: string;
  perm?: Permission;
}
interface Section {
  label: string;
  icon: typeof LayoutDashboard;
  /** Where the sidebar link goes: the first tab the user may open, or `to` when there are no tabs. */
  to?: string;
  perm?: Permission | Permission[];
  /** Path prefixes that belong to this section. */
  match: string[];
  tabs?: Tab[];
}

// Top-level sections stay short; sub-pages are tabs shown at the top of the section.
const SECTIONS: Section[] = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/', perm: 'dashboard.view', match: [] },
  { label: 'My Attendance', icon: ClipboardCheck, to: '/me', perm: 'attendance.self', match: ['/me'] },
  {
    label: 'Attendance',
    icon: ListChecks,
    match: ['/attendance'],
    tabs: [
      { to: '/attendance/today', label: 'Today', perm: 'attendance.read' },
      { to: '/attendance/live', label: 'Live presence', perm: 'attendance.read' },
      { to: '/attendance/calendar', label: 'Calendar', perm: 'attendance.read' },
      { to: '/attendance/monthly', label: 'Monthly', perm: 'attendance.read' },
      { to: '/attendance/corrections', label: 'Corrections', perm: 'attendance.read' },
    ],
  },
  {
    label: 'People',
    icon: Users,
    match: ['/people', '/activities'],
    tabs: [
      { to: '/people/faculty', label: 'Guest Faculty', perm: 'people.read' },
      { to: '/people/coaches', label: 'Sports Coaches', perm: 'people.read' },
      { to: '/activities', label: 'Sports & Activities', perm: 'people.read' },
    ],
  },
  { label: 'Leave', icon: CalendarOff, to: '/leave', perm: ['leave.self', 'leave.review'], match: ['/leave'] },
  { label: 'Reports', icon: FileText, to: '/reports', perm: 'reports.generate', match: ['/reports'] },
  {
    label: 'Administration',
    icon: Settings2,
    match: ['/admin', '/audit'],
    tabs: [
      { to: '/admin/users', label: 'Users', perm: 'users.manage' },
      { to: '/admin/roles', label: 'Roles', perm: 'users.manage' },
      { to: '/admin/rules', label: 'Attendance rules', perm: 'rules.manage' },
      { to: '/admin/settings', label: 'Settings', perm: 'settings.manage' },
      { to: '/audit', label: 'Audit log', perm: 'audit.read' },
    ],
  },
];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(prefix + '/');

function useSections() {
  const { can } = useAuth();
  const allowed = (perm?: Permission | Permission[]) => !perm || (Array.isArray(perm) ? perm.some((p) => can(p)) : can(perm));
  return SECTIONS.flatMap((s) => {
    const tabs = s.tabs?.filter((t) => allowed(t.perm));
    if (tabs ? tabs.length === 0 : !allowed(s.perm)) return [];
    return [{ ...s, tabs, to: tabs?.[0].to ?? s.to! }];
  });
}

function sectionFor(sections: ReturnType<typeof useSections>, pathname: string) {
  return sections.find((s) => (s.to === '/' ? pathname === '/' : s.match.some((m) => under(pathname, m))));
}

function LogoMark({ size = 36 }: { size?: number }) {
  const { data } = usePublicSettings();
  if (data?.hasLogo)
    return <img src={`/api/settings/logo?v=${data.logoVersion}`} alt="University logo" className="shrink-0 rounded bg-white object-contain p-0.5" style={{ width: size, height: size }} />;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded border border-dashed border-[#C5CBD4] text-[8px] font-semibold uppercase tracking-wider text-muted"
      style={{ width: size, height: size }}
      title="Placeholder — upload the official logo in System Settings"
      aria-label="Logo placeholder"
    >
      Logo
    </span>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const sections = useSections();
  const loc = useLocation();
  const current = sectionFor(sections, loc.pathname);
  return (
    <nav aria-label="Main" className="flex h-full flex-col border-r border-line bg-white">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <LogoMark size={28} />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-semibold text-ink" title={APP_NAME}>NSUT Attendance</p>
          <p className="truncate text-2xs text-muted" title={APP_SUBTITLE}>Guest Faculty & Coaches</p>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {sections.map((s) => {
          const active = s === current;
          return (
            <li key={s.label}>
              <NavLink
                to={s.to}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'flex items-center gap-3 rounded px-2.5 py-2 text-sm no-underline transition-colors',
                  active ? 'bg-[#F0F2F5] font-medium text-ink' : 'text-[#475467] hover:bg-[#F6F7F9] hover:text-ink',
                )}
              >
                <s.icon className={clsx('h-[18px] w-[18px] shrink-0', active ? 'text-brand-600' : 'text-[#98A2B3]')} aria-hidden />
                {s.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
      <p className="px-4 py-3 text-[11px] text-muted">Built in-house at NSUT</p>
    </nav>
  );
}

/** Tab strip for the current section's sub-pages. */
function SectionTabs() {
  const sections = useSections();
  const loc = useLocation();
  const tabs = sectionFor(sections, loc.pathname)?.tabs;
  if (!tabs || tabs.length < 2) return null;
  return (
    <nav aria-label="Section" className="-mx-3 mb-5 overflow-x-auto border-b border-line px-3 sm:-mx-6 sm:px-6" data-noprint>
      <ul className="flex gap-5">
        {tabs.map((t) => {
          const active = under(loc.pathname, t.to);
          return (
            <li key={t.to}>
              <Link
                to={t.to}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  '-mb-px block whitespace-nowrap border-b-2 py-2.5 text-sm no-underline',
                  active ? 'border-brand-600 font-medium text-ink' : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<(Pick<Person, 'id' | 'fullName' | 'refId' | 'type' | 'status' | 'activityName'>)[]>('/search', { q: debounced }),
    enabled: debounced.length >= 2,
  });
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input,textarea,select')) {
        e.preventDefault();
        ref.current?.querySelector('input')?.focus();
      }
    };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, []);
  const results = debounced.length >= 2 ? (data ?? []) : [];
  const go = (id: string) => {
    setOpen(false);
    setQ('');
    nav(`/people/${id}`);
  };
  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        className="input pl-9 pr-9"
        placeholder="Search name, ref. ID or sport…"
        value={q}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="global-search-results"
        aria-autocomplete="list"
        aria-label="Search personnel"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && results[active]) go(results[active].id);
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      <span className="kbd absolute right-2.5 top-1/2 hidden -translate-y-1/2 lg:inline">/</span>
      {open && debounced.length >= 2 && (
        <ul id="global-search-results" role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border border-line bg-white py-1 shadow-lg">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">{isFetching ? 'Searching…' : 'No personnel match your search.'}</li>}
          {results.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === active}
              className={clsx('cursor-pointer px-3 py-2 text-sm', i === active && 'bg-brand-50')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                go(r.id);
              }}
            >
              <span className="font-medium text-ink">{r.fullName}</span>
              <span className="ml-2 font-mono text-2xs text-muted">{r.refId}</span>
              {r.status === 'INACTIVE' && <span className="ml-2 text-2xs text-st-absent">Inactive</span>}
              <div className="text-xs text-muted">{unitName(r as any)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ unread: number; rows: { id: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }[] }>('/notifications'),
    refetchInterval: 60_000,
  });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const readOne = useMutation({ mutationFn: (id: string) => api.patch(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const unread = data?.unread ?? 0;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="relative rounded p-2 text-ink hover:bg-[#EDEFF3]" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="num absolute right-0.5 top-0.5 min-w-[17px] rounded-full bg-st-absent px-1 text-center text-[10px] font-semibold leading-[17px] text-white">{unread > 99 ? '99+' : unread}</span>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-40 w-[min(360px,calc(100vw-24px))] rounded-md border border-line bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {unread > 0 && (
              <button className="text-xs text-brand-700 hover:underline" onClick={() => readAll.mutate()}>
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {(data?.rows ?? []).length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">You're all caught up.</p>}
            {data?.rows.map((n) => (
              <DropdownMenu.Item
                key={n.id}
                className="cursor-pointer border-b border-[#F0F2F5] px-3 py-2.5 outline-none data-[highlighted]:bg-brand-50"
                onSelect={() => {
                  if (!n.readAt) readOne.mutate(n.id);
                  if (n.link) nav(n.link);
                }}
              >
                <div className="flex items-start gap-2">
                  {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                  <div className="min-w-0">
                    <p className={clsx('text-sm', n.readAt ? 'text-muted' : 'font-medium text-ink')}>{n.title}</p>
                    {n.body && <p className="truncate text-xs text-muted">{n.body}</p>}
                    <p className="mt-0.5 text-2xs text-muted">{relativeTime(n.createdAt)}</p>
                  </div>
                </div>
              </DropdownMenu.Item>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function UserMenu() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  if (!me) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[#EDEFF3]" aria-label="Account menu">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-700 text-xs font-semibold text-white">
          {me.name
            .split(/\s+/)
            .slice(0, 2)
            .map((s) => s[0])
            .join('')}
        </span>
        <span className="hidden leading-tight lg:block">
          <span className="block max-w-[180px] truncate text-[13px] font-medium text-ink">{me.name}</span>
          <span className="block text-2xs text-muted">{ROLE_LABELS[me.role]}</span>
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-40 min-w-[220px] rounded-md border border-line bg-white py-1 shadow-lg">
          <div className="border-b border-line px-3 py-2">
            <p className="text-sm font-medium text-ink">{me.name}</p>
            <p className="text-xs text-muted">{me.email}</p>
          </div>
          <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-50" onSelect={() => nav('/profile')}>
            <User className="h-4 w-4" aria-hidden /> Profile & password
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-st-absent outline-none data-[highlighted]:bg-st-absentBg"
            onSelect={async () => {
              await logout();
              nav('/login');
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function AppLayout() {
  const [drawer, setDrawer] = useState(false);
  const { can } = useAuth();
  const loc = useLocation();
  useEffect(() => setDrawer(false), [loc.pathname, loc.search]);
  return (
    <div className="min-h-screen lg:pl-[232px] print:!pl-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] lg:block" data-noprint>
        <Sidebar />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation" data-noprint>
          <div className="absolute inset-0 bg-[#0B1320]/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-[272px] max-w-[85vw] shadow-xl">
            <Sidebar onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-white px-3 sm:px-5" data-noprint>
        <button className="rounded p-2 hover:bg-[#EDEFF3] lg:hidden" onClick={() => setDrawer(true)} aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">{can('people.read') ? <GlobalSearch /> : <span className="text-sm font-semibold text-ink lg:hidden">{APP_NAME}</span>}</div>
        <Notifications />
        <UserMenu />
      </header>
      <main id="main" className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6 sm:py-6">
        <SectionTabs />
        <Outlet />
      </main>
    </div>
  );
}

export function PanelBox({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={clsx('panel', className)}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <h2 className="panel-title">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2" data-noprint>{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export { Link, LogoMark, Users };
