import { pool, query, type Queryable } from '../db/pool';
import { logger } from './logger';

/**
 * Notification service.
 * V1 delivers in-app notifications. Email / SMS / WhatsApp are written to
 * `notification_outbox` by `enqueueExternal`, so a future worker can deliver them
 * without touching business logic. See ARCHITECTURE.md → Notifications.
 */
export type NotificationType =
  | 'LEAVE_SUBMITTED'
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'LEAVE_CANCELLED'
  | 'ATTENDANCE_MISSING'
  | 'LATE_ARRIVAL'
  | 'ATTENDANCE_CORRECTED'
  | 'CORRECTION_PENDING'
  | 'CONTRACT_EXPIRING'
  | 'PASSWORD_RESET';

export interface NotifyInput {
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}

export async function notify(input: NotifyInput, client: Queryable = pool): Promise<void> {
  const ids = [...new Set(input.userIds)].filter(Boolean);
  if (ids.length === 0) return;
  await client.query(
    `INSERT INTO notifications (user_id, type, title, body, link)
     SELECT unnest($1::uuid[]), $2, $3, $4, $5`,
    [ids, input.type, input.title, input.body ?? null, input.link ?? null],
  );
}

/** Queue an external message for a future delivery worker (email/SMS/WhatsApp). */
export async function enqueueExternal(
  channel: 'email' | 'sms' | 'whatsapp',
  recipient: string,
  subject: string | null,
  body: string,
  client: Queryable = pool,
): Promise<void> {
  await client.query('INSERT INTO notification_outbox (channel, recipient, subject, body) VALUES ($1,$2,$3,$4)', [channel, recipient, subject, body]);
  logger.info({ channel, recipient: recipient.replace(/(.{2}).*(@.*)/, '$1***$2'), subject }, 'external notification queued');
}

/** Users who should review items for a person: super admins, officers, and coordinators whose scope covers the person. */
export async function reviewersFor(personId: string, client: Queryable = pool): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT DISTINCT u.id FROM users u
     LEFT JOIN user_scopes s ON s.user_id = u.id
     JOIN people p ON p.id = $1
     WHERE u.status = 'ACTIVE' AND u.deleted_at IS NULL AND (
       u.role IN ('SUPER_ADMIN', 'OFFICER') OR
       (u.role = 'COORDINATOR' AND s.activity_id = p.activity_id)
     )`,
    [personId],
    client,
  );
  return rows.map((r) => r.id);
}

export async function userIdForPerson(personId: string, client: Queryable = pool): Promise<string | null> {
  const rows = await query<{ id: string }>(`SELECT id FROM users WHERE person_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`, [personId], client);
  return rows[0]?.id ?? null;
}

export async function superAdminIds(client: Queryable = pool): Promise<string[]> {
  const rows = await query<{ id: string }>(`SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' AND deleted_at IS NULL`, [], client);
  return rows.map((r) => r.id);
}
