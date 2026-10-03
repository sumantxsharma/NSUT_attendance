import pg from 'pg';
import { config } from '../config';

// Return DATE columns as plain 'yyyy-MM-dd' strings (never shift through JS Date/timezones).
pg.types.setTypeParser(1082, (v: string) => v);
// NUMERIC -> number
pg.types.setTypeParser(1700, (v: string) => (v === null ? null : Number(v)));
// BIGINT (counts, bigserial) -> number (safe for our volumes)
pg.types.setTypeParser(20, (v: string) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
});

export type Queryable = Pick<pg.PoolClient, 'query'>;

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], client: Queryable = pool): Promise<T[]> {
  const res = await client.query<T>(text, params as any[]);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], client: Queryable = pool): Promise<T | null> {
  const rows = await query<T>(text, params, client);
  return rows[0] ?? null;
}

/** Run `fn` in a transaction; rolls back on any thrown error. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
