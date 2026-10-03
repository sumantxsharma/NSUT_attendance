import type { Request } from 'express';
import type { AuditAction } from '@nsut/shared';
import { config } from '../config';
import { pool, type Queryable } from '../db/pool';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  userId?: string | null;
  userName?: string | null;
}

/** Strip secrets before persisting snapshots. */
function scrub(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(scrub);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (/password|token|secret|csrf/i.test(k)) continue;
    out[k] = val instanceof Date ? val.toISOString() : scrub(val);
  }
  return out;
}

export function clientMeta(req?: Request): { ip: string | null; ua: string | null } {
  if (!req || !config.recordClientMeta) return { ip: null, ua: null };
  const ip = (req.ip ?? '').replace(/^::ffff:/, '') || null;
  return { ip, ua: (req.get('user-agent') ?? '').slice(0, 300) || null };
}

/**
 * Append an audit entry. Pass the transaction client so the audit row commits
 * or rolls back together with the change it describes.
 */
export async function audit(entry: AuditEntry, req?: Request, client: Queryable = pool): Promise<void> {
  const meta = clientMeta(req);
  const actor = req?.auth?.user;
  await client.query(
    `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, summary, old_value, new_value, reason, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      entry.userId ?? actor?.id ?? null,
      entry.userName ?? actor?.name ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.summary ?? null,
      entry.oldValue === undefined ? null : JSON.stringify(scrub(entry.oldValue)),
      entry.newValue === undefined ? null : JSON.stringify(scrub(entry.newValue)),
      entry.reason ?? null,
      meta.ip,
      meta.ua,
    ],
  );
}
