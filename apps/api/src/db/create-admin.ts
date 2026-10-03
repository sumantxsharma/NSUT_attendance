/**
 * Bootstrap the first Super Admin on an empty (production) database.
 *   ADMIN_EMAIL=registrar.it@nsut.ac.in ADMIN_NAME="System Administrator" ADMIN_PASSWORD='…' npm run create-admin -w @nsut/api
 *   (in Docker)  docker compose exec -e ADMIN_EMAIL=… -e ADMIN_NAME=… -e ADMIN_PASSWORD=… app node apps/api/dist/db/create-admin.js
 * Refuses to run if an active Super Admin already exists (use the Users screen instead).
 */
import bcrypt from 'bcryptjs';
import { passwordPolicy } from '@nsut/shared';
import { pool, tx } from './pool';

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const name = (process.env.ADMIN_NAME ?? 'System Administrator').trim();
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Set ADMIN_EMAIL to a valid email address.');
  const pw = passwordPolicy.safeParse(password);
  if (!pw.success) throw new Error(`ADMIN_PASSWORD: ${pw.error.issues[0].message}`);
  const existing = await pool.query(`SELECT count(*)::int AS n FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' AND deleted_at IS NULL`);
  if (existing.rows[0].n > 0 && process.env.FORCE !== 'yes') throw new Error('An active Super Admin already exists. Create further accounts from Administration → Users.');
  const hash = await bcrypt.hash(password, 12);
  await tx(async (c) => {
    const r = await c.query(`INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'SUPER_ADMIN') RETURNING id`, [name, email, hash]);
    await c.query(`INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, summary) VALUES ($1::uuid,'System (bootstrap)','USER_CREATE','user',$1::text,$2)`, [
      r.rows[0].id,
      `Bootstrapped Super Admin ${email}`,
    ]);
  });
  console.log(`• Super Admin created: ${email}`);
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
