import type { Request } from 'express';
import { DateTime } from 'luxon';
import { previousMonth, todayIn, datesBetween, evaluateDay, rulesFor } from '@nsut/shared';
import { query } from '../db/pool';
import { peopleScopeSql } from '../lib/scope';
import { loadSettings } from '../lib/settings';
import { Params } from '../lib/sql';
import { aggregatePercentage, buildDays, dailySheet, holidaysBetween, recordsFor, scopedPeople, type Filters } from './attendance';

export async function dashboard(req: Request, filters: Filters = {}) {
  const { rules, system } = await loadSettings();
  const tz = system.timezone;
  const today = todayIn(tz);
  const now = DateTime.now().setZone(tz);
  const sheet = await dailySheet(req, today, filters);
  const cur = await aggregatePercentage(req, now.year, now.month, filters);
  const pm = previousMonth(now.year, now.month);
  const prev = await aggregatePercentage(req, pm.year, pm.month, filters);

  // --- Trend: last 30 days, daily attendance % across people for whom the day counted.
  const from = now.minus({ days: 29 }).toISODate()!;
  const people = await scopedPeople(req, filters, { includeInactiveWithRecords: { from, to: today } });
  const recs = await recordsFor(
    people.map((p) => p.id),
    from,
    today,
  );
  const holidays = await holidaysBetween(from, today);
  const recMap = new Map<string, Map<string, any>>();
  for (const r of recs) {
    if (!recMap.has(r.person_id)) recMap.set(r.person_id, new Map());
    recMap.get(r.person_id)!.set(r.date, r);
  }
  const dates = datesBetween(from, today);
  const trendAcc = new Map(dates.map((d) => [d, { eligible: 0, credits: 0, gfE: 0, gfC: 0, scE: 0, scC: 0 }]));
  for (const p of people) {
    const tr = rulesFor(rules, p.type);
    for (const d of buildDays(p, dates, recMap.get(p.id) ?? new Map(), holidays, today)) {
      const ev = evaluateDay(d, tr, rules);
      if (ev.outcome !== 'COUNTED') continue;
      const acc = trendAcc.get(d.date)!;
      acc.eligible++;
      acc.credits += ev.credit;
      if (p.type === 'GUEST_FACULTY') {
        acc.gfE++;
        acc.gfC += ev.credit;
      } else {
        acc.scE++;
        acc.scC += ev.credit;
      }
    }
  }
  const r1 = (c: number, e: number) => (e ? Math.round((c / e) * 1000) / 10 : null);
  const trend = dates.map((d) => {
    const a = trendAcc.get(d)!;
    return { date: d, overall: r1(a.credits, a.eligible), guestFaculty: r1(a.gfC, a.gfE), sportsCoaches: r1(a.scC, a.scE), eligible: a.eligible };
  });

  // --- Sport / activity summary (today + month-to-date)
  const unitMap = new Map<string, { key: string; name: string; people: number; presentToday: number; absentToday: number; leaveToday: number; notMarkedToday: number; eligible: number; credits: number }>();
  const unitOf = (row: { person: { activityName: string | null; activityId: string | null } }) => ({ key: row.person.activityId ?? 'none', name: row.person.activityName ?? 'Unassigned' });
  for (const row of sheet.rows) {
    const u = unitOf(row);
    if (!unitMap.has(u.key)) unitMap.set(u.key, { ...u, people: 0, presentToday: 0, absentToday: 0, leaveToday: 0, notMarkedToday: 0, eligible: 0, credits: 0 });
    const acc = unitMap.get(u.key)!;
    acc.people++;
    if (row.status === 'PRESENT' || row.status === 'HALF_DAY' || row.presence === 'CURRENTLY_PRESENT') acc.presentToday++;
    else if (row.status === 'ABSENT') acc.absentToday++;
    else if (row.status === 'LEAVE') acc.leaveToday++;
    else if (row.status === 'NOT_MARKED' && row.isWorkingDay) acc.notMarkedToday++;
  }
  for (const row of cur.rows) {
    const u = unitOf(row as any);
    const acc = unitMap.get(u.key);
    if (!acc) continue;
    acc.eligible += row.eligibleDays;
    acc.credits += row.credits;
  }
  const units = [...unitMap.values()]
    .map((u) => ({ ...u, monthPercentage: r1(u.credits, u.eligible) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const lp = new Params();
  const pending = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM leaves l JOIN people p ON p.id = l.person_id WHERE l.status = 'PENDING' AND ${peopleScopeSql(req, lp)}`,
    lp.values,
  );
  let expiring: any[] = [];
  {
    const pp = new Params();
    expiring = await query(
      `SELECT p.id, p.full_name AS "fullName", p.contract_end AS "contractEnd" FROM people p
       WHERE p.status = 'ACTIVE' AND p.deleted_at IS NULL AND p.contract_end BETWEEN ${pp.add(today)}::date AND ${pp.add(today)}::date + 30 AND ${peopleScopeSql(req, pp)}
       ORDER BY p.contract_end LIMIT 10`,
      pp.values,
    );
  }

  return {
    date: today,
    serverTime: new Date().toISOString(),
    timezone: tz,
    isHoliday: sheet.isHoliday,
    holidayName: sheet.holidayName,
    counts: sheet.counts,
    live: sheet.rows,
    percentages: {
      month: { year: now.year, month: now.month, overall: cur.overall.percentage, guestFaculty: cur.guestFaculty.percentage, sportsCoaches: cur.sportsCoaches.percentage },
      previous: { year: pm.year, month: pm.month, overall: prev.overall.percentage, guestFaculty: prev.guestFaculty.percentage, sportsCoaches: prev.sportsCoaches.percentage },
    },
    trend,
    units,
    pendingLeave: pending[0]?.n ?? 0,
    contractsExpiring: expiring,
  };
}
