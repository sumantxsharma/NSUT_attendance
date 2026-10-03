import type { Request } from 'express';
import { one } from '../db/pool';
import { forbidden, notFound } from './errors';
import type { Params } from './sql';

/**
 * Row-level visibility of people for the current user.
 * - SUPER_ADMIN / OFFICER: everyone
 * - COORDINATOR: people in assigned sports / activities
 * - STAFF: only their own profile
 * Returns a SQL predicate on the given people alias.
 */
export function peopleScopeSql(req: Request, p: Params, alias = 'p'): string {
  const auth = req.auth!;
  switch (auth.user.role) {
    case 'SUPER_ADMIN':
    case 'OFFICER':
      return 'TRUE';
    case 'COORDINATOR': {
      const { activityIds } = auth.scope;
      if (activityIds.length === 0) return 'FALSE';
      return `${alias}.activity_id = ANY(${p.add(activityIds)}::uuid[])`;
    }
    case 'STAFF':
    default:
      return auth.user.personId ? `${alias}.id = ${p.add(auth.user.personId)}` : 'FALSE';
  }
}

/** Throws 404 if the person doesn't exist, 403 if outside the caller's scope. */
export async function assertPersonVisible(req: Request, personId: string) {
  const person = await one<{ id: string; activity_id: string | null }>(
    'SELECT id, activity_id FROM people WHERE id = $1 AND deleted_at IS NULL',
    [personId],
  );
  if (!person) throw notFound('Person');
  const auth = req.auth!;
  if (auth.user.role === 'SUPER_ADMIN' || auth.user.role === 'OFFICER') return person;
  if (auth.user.role === 'STAFF') {
    if (auth.user.personId !== personId) throw forbidden();
    return person;
  }
  if (!person.activity_id || !auth.scope.activityIds.includes(person.activity_id)) throw forbidden('You do not have access to this sport / activity.');
  return person;
}
