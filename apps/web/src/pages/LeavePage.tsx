import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import clsx from 'clsx';
import { CalendarOff, CheckCircle2, Clock3, FileText, Plus, XCircle } from 'lucide-react';
import { LEAVE_TYPE_LABELS, LEAVE_TYPES, formatDateTimeLocal, type LeaveStatus } from '@nsut/shared';
import { api } from '../lib/api';
import { useAuth, useTz } from '../lib/auth';
import { nowParts, unitName } from '../lib/format';
import { useUrlState } from '../lib/hooks';
import type { Leave } from '../lib/types';
import { FilterBar, usePeopleOptions, type FilterValues } from '../components/Filters';
import { PanelBox } from '../components/Layout';
import { Button, DataTable, EmptyState, ErrorState, Field, FormError, Modal, PageHeader, TableSkeleton, fieldErrors, useToast } from '../components/ui';

export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  const map = {
    PENDING: ['bg-st-leaveBg text-st-leave border-[#EFD9A8]', Clock3, 'Pending'],
    APPROVED: ['bg-st-presentBg text-st-present border-[#BFDFCB]', CheckCircle2, 'Approved'],
    REJECTED: ['bg-st-absentBg text-st-absent border-[#F1C5C2]', XCircle, 'Rejected'],
    CANCELLED: ['bg-st-noneBg text-st-none border-[#D6DAE0]', CalendarOff, 'Cancelled'],
  } as const;
  const [cls, Icon, label] = map[status];
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium', cls)}>
      <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
    </span>
  );
}

const range = (l: Leave) =>
  l.fromDate === l.toDate ? DateTime.fromISO(l.fromDate).toFormat('ccc, dd MMM yyyy') : `${DateTime.fromISO(l.fromDate).toFormat('dd MMM')} – ${DateTime.fromISO(l.toDate).toFormat('dd MMM yyyy')}`;

export function LeavePage() {
  const { can, me } = useAuth();
  const tz = useTz();
  const qc = useQueryClient();
  const toast = useToast();
  const reviewer = can('leave.review');
  const [f, setF] = useUrlState<{ status?: string; q?: string; type?: string; activityId?: string }>({});
  const q = useQuery({ queryKey: ['leave', f], queryFn: () => api.get<Leave[]>('/leave', { status: f.status, q: f.q, type: f.type, activityId: f.activityId }) });
  const [applyOpen, setApplyOpen] = useState(false);
  const [review, setReview] = useState<{ leave: Leave; mode: 'approve' | 'reject' | 'cancel' | 'view' } | null>(null);
  const [remarks, setRemarks] = useState('');
  const act = useMutation({
    mutationFn: () => api.patch(`/leave/${review!.leave.id}/${review!.mode}`, { remarks: remarks || null }),
    onSuccess: (r: any) => {
      const mode = review!.mode;
      const skipped = r?.sync?.skipped?.filter((s: any) => s.reason.startsWith('Attendance')).length ?? 0;
      toast({
        kind: 'success',
        title: mode === 'approve' ? 'Leave approved' : mode === 'reject' ? 'Leave rejected' : 'Leave cancelled',
        body:
          mode === 'approve'
            ? `${r?.sync?.applied?.length ?? 0} working day(s) marked as leave in attendance.${skipped ? ` ${skipped} day(s) already had attendance and were left unchanged.` : ''}`
            : mode === 'cancel'
              ? 'Any attendance created from this leave has been reverted.'
              : undefined,
      });
      setReview(null);
      for (const k of ['leave', 'dashboard', 'daily', 'monthly', 'person-month', 'my-today']) qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const rows = q.data ?? [];
  const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 } as Record<LeaveStatus, number>;
  const title = reviewer ? (f.status === 'APPROVED' ? 'Approved Leave' : f.status === 'REJECTED' ? 'Rejected Leave' : f.status === 'PENDING' ? 'Leave Requests' : 'All Leave') : 'My Leave';
  rows.forEach((l) => counts[l.status]++);

  return (
    <div>
      <PageHeader
        eyebrow="Leave"
        title={title}
        subtitle={reviewer ? 'Approved leave is reflected in attendance automatically.' : 'Submit leave requests and track their status.'}
        actions={
          <Button variant="primary" onClick={() => setApplyOpen(true)}>
            <Plus className="h-4 w-4" /> {reviewer ? 'Record leave' : 'Apply for leave'}
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Leave status">
        {[
          ['', 'All'],
          ['PENDING', 'Pending'],
          ['APPROVED', 'Approved'],
          ['REJECTED', 'Rejected'],
          ['CANCELLED', 'Cancelled'],
        ].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={(f.status ?? '') === k} className={clsx('btn btn-sm', (f.status ?? '') === k ? 'border-ink-700 bg-ink-700 text-white' : 'border-line bg-white')} onClick={() => setF({ status: k || undefined })}>
            {l}
          </button>
        ))}
      </div>
      <PanelBox>
        {reviewer && (
          <div className="border-b border-line px-4 py-3">
            <FilterBar value={f as FilterValues} onChange={(v) => setF({ ...(v as any), status: f.status }, true)} show={['q', 'type', 'activity']} />
          </div>
        )}
        {q.isLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={rows}
            rowKey={(l) => l.id}
            caption="Leave requests"
            empty={<EmptyState icon={<CalendarOff className="h-8 w-8" />} title={f.status === 'PENDING' ? 'No pending leave requests.' : 'No leave requests found.'} />}
            cardTitle={(l) => (
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{reviewer ? l.personName : range(l)}</span>
                <LeaveStatusBadge status={l.status} />
              </div>
            )}
            columns={[
              ...(reviewer
                ? [
                    {
                      key: 'person',
                      header: 'Person',
                      hideOnCard: true,
                      sortValue: (l: Leave) => l.personName,
                      cell: (l: Leave) => (
                        <div>
                          <Link to={`/people/${l.personId}`} className="font-medium text-ink">
                            {l.personName}
                          </Link>
                          <p className="text-xs text-muted">{unitName(l)}</p>
                        </div>
                      ),
                    },
                  ]
                : []),
              { key: 'range', header: 'Period', sortValue: (l) => l.fromDate, cell: (l) => <span className="whitespace-nowrap">{range(l)}</span> },
              { key: 'days', header: 'Days', align: 'right', sortValue: (l) => l.days, cell: (l) => l.days },
              { key: 'type', header: 'Type', cell: (l) => LEAVE_TYPE_LABELS[l.leaveType] },
              {
                key: 'reason',
                header: 'Reason',
                cell: (l) => (
                  <span className="line-clamp-2 max-w-[260px] text-[13px]">
                    {l.reason}
                    {l.hasDocument && (
                      <a href={`/api/leave/${l.id}/document`} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-xs">
                        <FileText className="h-3 w-3" aria-hidden /> document
                      </a>
                    )}
                  </span>
                ),
              },
              { key: 'sub', header: 'Submitted', sortValue: (l) => l.submittedAt, cell: (l) => <span className="num text-xs text-muted">{formatDateTimeLocal(l.submittedAt, tz)}</span> },
              { key: 'status', header: 'Status', hideOnCard: true, sortValue: (l) => l.status, cell: (l) => <LeaveStatusBadge status={l.status} /> },
              {
                key: 'act',
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                cell: (l) => {
                  const own = me?.personId === l.personId;
                  return (
                    <div className="flex justify-end gap-1">
                      {reviewer && l.status === 'PENDING' && !own && (
                        <>
                          <Button size="sm" variant="primary" onClick={() => { setRemarks(''); setReview({ leave: l, mode: 'approve' }); }}>
                            Approve
                          </Button>
                          <Button size="sm" onClick={() => { setRemarks(''); setReview({ leave: l, mode: 'reject' }); }}>
                            Reject
                          </Button>
                        </>
                      )}
                      {((l.status === 'PENDING' && own) || (reviewer && l.status === 'APPROVED')) && (
                        <Button size="sm" variant="ghost" onClick={() => { setRemarks(''); setReview({ leave: l, mode: 'cancel' }); }}>
                          Cancel
                        </Button>
                      )}
                      {l.status !== 'PENDING' && (
                        <Button size="sm" variant="ghost" onClick={() => setReview({ leave: l, mode: 'view' })}>
                          Details
                        </Button>
                      )}
                    </div>
                  );
                },
              },
            ]}
          />
        )}
      </PanelBox>

      <ApplyLeaveDialog open={applyOpen} onOpenChange={setApplyOpen} forOthers={reviewer} />

      <Modal
        open={!!review}
        onOpenChange={(o) => !o && setReview(null)}
        title={review ? { approve: 'Approve leave', reject: 'Reject leave', cancel: 'Cancel leave', view: 'Leave details' }[review.mode] : ''}
        description={review && `${review.leave.personName} · ${range(review.leave)} (${review.leave.days} day${review.leave.days > 1 ? 's' : ''})`}
        footer={
          review && review.mode !== 'view' ? (
            <>
              <Button onClick={() => setReview(null)}>Back</Button>
              <Button variant={review.mode === 'approve' ? 'primary' : 'danger'} loading={act.isPending} disabled={review.mode === 'reject' && remarks.trim().length < 3} onClick={() => act.mutate()}>
                {review.mode === 'approve' ? 'Approve' : review.mode === 'reject' ? 'Reject' : 'Cancel leave'}
              </Button>
            </>
          ) : (
            <Button onClick={() => setReview(null)}>Close</Button>
          )
        }
      >
        {review && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[120px_1fr] gap-y-1.5">
              <dt className="text-muted">Type</dt>
              <dd>{LEAVE_TYPE_LABELS[review.leave.leaveType]}</dd>
              <dt className="text-muted">Reason</dt>
              <dd>{review.leave.reason}</dd>
              <dt className="text-muted">Status</dt>
              <dd>
                <LeaveStatusBadge status={review.leave.status} />
              </dd>
              {review.leave.reviewedBy && (
                <>
                  <dt className="text-muted">Reviewed</dt>
                  <dd>
                    {review.leave.reviewedBy} · {formatDateTimeLocal(review.leave.reviewedAt, tz)}
                  </dd>
                  <dt className="text-muted">Remarks</dt>
                  <dd>{review.leave.reviewerRemarks ?? '—'}</dd>
                </>
              )}
            </dl>
            {review.mode === 'approve' && <p className="rounded bg-brand-50 px-3 py-2 text-xs text-brand-800">Working days in this period will be marked as “On Leave” in attendance. Days already recorded as present are left unchanged.</p>}
            {review.mode === 'cancel' && review.leave.status === 'APPROVED' && <p className="rounded bg-st-leaveBg px-3 py-2 text-xs text-st-leave">Attendance days created from this leave will return to “Not Marked”.</p>}
            {review.mode !== 'view' && (
              <Field label={review.mode === 'reject' ? 'Reason for rejection' : 'Remarks (optional)'} required={review.mode === 'reject'}>
                {(p) => <textarea {...p} rows={2} className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={1000} />}
              </Field>
            )}
            <FormError error={act.error} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function ApplyLeaveDialog({ open, onOpenChange, forOthers }: { open: boolean; onOpenChange: (o: boolean) => void; forOthers: boolean }) {
  const tz = useTz();
  const today = nowParts(tz).date;
  const qc = useQueryClient();
  const toast = useToast();
  const people = usePeopleOptions();
  const [form, setForm] = useState({ personId: '', fromDate: today, toDate: today, leaveType: 'CASUAL', reason: '' });
  const [file, setFile] = useState<File | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => v && fd.append(k, v));
      if (file) fd.append('document', file);
      return api.upload('/leave', fd);
    },
    onSuccess: () => {
      toast({ kind: 'success', title: 'Leave request submitted', body: forOthers ? 'It is now pending review.' : 'You will be notified when it is reviewed.' });
      qc.invalidateQueries({ queryKey: ['leave'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onOpenChange(false);
      setForm({ personId: '', fromDate: today, toDate: today, leaveType: 'CASUAL', reason: '' });
      setFile(null);
    },
  });
  const fe = fieldErrors(m.error);
  const days = form.fromDate && form.toDate && form.toDate >= form.fromDate ? DateTime.fromISO(form.toDate).diff(DateTime.fromISO(form.fromDate), 'days').days + 1 : 0;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={forOthers ? 'Record leave request' : 'Apply for leave'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={days < 1 || form.reason.trim().length < 5 || (forOthers && !form.personId)} onClick={() => m.mutate()}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {forOthers && (
          <Field label="Person" required className="sm:col-span-2" error={fe.personId}>
            {(p) => (
              <select {...p} className="input" value={form.personId} onChange={(e) => setForm({ ...form, personId: e.target.value })}>
                <option value="">Select…</option>
                {(people.data ?? [])
                  .filter((x) => x.status === 'ACTIVE')
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.fullName} ({x.refId})
                    </option>
                  ))}
              </select>
            )}
          </Field>
        )}
        <Field label="From date" required error={fe.fromDate}>
          {(p) => <input {...p} type="date" className="input" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value, toDate: form.toDate < e.target.value ? e.target.value : form.toDate })} />}
        </Field>
        <Field label="To date" required error={fe.toDate} hint={days > 0 ? `${days} calendar day${days > 1 ? 's' : ''}` : 'Must be on or after the from date'}>
          {(p) => <input {...p} type="date" className="input" min={form.fromDate} value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} />}
        </Field>
        <Field label="Leave type" required>
          {(p) => (
            <select {...p} className="input" value={form.leaveType} onChange={(e) => setForm({ ...form, leaveType: e.target.value })}>
              {LEAVE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {LEAVE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Supporting document" hint="Optional. PDF, PNG or JPEG, up to 5 MB.">
          {(p) => <input {...p} type="file" accept="application/pdf,image/png,image/jpeg" className="block w-full text-sm file:mr-3 file:rounded file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
        </Field>
        <Field label="Reason" required className="sm:col-span-2" error={fe.reason}>
          {(p) => <textarea {...p} rows={3} maxLength={1000} className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
        </Field>
        <div className="sm:col-span-2">
          <FormError error={m.error} />
        </div>
      </div>
    </Modal>
  );
}
