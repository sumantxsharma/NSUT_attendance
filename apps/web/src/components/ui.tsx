import { createContext, useCallback, useContext, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { ApiError } from '../lib/api';
import { initials } from '../lib/format';

// ---------------------------------------------------------------- Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'secondary',
  size,
  loading,
  children,
  className,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm'; loading?: boolean }) {
  return (
    <button
      className={clsx(`btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      type={rest.type ?? 'button'}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Form field
export function Field({
  label,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const descId = `${id}-desc`;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
        {required && (
          <span className="text-st-absent" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? descId : undefined })}
      {(error || hint) && (
        <p id={descId} className={clsx('mt-1 text-xs', error ? 'text-st-absent' : 'text-muted')} role={error ? 'alert' : undefined}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError || error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-start gap-2 rounded border border-[#F1C5C2] bg-st-absentBg px-3 py-2 text-sm text-st-absent">
      <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{msg}</span>
    </div>
  );
}

export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError && error.fields ? error.fields : {};
}

// ---------------------------------------------------------------- Page header
export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="text-2xs font-semibold uppercase tracking-wider text-muted">{eyebrow}</p>}
        <h1 className="text-[22px] font-semibold leading-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2" data-noprint>
          {actions}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- States
export function EmptyState({ title, body, icon, action }: { title: string; body?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-[#9AA1AC]">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-10 text-center">
      <AlertTriangle className="mb-2 h-6 w-6 text-st-leave" aria-hidden />
      <p className="font-medium text-ink">{forbidden ? 'Access restricted' : 'Could not load this information'}</p>
      <p className="mt-1 max-w-md text-sm text-muted">{msg}</p>
      {onRetry && !forbidden && (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-0" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-[#ECEEF2] px-4 py-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={clsx('h-4', c === 0 ? 'w-40' : 'flex-1')} />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

// ---------------------------------------------------------------- Avatar
export function Avatar({ name, personId, hasPhoto, size = 32 }: { name: string; personId?: string; hasPhoto?: boolean; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (hasPhoto && personId && !broken)
    return (
      <img
        src={`/api/people/${personId}/photo`}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full border border-line object-cover"
        style={{ width: size, height: size }}
      />
    );
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#E4E8EF] font-semibold text-ink-600"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------- Modal
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[#0B1320]/50" />
        <Dialog.Content
          className={clsx(
            'fixed left-1/2 top-[6vh] z-50 flex max-h-[88vh] w-[calc(100vw-24px)] -translate-x-1/2 flex-col rounded-md border border-line bg-white shadow-xl focus:outline-none',
            wide ? 'max-w-3xl' : 'max-w-lg',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-sm text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="rounded p-1 text-muted hover:bg-[#EDEFF3]" aria-label="Close">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-[#FAFBFC] px-5 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------- Toasts
type Toast = { id: number; kind: 'success' | 'error' | 'info'; title: string; body?: string };
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.kind === 'error' ? 7000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite" role="status" data-noprint>
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto flex items-start gap-3 rounded-md border bg-white px-4 py-3 shadow-lg',
              t.kind === 'success' && 'border-l-4 border-l-st-present',
              t.kind === 'error' && 'border-l-4 border-l-st-absent',
              t.kind === 'info' && 'border-l-4 border-l-brand-600',
            )}
          >
            {t.kind === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-st-present" aria-hidden />
            ) : t.kind === 'error' ? (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-st-absent" aria-hidden />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            )}
            <div className="min-w-0 text-sm">
              <p className="font-medium text-ink">{t.title}</p>
              {t.body && <p className="mt-0.5 text-muted">{t.body}</p>}
            </div>
            <button className="ml-auto text-muted hover:text-ink" onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- Responsive table
export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  sortValue?: (row: T) => string | number | null;
  /** Hide on the mobile card view */
  hideOnCard?: boolean;
  className?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  empty,
  cardTitle,
  onRowClick,
  caption,
  defaultSort,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string;
  empty?: ReactNode;
  cardTitle?: (r: T) => ReactNode;
  onRowClick?: (r: T) => void;
  caption?: string;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
}) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  const sorted = (() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const f = col.sortValue;
    return [...rows].sort((a, b) => {
      const va = f(a);
      const vb = f(b);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? r : -r;
    });
  })();

  if (rows.length === 0) return <>{empty}</>;
  return (
    <>
      <div className="hidden overflow-x-auto md:block print:block" tabIndex={0} role="region" aria-label={caption ?? 'Table'}>
        <table className="table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={clsx(c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 uppercase hover:text-ink"
                        onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))}
                      >
                        {c.header}
                        <span aria-hidden className="text-[9px]">
                          {active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={rowKey(r)}
                className={clsx(onRowClick && 'cursor-pointer')}
                onClick={onRowClick ? (e) => !(e.target as HTMLElement).closest('button,a,input,select') && onRowClick(r) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={clsx(c.align === 'right' && 'text-right num', c.align === 'center' && 'text-center', c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-[#ECEEF2] md:hidden print:hidden">
        {sorted.map((r) => (
          <li key={rowKey(r)} className="px-4 py-3" onClick={onRowClick ? () => onRowClick(r) : undefined}>
            {cardTitle && <div className="mb-2">{cardTitle(r)}</div>}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              {columns
                .filter((c) => !c.hideOnCard)
                .map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-2xs uppercase tracking-wide text-muted">{c.header}</dt>
                    <dd className="truncate">{c.cell(r)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav className="flex items-center justify-between border-t border-line px-4 py-2.5 text-sm" aria-label="Pagination" data-noprint>
      <span className="text-muted">
        {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <dt className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
        {tone && <span className={clsx('inline-block h-2 w-2 rounded-full', tone)} aria-hidden />}
        {label}
      </dt>
      <dd className="num mt-1 text-[26px] font-semibold leading-none text-ink">{value}</dd>
      {sub && <dd className="mt-1 text-xs text-muted">{sub}</dd>}
    </div>
  );
}
