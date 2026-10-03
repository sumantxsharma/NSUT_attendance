import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config';
import { badRequest } from './errors';

/**
 * File uploads: stored in memory first, then validated by *content* (magic bytes),
 * not just by the client-declared MIME type or extension, before being written
 * to UPLOAD_DIR under a random name. Files are never served from a public path;
 * they are streamed through authorised endpoints.
 */
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

export const memoryUpload = (maxMb: number) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 20 } });

export function saveValidatedFile(file: Express.Multer.File | undefined, allowed: ('image/png' | 'image/jpeg' | 'application/pdf')[], subdir: string) {
  if (!file) return null;
  const sig = SIGNATURES.find((s) => allowed.includes(s.mime as any) && s.test(file.buffer));
  if (!sig) throw badRequest(`Unsupported file. Allowed types: ${allowed.map((m) => m.split('/')[1].toUpperCase()).join(', ')}.`);
  const dir = path.join(config.uploadDir, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${sig.ext}`;
  fs.writeFileSync(path.join(dir, name), file.buffer, { mode: 0o640 });
  const safeOriginal = path.basename(file.originalname || `file.${sig.ext}`).replace(/[^\w.\- ]/g, '_').slice(0, 120);
  return { path: `${subdir}/${name}`, name: safeOriginal, mime: sig.mime };
}

export function resolveUpload(rel: string): string {
  const full = path.resolve(config.uploadDir, rel);
  if (!full.startsWith(path.resolve(config.uploadDir) + path.sep)) throw badRequest('Invalid file path.');
  return full;
}

export const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf' };
