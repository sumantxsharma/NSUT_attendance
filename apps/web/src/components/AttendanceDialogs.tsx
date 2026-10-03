import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { ATTENDANCE_STATUS_LABELS, formatDateLocal, formatDuration, formatTimeLocal, type StoredAttendanceStatus } from '@nsut/shared';
import { DateTime } from 'luxon';
import { api, ApiError } from '../lib/api';
import { useAuth, useTz } from '../lib/auth';
import type { AttRecord, Person } from '../lib/types';
import { StatusBadge } from './Status';
import { Button, Field, FormError, Modal, fieldErrors, useToast } from './ui';
import { usePeopleOptions } from './Filters';

const MANUAL_STATUSES: StoredAttendanceStatus[] = ['PRESENT', 'HALF_DAY', 'ABSENT', 'HOLIDAY'];
const needsTimes = (s: string) => s === 'PRESENT' || s === 'HALF_DAY';

const localHHMM = (iso: string | null, tz: string) => (iso ? DateTime.fromISO(iso).setZone(tz).toFormat('HH:mm') : '');

function invalidateAttendance(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ['daily', 'dashboard', 'monthly', 'person-month', 'corrections', 'my-today']) qc.invalidateQueries({ queryKey: [k] });
}

/** Date → Person → Status → In → Out → Remarks → Confirm */
export function ManualMarkDialog({
  open,
  onOpenChange,
  preset,
  maxDate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  preset?: { date?: string; person?: Pick<Person, 'id' | 'fullName' | 'refId'> };
  maxDate: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const people = usePeopleOptions();
  const [form, setForm] = useState({ date: preset?.date ?? maxDate, personId: preset?.person?.id ?? '', status: 'PRESENT', checkIn: '', checkOut: '', remarks: '' });
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (open) {
      setForm({ date: preset?.date ?? maxDate, personId: preset?.person?.id ?? '', status: 'PRESENT', checkIn: '', checkOut: '', remarks: '' });
      setConfirming(false);
      m.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const m = useMutation({
    mutationFn: () =>
      api.post('/attendance/manual', {
        personId: form.personId,
        date: form.date,
        status: form.status,
        checkIn: needsTimes(form.status) ? form.checkIn || null : null,
        checkOut: needsTimes(form.status) ? form.checkOut || null : null,
        remarks: form.remarks || null,
      }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Attendance recorded', body: 'The entry has been saved and added to the audit log.' });
      invalidateAttendance(qc);
      onOpenChange(false);
    },
    onError: () => setConfirming(false),
  });
  const fe = fieldErrors(m.error);
  const person = (people.data ?? []).find((p) => p.id === form.personId) ?? (preset?.person as Person | undefined);
  const localErr =
    !form.personId ? 'Select a person.' : needsTimes(form.status) && form.checkOut && !form.checkIn ? 'You cannot record an out-time without an in-time.' : form.checkIn && form.checkOut && form.checkOut <= form.checkIn ? 'Out-time must be after in-time.' : null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={confirming ? 'Confirm attendance entry' : 'Mark attendance'}
      description={confirming ? 'Please review before saving. This action is recorded in the audit log.' : 'Record attendance on behalf of a Guest Faculty member or Coach.'}
      footer={
        confirming ? (
          <>
            <Button onClick={() => setConfirming(false)} disabled={m.isPending}>
              Back
            </Button>
            <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
              Save attendance
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" disabled={!!localErr} onClick={() => setConfirming(true)}>
              Review
            </Button>
          </>
        )
      }
    >
      {confirming ? (
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Date</dt>
          <dd className="font-medium">{formatDateLocal(form.date, 'cccc, dd MMM yyyy')}</dd>
          <dt className="text-muted">Person</dt>
          <dd className="font-medium">
            {person?.fullName} <span className="font-mono text-xs text-muted">{person?.refId}</span>
          </dd>
          <dt className="text-muted">Status</dt>
          <dd>
            <StatusBadge status={form.status as StoredAttendanceStatus} />
          </dd>
          {needsTimes(form.status) && (
            <>
              <dt className="text-muted">In / Out</dt>
              <dd className="num">
                {form.checkIn || '—'} – {form.checkOut || '—'}
              </dd>
            </>
          )}
          <dt className="text-muted">Remarks</dt>
          <dd>{form.remarks || '—'}</dd>
          <div className="col-span-2 mt-2">
            <FormError error={m.error} />
          </div>
        </dl>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" required error={fe.date}>
            {(p) => <input {...p} type="date" className="input" max={maxDate} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}
          </Field>
          <Field label="Person" required error={fe.personId}>
            {(p) => (
              <select {...p} className="input" value={form.personId} onChange={(e) => setForm({ ...form, personId: e.target.value })} disabled={!!preset?.person}>
                <option value="">Select…</option>
                {preset?.person && !people.data?.some((x) => x.id === preset.person!.id) && <option value={preset.person.id}>{preset.person.fullName}</option>}
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
          <fieldset className="sm:col-span-2">
            <legend className="label">
              Status <span className="text-st-absent">*</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {MANUAL_STATUSES.map((s) => (
                <label key={s} className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-sm ${form.status === s ? 'border-brand-600 bg-brand-50' : 'border-line'}`}>
                  <input type="radio" name="status" value={s} checked={form.status === s} onChange={() => setForm({ ...form, status: s })} />
                  {ATTENDANCE_STATUS_LABELS[s]}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">Leave is recorded through the Leave module so it carries an approval trail.</p>
          </fieldset>
          {needsTimes(form.status) && (
            <>
              <Field label="In-time" error={fe.checkIn} hint="Institutional time (24-hour)">
                {(p) => <input {...p} type="time" className="input" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />}
              </Field>
              <Field label="Out-time" error={fe.checkOut}>
                {(p) => <input {...p} type="time" className="input" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />}
              </Field>
            </>
          )}
          <Field label="Remarks" className="sm:col-span-2" error={fe.remarks}>
            {(p) => <textarea {...p} rows={2} maxLength={500} className="input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} placeholder="e.g. Entered from physical register" />}
          </Field>
          {localErr && form.personId && <p className="text-sm text-st-absent sm:col-span-2">{localErr}</p>}
          <div className="sm:col-span-2">
            <FormError error={m.error} />
          </div>
        </div>
      )}
    </Modal>
  );
}

export function CorrectionDialog({ open, onOpenChange, record, personName }: { open: boolean; onOpenChange: (o: boolean) => void; record: AttRecord | null; personName: string }) {
  const tz = useTz();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [form, setForm] = useState({ status: 'PRESENT' as StoredAttendanceStatus, checkIn: '', checkOut: '', remarks: '', reason: '' });
  const [delMode, setDelMode] = useState(false);
  useEffect(() => {
    if (open && record) {
      setForm({ status: (record.status === 'NOT_MARKED' ? 'PRESENT' : record.status) as StoredAttendanceStatus, checkIn: localHHMM(record.checkInAt, tz), checkOut: localHHMM(record.checkOutAt, tz), remarks: record.remarks ?? '', reason: '' });
      setDelMode(false);
      m.reset();
      del.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record?.id]);
  const m = useMutation({
    mutationFn: () =>
      api.patch<{ pendingApproval: boolean }>(`/attendance/${record!.id}`, {
        status: form.status,
        checkIn: needsTimes(form.status) ? form.checkIn || null : null,
        checkOut: needsTimes(form.status) ? form.checkOut || null : null,
        remarks: form.remarks || null,
        reason: form.reason,
        version: record!.version,
      }),
    onSuccess: (r) => {
      toast(r.pendingApproval ? { kind: 'info', title: 'Correction submitted for approval', body: 'A Super Admin must approve it before it takes effect.' } : { kind: 'success', title: 'Attendance corrected', body: 'The change and reason are recorded in the audit log.' });
      invalidateAttendance(qc);
      onOpenChange(false);
    },
  });
  const del = useMutation({
    mutationFn: () => api.del(`/attendance/${record!.id}`, { reason: form.reason }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Attendance record deleted', body: 'The deletion is recorded in the audit log.' });
      invalidateAttendance(qc);
      onOpenChange(false);
    },
  });
  if (!record) return null;
  const fe = fieldErrors(m.error);
  const timesAllowed = needsTimes(form.status);
  const prevTimes = record.checkInAt ? `${formatTimeLocal(record.checkInAt, tz)} – ${record.checkOutAt ? formatTimeLocal(record.checkOutAt, tz) : '(no check-out)'}` : 'No times recorded';
  const newTimes = timesAllowed && form.checkIn ? `${fmt12(form.checkIn)} – ${form.checkOut ? fmt12(form.checkOut) : '(no check-out)'}` : 'No times';
  const reasonOk = form.reason.trim().length >= 5;
  const isLeaveSync = record.markingMethod === 'LEAVE_SYNC';

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={delMode ? 'Delete attendance record' : 'Correct attendance'}
      description={`${personName} · ${formatDateLocal(record.date, 'cccc, dd MMM yyyy')}`}
      footer={
        <>
          {can('attendance.delete') && !delMode && !isLeaveSync && (
            <Button variant="ghost" className="mr-auto text-st-absent" onClick={() => setDelMode(true)}>
              Delete record…
            </Button>
          )}
          <Button onClick={() => (delMode ? setDelMode(false) : onOpenChange(false))}>{delMode ? 'Back' : 'Cancel'}</Button>
          {delMode ? (
            <Button variant="danger" disabled={!reasonOk} loading={del.isPending} onClick={() => del.mutate()}>
              Delete permanently
            </Button>
          ) : (
            <Button variant="primary" disabled={!reasonOk} loading={m.isPending} onClick={() => m.mutate()}>
              Save correction
            </Button>
          )}
        </>
      }
    >
      {isLeaveSync && !delMode && (
        <p className="mb-3 rounded border border-[#EFD9A8] bg-st-leaveBg px-3 py-2 text-sm text-st-leave">This day comes from approved leave. To remove it, cancel the leave request instead.</p>
      )}
      {!delMode && (
        <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
          <div className="rounded border border-line bg-[#FAFBFC] p-3">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted">Previous</p>
            <StatusBadge status={record.status} />
            <p className="num mt-2 text-sm">{prevTimes}</p>
            {record.durationMinutes !== null && <p className="text-xs text-muted">Duration {formatDuration(record.durationMinutes)}</p>}
            {record.remarks && <p className="mt-1 text-xs text-muted">“{record.remarks}”</p>}
          </div>
          <ArrowRight className="hidden h-5 w-5 self-center text-muted md:block" aria-hidden />
          <div className="rounded border border-brand-100 bg-brand-50/50 p-3">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-brand-700">Changed to</p>
            <StatusBadge status={form.status} />
            <p className="num mt-2 text-sm">{newTimes}</p>
          </div>
        </div>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {!delMode && (
          <>
            <Field label="Status" error={fe.status}>
              {(p) => (
                <select {...p} className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as StoredAttendanceStatus })}>
                  {(isLeaveSync ? ['LEAVE', ...MANUAL_STATUSES] : MANUAL_STATUSES).map((s) => (
                    <option key={s} value={s}>
                      {ATTENDANCE_STATUS_LABELS[s as StoredAttendanceStatus]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="In-time" error={fe.checkIn}>
              {(p) => <input {...p} type="time" className="input" disabled={!timesAllowed} value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />}
            </Field>
            <Field label="Out-time" error={fe.checkOut}>
              {(p) => <input {...p} type="time" className="input" disabled={!timesAllowed} value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />}
            </Field>
            <Field label="Remarks" className="sm:col-span-3">
              {(p) => <input {...p} className="input" maxLength={500} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />}
            </Field>
          </>
        )}
        <Field label={delMode ? 'Reason for deletion' : 'Reason for correction'} required className="sm:col-span-3" error={fe.reason} hint="Required. Visible in the audit log and the person’s correction history.">
          {(p) => <textarea {...p} rows={2} maxLength={500} className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Biometric terminal failure; times taken from gate register" />}
        </Field>
      </div>
      <div className="mt-3">
        <FormError error={m.error ?? del.error} />
        {m.error instanceof ApiError && m.error.status === 409 && <p className="mt-1 text-xs text-muted">Close this dialog and reopen the record to see the latest values.</p>}
      </div>
    </Modal>
  );
}

function fmt12(hhmm: string) {
  return DateTime.fromFormat(hhmm, 'HH:mm').toFormat('hh:mm a');
}
