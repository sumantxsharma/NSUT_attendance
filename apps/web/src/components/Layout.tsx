import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import clsx from 'clsx';
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  FileText,
  GraduationCap,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trophy,
  User,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { APP_NAME, APP_SUBTITLE, ROLE_LABELS, type Permission } from '@nsut/shared';
import { api } from '../lib/api';
import { useAuth, usePublicSettings } from '../lib/auth';
import { relativeTime, unitName } from '../lib/format';
import type { Person } from '../lib/types';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  perm?: Permission;
  end?: boolean;
}
interface NavGroup {
  label?: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view', end: true },
      { to: '/me', label: 'My Attendance', icon: ClipboardCheck, perm: 'attendance.self' },
    ],
  },
  {
    label: 'Attendance',
    items: [
      { to: '/attendance/today', label: "Today's Attendance", icon: ListChecks, perm: 'attendance.read' },
      { to: '/attendance/live', label: 'Live Presence', icon: Radio, perm: 'attendance.read' },
      { to: '/attendance/calendar', label: 'Calendar', icon: CalendarDays, perm: 'attendance.read' },
      { to: '/attendance/monthly', label: 'Monthly Records', icon: CalendarRange, perm: 'attendance.read' },
      { to: '/attendance/corrections', label: 'Corrections', icon: History, perm: 'attendance.read' },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/people/faculty', label: 'Guest Faculty', icon: GraduationCap, perm: 'people.read' },
      { to: '/people/coaches', label: 'Sports Coaches', icon: Trophy, perm: 'people.read' },
      { to: '/departments', label: 'Departments', icon: Building2, perm: 'people.read' },
      { to: '/activities', label: 'Sports & Activities', icon: Activity, perm: 'people.read' },
    ],
  },
  {
    label: 'Leave',
    items: [
      { to: '/leave?status=PENDING', label: 'Requests', icon: ClipboardList, perm: 'leave.review' },
      { to: '/leave?status=APPROVED', label: 'Approved', icon: ClipboardCheck, perm: 'leave.review' },
      { to: '/leave?status=REJECTED', label: 'Rejected', icon: X, perm: 'leave.review' },
      { to: '/leave', label: 'My Leave', icon: ClipboardList, perm: 'leave.self' },
    ],
  },
  {
    label: 'Reports',
    items: [
      { to: '/reports/daily', label: 'Daily', icon: FileText, perm: 'reports.generate' },
      { to: '/reports/monthly', label: 'Monthly', icon: FileText, perm: 'reports.generate' },
      { to: '/reports/individual', label: 'Individual', icon: FileText, perm: 'reports.generate' },
      { to: '/reports/department', label: 'Department', icon: FileText, perm: 'reports.generate' },
      { to: '/reports/absence', label: 'Absence', icon: FileText, perm: 'reports.generate' },
      { to: '/reports/leave', label: 'Leave', icon: FileText, perm: 'reports.generate' },
      { to: '/reports', label: 'All reports', icon: BarChart3, perm: 'reports.generate', end: true },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/admin/users', label: 'Users', icon: UserCog, perm: 'users.manage' },
      { to: '/admin/roles', label: 'Roles', icon: ShieldCheck, perm: 'users.manage' },
      { to: '/admin/rules', label: 'Attendance Rules', icon: SlidersHorizontal, perm: 'rules.manage' },
      { to: '/admin/settings', label: 'System Settings', icon: Settings2, perm: 'settings.manage' },
    ],
  },
  {
    items: [
      { to: '/audit', label: 'Audit Logs', icon: History, perm: 'audit.read' },
      { to: '/profile', label: 'Profile', icon: User },
    ],
  },
];

function LogoMark({ size = 36 }: { size?: number }) {
  const { data } = usePublicSettings();
  if (data?.hasLogo)
    return <img src={`/api/settings/logo?v=${data.logoVersion}`} alt="University logo" className="shrink-0 rounded bg-white object-contain p-0.5" style={{ width: size, height: size }} />;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded border border-dashed border-white/40 text-[8px] font-semibold uppercase tracking-wider text-white/60"
      style={{ width: size, height: size }}
      title="Placeholder — upload the official logo in System Settings"
      aria-label="Logo placeholder"
    >
      Logo
    </span>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  const loc = useLocation();
  const isActive = (item: NavItem) => {
    const [path, query] = item.to.split('?');
    if (query) return loc.pathname === path && loc.search === `?${query}`;
    if (item.to === '/leave') return loc.pathname === '/leave' && !loc.search.includes('status=');
    return item.end ? loc.pathname === path : loc.pathname === path || loc.pathname.startsWith(path + '/');
  };
  return (
    <nav aria-label="Main" className="flex h-full flex-col bg-ink-800 text-[#D8DEE8]">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <LogoMark />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-semibold text-white">{APP_NAME}</p>
          <p className="truncate text-2xs text-[#9FB0C8]">{APP_SUBTITLE}</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((g, gi) => {
          const items = g.items.filter((i) => !i.perm || can(i.perm));
          if (!items.length) return null;
          return (
            <div key={gi} className="mb-3">
              {g.label && <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-[#7F91AD]">{g.label}</p>}
              <ul>
                {items.map((i) => {
                  const active = isActive(i);
                  return (
                    <li key={i.to}>
                      <NavLink
                        to={i.to}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={clsx(
                          'flex items-center gap-2.5 rounded px-2.5 py-[7px] text-[13.5px] no-underline transition-colors',
                          active ? 'bg-white/[0.12] font-medium text-white' : 'text-[#C9D2E0] hover:bg-white/[0.06] hover:text-white',
                        )}
                      >
                        <i.icon className={clsx('h-4 w-4 shrink-0', active ? 'text-white' : 'text-[#8FA1BD]')} aria-hidden />
                        {i.label}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="border-t border-white/10 px-4 py-2.5 text-[10.5px] text-[#7F91AD]">Built in-house at NSUT · R1</p>
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
    queryFn: () => api.get<(Pick<Person, 'id' | 'fullName' | 'refId' | 'type' | 'status' | 'departmentName' | 'activityName'>)[]>('/search', { q: debounced }),
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
        placeholder="Search name, ref. ID, department, sport…"
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
    <div className="min-h-screen lg:pl-[248px] print:!pl-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] lg:block" data-noprint>
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
