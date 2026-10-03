import { BUILD_VERSION } from '@nsut/shared';
import { createApp } from './app';
import { config } from './config';
import { migrate } from './db/migrate';
import { pool } from './db/pool';
import { logger } from './lib/logger';

async function main() {
  if (process.env.MIGRATE_ON_START === 'true') await migrate({ log: true });
  const app = createApp();
  const server = app.listen(config.port, () => logger.info({ port: config.port, env: config.env, version: BUILD_VERSION }, 'NSUT Attendance API listening'));
  const shutdown = (sig: string) => {
    logger.info({ sig }, 'shutting down');
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((e) => {
  logger.fatal({ err: e }, 'failed to start');
  process.exit(1);
});
