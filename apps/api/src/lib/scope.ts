import type { Request } from 'express';
import { one } from '../db/pool';
import { forbidden, notFound } from './errors';
import type { Params } from './sql';

/**
 * Row-level visibility of people for the current user.
 * - SUPER_ADMIN / OFFICER: everyone
 * - COORDINATOR: people in assigned departments or activities
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
      const { departmentIds, activityIds } = auth.scope;
      if (departmentIds.length === 0 && activityIds.length === 0) return 'FALSE';
      return `(${alias}.department_id = ANY(${p.add(departmentIds)}::uuid[]) OR ${alias}.activity_id = ANY(${p.add(activityIds)}::uuid[]))`;
    }
    case 'STAFF':
    default:
      return auth.user.personId ? `${alias}.id = ${p.add(auth.user.personId)}` : 'FALSE';
  }
}

/** Throws 404 if the person doesn't exist, 403 if outside the caller's scope. */
export async function assertPersonVisible(req: Request, personId: string) {
  const person = await one<{ id: string; department_id: string | null; activity_id: string | null }>(
    'SELECT id, department_id, activity_id FROM people WHERE id = $1 AND deleted_at IS NULL',
    [personId],
  );
  if (!person) throw notFound('Person');
  const auth = req.auth!;
  if (auth.user.role === 'SUPER_ADMIN' || auth.user.role === 'OFFICER') return person;
  if (auth.user.role === 'STAFF') {
    if (auth.user.personId !== personId) throw forbidden();
    return person;
  }
  const ok =
    (person.department_id && auth.scope.departmentIds.includes(person.department_id)) ||
    (person.activity_id && auth.scope.activityIds.includes(person.activity_id));
  if (!ok) throw forbidden('You do not have access to this department or activity.');
  return person;
}
