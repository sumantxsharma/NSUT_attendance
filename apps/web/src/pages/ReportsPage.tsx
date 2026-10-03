import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import clsx from 'clsx';
import { Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { APP_NAME, REPORT_LABELS, REPORT_TYPES, type ReportType } from '@nsut/shared';
import { api, download } from '../lib/api';
import { useAuth, usePublicSettings, useTz } from '../lib/auth';
import { nowParts } from '../lib/format';
import { useUrlState } from '../lib/hooks';
import type { ReportData } from '../lib/types';
import { FilterBar, MonthPicker, type FilterValues } from '../components/Filters';
import { Button, EmptyState, ErrorState, PageHeader, TableSkeleton, useToast } from '../components/ui';

const DESCRIPTIONS: Record<ReportType, string> = {
  daily: 'Everyone’s status, in/out time and duration for one date.',
  monthly: 'Working days, present, absent, leave, half days and attendance % per person.',
  individual: 'Day-by-day attendance for one person for a month.',
  activity: 'Guest Faculty and coach attendance aggregated by sport / activity.',
  absence: 'Working days recorded absent or left unmarked.',
  leave: 'Leave requests in a period, with status and reviewer.',
  late: 'Check-ins after office start + grace period.',
  early: 'Check-outs before office end − grace period.',
  incomplete: 'Past days with a check-in but no check-out.',
};

type Mode = 'date' | 'month' | 'range';
const MODE: Record<ReportType, Mode> = { daily: 'date', monthly: 'month', individual: 'month', activity: 'month', absence: 'range', leave: 'range', late: 'range', early: 'range', incomplete: 'range' };

export function ReportsIndexPage() {
  return (
    <div>
      <PageHeader eyebrow="Reports" title="Reports" subtitle="Generate, print or export official attendance reports (CSV, Excel, PDF)." />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORT_TYPES.map((t) => (
          <li key={t}>
            <Link to={`/reports/${t}`} className="panel flex h-full items-start gap-3 p-4 text-inherit no-underline hover:border-brand-600">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
              <span>
                <span className="block font-semibold text-ink">{REPORT_LABELS[t]}</span>
                <span className="mt-0.5 block text-sm text-muted">{DESCRIPTIONS[t]}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReportPage() {
  const { type = 'daily' } = useParams();
  const rtype = (REPORT_TYPES as readonly string[]).includes(type) ? (type as ReportType) : 'daily';
  const tz = useTz();
  const now = nowParts(tz);
  const toast = useToast();
  const { can } = useAuth();
  const settings = usePublicSettings();
  const [f, setF] = useUrlState<Record<string, string | undefined>>({});
  const mode = MODE[rtype];
  const monthStart = DateTime.fromObject({ year: now.year, month: now.month, day: 1 }).toISODate()!;
  const params: Record<string, string | undefined> = {
    type: f.type,
    activityId: f.activityId,
    personId: f.personId,
    status: f.status,
    q: f.q,
    ...(mode === 'date' ? { date: f.date ?? now.date } : {}),
    ...(mode === 'month' ? { year: f.year ?? String(now.year), month: f.month ?? String(now.month) } : {}),
    ...(mode === 'range' ? { from: f.from ?? monthStart, to: f.to ?? (rtype === 'leave' ? DateTime.fromISO(now.date).endOf('month').toISODate()! : now.date) } : {}),
  };
  const needsPerson = rtype === 'individual' && !params.personId;
  const q = useQuery({ queryKey: ['report', rtype, params], queryFn: () => api.get<ReportData>(`/reports/${rtype}`, params), enabled: !needsPerson });
  const [busy, setBusy] = useState<string | null>(null);
  const exportAs = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setBusy(format);
    try {
      await download(`/reports/${rtype}`, { ...params, format });
      toast({ kind: 'success', title: `${format.toUpperCase()} downloaded` });
    } catch (e) {
      toast({ kind: 'error', title: 'Unable to generate report. Please try again.', body: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const r = q.data;
  const filterShow: ('q' | 'type' | 'activity' | 'status' | 'person')[] =
    rtype === 'individual' ? ['type', 'person'] : rtype === 'activity' ? ['type', 'activity'] : rtype === 'daily' ? ['type', 'activity', 'status'] : rtype === 'leave' ? ['type', 'activity', 'person', 'status'] : ['type', 'activity', 'person'];
  const statusOptions = rtype === 'leave' ? ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() })) : undefined;

  return (
    <div>
      <div data-noprint>
        <PageHeader
          eyebrow="Reports"
          title={REPORT_LABELS[rtype]}
          subtitle={DESCRIPTIONS[rtype]}
          actions={
            <>
              <Link to="/reports" className="btn-ghost no-underline">
                All reports
              </Link>
              <Button onClick={() => window.print()} disabled={!r}>
                <Printer className="h-4 w-4" /> Print
              </Button>
              {can('reports.export') && (
                <>
                  <Button onClick={() => exportAs('csv')} loading={busy === 'csv'} disabled={!r || !!busy}>
                    <Download className="h-4 w-4" /> CSV
                  </Button>
                  <Button onClick={() => exportAs('xlsx')} loading={busy === 'xlsx'} disabled={!r || !!busy}>
                    <FileSpreadsheet className="h-4 w-4" /> Excel
                  </Button>
                  <Button variant="primary" onClick={() => exportAs('pdf')} loading={busy === 'pdf'} disabled={!r || !!busy}>
                    <FileText className="h-4 w-4" /> PDF
                  </Button>
                </>
              )}
            </>
          }
        />
        <div className="panel mb-4 px-4 py-3">
          <FilterBar value={f as FilterValues} onChange={(v) => setF({ ...(v as any), date: f.date, year: f.year, month: f.month, from: f.from, to: f.to }, true)} show={filterShow} statusOptions={statusOptions}>
            {mode === 'date' && (
              <label>
                <span className="sr-only">Date</span>
                <input type="date" className="input w-auto" max={now.date} value={params.date} onChange={(e) => setF({ date: e.target.value })} />
              </label>
            )}
            {mode === 'month' && <MonthPicker year={Number(params.year)} month={Number(params.month)} onChange={(y, m) => setF({ year: String(y), month: String(m) })} max={now} />}
            {mode === 'range' && (
              <>
                <label className="flex items-center gap-1 text-sm">
                  <span className="text-muted">From</span>
                  <input type="date" className="input w-auto" value={params.from} onChange={(e) => setF({ from: e.target.value })} />
                </label>
                <label className="flex items-center gap-1 text-sm">
                  <span className="text-muted">To</span>
                  <input type="date" className="input w-auto" value={params.to} max={rtype === 'leave' ? undefined : now.date} onChange={(e) => setF({ to: e.target.value })} />
                </label>
              </>
            )}
          </FilterBar>
        </div>
      </div>

      <article className="panel" aria-label="Report preview">
        {needsPerson ? (
          <EmptyState title="Select a person to generate the individual report." />
        ) : q.isLoading ? (
          <div role="status" aria-live="polite">
            <p className="px-5 pt-4 text-sm text-muted">Generating report…</p>
            <TableSkeleton rows={8} cols={6} />
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          r && (
            <div className="p-5 print:p-0">
              {/* Letterhead (screen + print) */}
              <header className="mb-4 flex items-start gap-4 border-b-2 border-ink pb-3">
                {settings.data?.hasLogo ? (
                  <img src={`/api/settings/logo?v=${settings.data.logoVersion}`} alt="University logo" className="h-14 w-14 object-contain" />
                ) : (
                  <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center border border-dashed border-line text-[9px] uppercase tracking-wider text-muted" aria-label="Logo placeholder">
                    Logo
                  </span>
                )}
                <div>
                  <p className="text-lg font-semibold text-ink">{r.meta.university}</p>
                  {r.meta.unit && <p className="text-sm text-muted">{r.meta.unit}</p>}
                  <p className="text-sm font-semibold text-ink">Guest Faculty &amp; Sports Coach Attendance Report</p>
                </div>
              </header>
              <div className="mb-4 flex flex-wrap justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{r.title}</h2>
                  <p className="text-sm">{r.period}</p>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  {r.filters.map((x) => (
                    <div key={x.label} className="contents">
                      <dt className="font-semibold text-ink">{x.label}</dt>
                      <dd className="text-muted">{x.value}</dd>
                    </div>
                  ))}
                  <dt className="font-semibold text-ink">Generated</dt>
                  <dd className="text-muted">{r.meta.generatedAt}</dd>
                  <dt className="font-semibold text-ink">Generated by</dt>
                  <dd className="text-muted">{r.meta.generatedBy}</dd>
                </dl>
              </div>
              {r.rows.length === 0 ? (
                <EmptyState title="No records found for the selected filters." />
              ) : (
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Report table">
                  <table className="table">
                    <thead>
                      <tr>
                        {r.columns.map((c) => (
                          <th key={c.key} scope="col" className={clsx(c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.rows.map((row, i) => (
                        <tr key={i}>
                          {r.columns.map((c) => (
                            <td key={c.key} className={clsx('text-[13px]', ['refId', 'date', 'in', 'out', 'from', 'to', 'type'].includes(c.key) && 'whitespace-nowrap', c.align === 'right' && 'num text-right', c.align === 'center' && 'num text-center')}>
                              {row[c.key] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <section className="mt-5 grid gap-5 break-inside-avoid md:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-sm font-semibold">Summary</h3>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
                    {r.summary.map((s) => (
                      <div key={s.label} className="contents">
                        <dt className="text-muted">{s.label}</dt>
                        <dd className="num font-medium">{s.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                {r.notes.length > 0 && (
                  <div>
                    <h3 className="mb-1 text-sm font-semibold">Calculation notes</h3>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">
                      {r.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
              <div className="mt-12 hidden justify-end print:flex">
                <div className="w-56 border-t border-muted pt-1 text-center text-xs text-muted">Signature of Authorized Officer</div>
              </div>
              <footer className="mt-6 border-t border-line pt-2 text-2xs text-muted">
                {APP_NAME} — {r.meta.footer}
              </footer>
            </div>
          )
        )}
      </article>
    </div>
  );
}
