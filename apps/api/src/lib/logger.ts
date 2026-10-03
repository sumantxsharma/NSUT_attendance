import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.logLevel,
  redact: { paths: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.passwordHash', '*.password_hash', '*.token'], remove: true },
  base: { app: 'nsut-attendance-api' },
});
