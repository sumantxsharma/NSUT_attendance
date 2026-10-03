import crypto from 'node:crypto';
import path from 'node:path';
import type { Response } from 'express';
import multer from 'multer';
import { one, pool, type Queryable } from '../db/pool';
import { badRequest, notFound } from './errors';

/**
 * File uploads: held in memory, validated by *content* (magic bytes), not by the
 * client-declared MIME type or extension, then stored in the `stored_files` table
 * under a random key. Storing in the database keeps the app stateless, so it runs
 * on serverless hosts without a persistent disk. Files are never served from a
 * public path; they are streamed through authorised endpoints.
 */
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

export const memoryUpload = (maxMb: number) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 20 } });

export async function saveValidatedFile(
  file: Express.Multer.File | undefined,
  allowed: ('image/png' | 'image/jpeg' | 'application/pdf')[],
  subdir: string,
  client: Queryable = pool,
) {
  if (!file) return null;
  const sig = SIGNATURES.find((s) => allowed.includes(s.mime as any) && s.test(file.buffer));
  if (!sig) throw badRequest(`Unsupported file. Allowed types: ${allowed.map((m) => m.split('/')[1].toUpperCase()).join(', ')}.`);
  const key = `${subdir}/${crypto.randomUUID()}.${sig.ext}`;
  await client.query('INSERT INTO stored_files (key, mime, data) VALUES ($1, $2, $3)', [key, sig.mime, file.buffer]);
  const safeOriginal = path.basename(file.originalname || `file.${sig.ext}`).replace(/[^\w.\- ]/g, '_').slice(0, 120);
  return { path: key, name: safeOriginal, mime: sig.mime };
}

export async function readStoredFile(key: string | null | undefined) {
  if (!key) return null;
  return one<{ mime: string; data: Buffer }>('SELECT mime, data FROM stored_files WHERE key = $1', [key]);
}

export async function deleteStoredFile(key: string) {
  await pool.query('DELETE FROM stored_files WHERE key = $1', [key]);
}

/** Send a stored file, or 404 with `what` when it is missing. */
export async function sendStoredFile(res: Response, key: string | null | undefined, what: string, headers: Record<string, string> = {}) {
  const f = await readStoredFile(key);
  if (!f) throw notFound(what);
  res.setHeader('Content-Type', f.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(f.data);
}
