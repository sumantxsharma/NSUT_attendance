import {
  attendanceRulesSchema,
  DEFAULT_RULES,
  DEFAULT_SYSTEM_SETTINGS,
  systemSettingsSchema,
  type AttendanceRules,
  type SystemSettings,
} from '@nsut/shared';
import { one, query, type Queryable, pool } from '../db/pool';

/**
 * Settings are stored as JSON in the `settings` table and validated on read
 * (falling back to defaults for any missing keys, e.g. after an upgrade).
 * A short in-process cache avoids a DB round-trip on every request.
 */
let cache: { rules: AttendanceRules; system: SystemSettings; at: number } | null = null;
const TTL_MS = 5_000;

function deepMerge<T>(base: T, over: any): T {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return (over ?? base) as T;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const k of Object.keys(over)) {
    out[k] = typeof (base as any)?.[k] === 'object' && !Array.isArray((base as any)[k]) && (base as any)[k] !== null ? deepMerge((base as any)[k], over[k]) : over[k];
  }
  return out;
}

export async function loadSettings(client: Queryable = pool): Promise<{ rules: AttendanceRules; system: SystemSettings }> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const rows = await query<{ key: string; value: any }>('SELECT key, value FROM settings WHERE key IN ($1, $2)', ['attendance_rules', 'system'], client);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const rulesParsed = attendanceRulesSchema.safeParse(deepMerge(DEFAULT_RULES, map.get('attendance_rules') ?? {}));
  const sysParsed = systemSettingsSchema.safeParse(deepMerge(DEFAULT_SYSTEM_SETTINGS, map.get('system') ?? {}));
  cache = {
    rules: rulesParsed.success ? rulesParsed.data : DEFAULT_RULES,
    system: sysParsed.success ? sysParsed.data : DEFAULT_SYSTEM_SETTINGS,
    at: Date.now(),
  };
  return cache;
}

export function invalidateSettings() {
  cache = null;
}

export async function saveSetting(key: 'attendance_rules' | 'system', value: unknown, userId: string | null, client: Queryable = pool) {
  await one(
    `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), userId],
    client,
  );
  invalidateSettings();
}

export async function getTz(): Promise<string> {
  return (await loadSettings()).system.timezone;
}
