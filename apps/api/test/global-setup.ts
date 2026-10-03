export default async function setup() {
  process.env.NODE_ENV = 'test';
  const { migrate } = await import('../src/db/migrate');
  const { pool } = await import('../src/db/pool');
  await migrate({ reset: true, log: false });
  await pool.end();
}
