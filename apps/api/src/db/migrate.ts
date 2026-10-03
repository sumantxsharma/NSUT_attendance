import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { pool } from './pool';

/**
 * Minimal, dependency-free migration runner.
 * - Applies database/migrations/*.sql in lexical order, each in its own transaction.
 * - Records applied files + checksum in schema_migrations; refuses to run if an applied file changed.
 * - `--reset` drops and recreates the public schema (refused in production).
 */
export async function migrate({ reset = false, log = true } = {}): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    if (reset) {
      if (config.isProd && process.env.ALLOW_PROD_RESET !== 'yes') throw new Error('Refusing to reset a production database.');
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      if (log) console.log('• schema reset');
    }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Map((await client.query('SELECT name, checksum FROM schema_migrations')).rows.map((r) => [r.name, r.checksum]));
    const files = fs.readdirSync(config.migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    const { createHash } = await import('node:crypto');
    for (const file of files) {
      const sql = fs.readFileSync(path.join(config.migrationsDir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (done.has(file)) {
        if (done.get(file) !== checksum) throw new Error(`Migration ${file} was modified after being applied. Create a new migration instead.`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        applied.push(file);
        if (log) console.log(`• applied ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
    }
    if (log && applied.length === 0) console.log('• database is up to date');
    return applied;
  } finally {
    client.release();
  }
}

// Match the script filename, not import.meta.url: after bundling every module shares the server's URL.
if (/[\\/]migrate\.(ts|js)$/.test(process.argv[1] ?? '')) {
  migrate({ reset: process.argv.includes('--reset') })
    .then(() => pool.end())
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
