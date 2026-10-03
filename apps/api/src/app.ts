import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { BUILD_VERSION } from '@nsut/shared';
import { config } from './config';
import { pool } from './db/pool';
import { errorHandler, notFound } from './lib/errors';
import { logger } from './lib/logger';
import { csrfProtection, requireAuth, sessionMiddleware } from './middleware/auth';
import { adminRouter, publicRouter } from './routes/admin';
import { attendanceRouter } from './routes/attendance';
import { authRouter } from './routes/auth';
import { leaveRouter } from './routes/leave';
import { orgRouter, peopleRouter } from './routes/people';
import { reportsRouter } from './routes/reports';

const startedAt = Date.now();

async function health(_req: Request, res: Response) {
  const t0 = Date.now();
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', version: BUILD_VERSION, database: 'ok', dbLatencyMs: Date.now() - t0, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), time: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'degraded', version: BUILD_VERSION, database: 'unreachable' });
  }
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy === 'false' ? false : /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'script-src': ["'self'"],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'object-src': ["'none'"],
          'upgrade-insecure-requests': config.cookieSecure ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: config.cookieSecure ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  );

  // Request logging + API response timing (observability)
  app.use((req, res, next) => {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      if (!req.path.startsWith('/api') && req.path !== '/health') return;
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const entry = { method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms), user: req.auth?.user.id };
      if (res.statusCode >= 500) logger.error(entry, 'request');
      else if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 423) logger.warn(entry, 'request');
      else logger.info(entry, 'request');
    });
    next();
  });

  app.get('/health', health);
  app.get('/api/health', health);

  app.use('/api', rateLimit({ windowMs: 60_000, limit: config.isTest ? 100_000 : 600, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } } }));
  app.use('/api', express.json({ limit: '200kb' }));
  app.use('/api', cookieParser());
  app.use('/api', sessionMiddleware);
  app.use('/api', csrfProtection);
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/auth', authRouter);
  app.use('/api', publicRouter);

  app.use('/api', requireAuth);
  app.use('/api/attendance', attendanceRouter);
  app.use('/api/people', peopleRouter);
  app.use('/api', orgRouter);
  app.use('/api/leave', leaveRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api', adminRouter);
  app.use('/api', (_req, _res, next) => next(notFound('Endpoint')));

  // Serve the built web app (production / docker). SPA fallback to index.html.
  if (fs.existsSync(path.join(config.webDistDir, 'index.html'))) {
    app.use(express.static(config.webDistDir, { index: false, maxAge: '7d', setHeaders: (res, p) => p.endsWith('.html') && res.setHeader('Cache-Control', 'no-cache') }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.webDistDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
