/**
 * Demo seed — FICTIONAL data only.
 *
 * Creates departments, sports/activities, 16 Guest Faculty (1 inactive), 10 Sports Coaches,
 * users for every role, holidays, leave requests, corrections, and attendance from the first
 * day of the month two months ago up to today. "Today" gets a realistic scenario
 * (present / on leave / absent / not marked) computed relative to the current time so no
 * timestamp is ever in the future.
 *
 * Usage: npm run db:seed          (wipes and re-seeds data; schema must exist)
 *        npm run db:reset         (drops schema, migrates, seeds)
 */
import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import {
  classifyByDuration,
  DEFAULT_RULES,
  DEFAULT_SYSTEM_SETTINGS,
  isoWeekday,
  datesBetween,
  rulesFor,
  localToInstant,
  type PersonType,
} from '@nsut/shared';
import { pool } from './pool';
import { config } from '../config';

export const DEMO_PASSWORD = 'Demo@12345';
const TZ = DEFAULT_SYSTEM_SETTINGS.timezone;

// Deterministic PRNG so the seed is reproducible.
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260928);
const between = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1));
const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

const DEPARTMENTS = [
  ['Computer Science & Engineering', 'CSE'],
  ['Electronics & Communication Engineering', 'ECE'],
  ['Mechanical Engineering', 'ME'],
  ['Information Technology', 'IT'],
  ['Humanities & Social Sciences', 'HSS'],
  ['Applied Mathematics', 'MATH'],
  ['Sports Office', 'SPORTS'],
] as const;

const ACTIVITIES = [
  ['Athletics', 'Outdoor'],
  ['Football', 'Outdoor'],
  ['Cricket', 'Outdoor'],
  ['Basketball', 'Court'],
  ['Badminton', 'Indoor'],
  ['Yoga & Fitness', 'Fitness'],
] as const;

// Obviously fictional demo identities (ref IDs start with DEMO-, emails use the reserved .invalid TLD).
const GUEST_FACULTY: [string, string, string, string][] = [
  ['Dr. Kavya Demo-Iyer', 'CSE', 'Guest Faculty', 'Machine Learning'],
  ['Arjun Demo-Mehta', 'CSE', 'Guest Faculty', 'Data Structures'],
  ['Dr. Ritu Demo-Saxena', 'CSE', 'Guest Faculty', 'Computer Networks'],
  ['Nikhil Demo-Bansal', 'ECE', 'Guest Faculty', 'VLSI Design'],
  ['Dr. Priya Demo-Nair', 'ECE', 'Guest Faculty', 'Signal Processing'],
  ['Farhan Demo-Qureshi', 'ECE', 'Guest Faculty', 'Embedded Systems'],
  ['Dr. Sanjay Demo-Rathore', 'ME', 'Guest Faculty', 'Thermodynamics'],
  ['Meenal Demo-Kapoor', 'ME', 'Guest Faculty', 'Manufacturing Processes'],
  ['Dr. Tanvir Demo-Singh', 'ME', 'Guest Faculty', 'Fluid Mechanics'],
  ['Ishita Demo-Chawla', 'IT', 'Guest Faculty', 'Web Technologies'],
  ['Dr. Rohan Demo-Pillai', 'IT', 'Guest Faculty', 'Database Systems'],
  ['Ananya Demo-Ghosh', 'HSS', 'Guest Faculty', 'Technical Communication'],
  ['Dr. Vikram Demo-Joshi', 'HSS', 'Guest Faculty', 'Engineering Economics'],
  ['Dr. Sneha Demo-Kulkarni', 'MATH', 'Guest Faculty', 'Linear Algebra'],
  ['Kabir Demo-Malhotra', 'MATH', 'Guest Faculty', 'Probability & Statistics'],
  ['Dr. Leela Demo-Menon', 'CSE', 'Guest Faculty', 'Compiler Design'], // inactive (contract ended)
];
const COACHES: [string, string, string][] = [
  ['Coach Rajesh Demo-Yadav', 'Athletics', 'Head Coach'],
  ['Coach Pooja Demo-Rawat', 'Athletics', 'Assistant Coach'],
  ['Coach Imran Demo-Sheikh', 'Football', 'Head Coach'],
  ['Coach Deepak Demo-Negi', 'Football', 'Assistant Coach'],
  ['Coach Harpreet Demo-Gill', 'Cricket', 'Head Coach'],
  ['Coach Sameer Demo-Khan', 'Cricket', 'Assistant Coach'],
  ['Coach Neha Demo-Arora', 'Basketball', 'Head Coach'],
  ['Coach Aditya Demo-Rana', 'Badminton', 'Head Coach'],
  ['Coach Swati Demo-Bhatt', 'Badminton', 'Assistant Coach'],
  ['Coach Maya Demo-Das', 'Yoga & Fitness', 'Instructor'],
];

const emailFor = (name: string, i: number, prefix: string) =>
  `${prefix}${String(i + 1).padStart(2, '0')}.${name.replace(/^(Dr\.|Coach)\s+/, '').split(' ')[0].toLowerCase()}@demo.invalid`;

export async function seed({ log = true, todayScenario = true } = {}) {
  const c = await pool.connect();
  const say = (s: string) => log && console.log(s);
  try {
    await c.query('BEGIN');
    // Wipe data (TRUNCATE bypasses the audit log's row-level immutability trigger by design; seed only).
    await c.query(`TRUNCATE audit_logs, notifications, notification_outbox, attendance_corrections, attendance, leaves, holidays, settings,
      password_reset_tokens, sessions, user_scopes, users, people, activities, departments RESTART IDENTITY CASCADE`);

    const now = DateTime.now().setZone(TZ);
    const today = now.toISODate()!;
    const start = now.minus({ months: 2 }).startOf('month');
    const startDate = start.toISODate()!;

    await c.query(`INSERT INTO settings (key, value) VALUES ('attendance_rules', $1), ('system', $2)`, [JSON.stringify(DEFAULT_RULES), JSON.stringify(DEFAULT_SYSTEM_SETTINGS)]);

    // --- Org
    const dept = new Map<string, string>();
    for (const [name, code] of DEPARTMENTS) {
      const r = await c.query('INSERT INTO departments (name, code) VALUES ($1,$2) RETURNING id', [name, code]);
      dept.set(code, r.rows[0].id);
    }
    const act = new Map<string, string>();
    for (const [name, category] of ACTIVITIES) {
      const r = await c.query('INSERT INTO activities (name, category, department_id) VALUES ($1,$2,$3) RETURNING id', [name, category, dept.get('SPORTS')]);
      act.set(name, r.rows[0].id);
    }
    await c.query(`INSERT INTO departments (name, code, status) VALUES ('Biotechnology (inactive demo)', 'BT', 'INACTIVE')`);

    // --- Holidays (fixed national holidays + one clearly-marked demo holiday)
    const holidayRows: [string, string][] = [];
    for (const y of [start.year, now.year, now.year + 1]) {
      holidayRows.push([`${y}-01-26`, 'Republic Day'], [`${y}-08-15`, 'Independence Day'], [`${y}-10-02`, 'Gandhi Jayanti']);
    }
    const demoHoliday = start.plus({ months: 1, days: 20 });
    const demoHolidayDate = (demoHoliday.weekday > 5 ? demoHoliday.minus({ days: demoHoliday.weekday - 5 }) : demoHoliday).toISODate()!;
    holidayRows.push([demoHolidayDate, 'University Foundation Day (demo)']);
    const holidaySet = new Set<string>();
    for (const [d, n] of holidayRows) {
      if (holidaySet.has(d)) continue;
      holidaySet.add(d);
      await c.query('INSERT INTO holidays (date, name) VALUES ($1,$2)', [d, n]);
    }

    // --- People
    type P = { id: string; name: string; type: PersonType; reliability: number; punctual: number; joining: string; contractEnd: string | null; active: boolean; email: string };
    const people: P[] = [];
    const contractStart = start.minus({ months: 1 }).toISODate()!;
    const contractEnd = now.plus({ months: 6 }).endOf('month').toISODate()!;
    for (let i = 0; i < GUEST_FACULTY.length; i++) {
      const [name, code, designation, spec] = GUEST_FACULTY[i];
      const inactive = i === GUEST_FACULTY.length - 1;
      const lateJoiner = i === 4; // joined mid-period: tests contract-window handling
      const endingSoon = i === 7; // contract ends within 30 days
      const joining = lateJoiner ? start.plus({ months: 1, days: 9 }).toISODate()! : contractStart;
      const end = inactive ? start.plus({ days: 40 }).toISODate()! : endingSoon ? now.plus({ days: 18 }).toISODate()! : contractEnd;
      const email = emailFor(name, i, 'gf');
      const r = await c.query(
        `INSERT INTO people (ref_id, full_name, type, department_id, designation, specialization, email, phone, joining_date, contract_start, contract_end, assigned_hours, status)
         VALUES ($1,$2,'GUEST_FACULTY',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          `DEMO-GF-${String(i + 1).padStart(3, '0')}`,
          name,
          dept.get(code),
          designation,
          spec,
          email,
          `+91 90000 ${String(10000 + i).slice(-5)}`,
          joining,
          joining,
          end,
          between(12, 20),
          inactive ? 'INACTIVE' : 'ACTIVE',
        ],
      );
      people.push({ id: r.rows[0].id, name, type: 'GUEST_FACULTY', reliability: i === 5 ? 0.72 : 0.86 + rnd() * 0.1, punctual: i === 2 ? 0.6 : 0.85, joining, contractEnd: end, active: !inactive, email });
    }
    for (let i = 0; i < COACHES.length; i++) {
      const [name, activity, designation] = COACHES[i];
      const email = emailFor(name, i, 'coach');
      const r = await c.query(
        `INSERT INTO people (ref_id, full_name, type, activity_id, department_id, designation, specialization, email, phone, joining_date, contract_start, contract_end, assigned_hours)
         VALUES ($1,$2,'SPORTS_COACH',$3,$4,$5,$6,$7,$8,$9,$9,$10,$11) RETURNING id`,
        [
          `DEMO-SC-${String(i + 1).padStart(3, '0')}`,
          name,
          act.get(activity),
          dept.get('SPORTS'),
          designation,
          activity,
          email,
          `+91 90001 ${String(20000 + i).slice(-5)}`,
          contractStart,
          contractEnd,
          between(24, 36),
        ],
      );
      people.push({ id: r.rows[0].id, name, type: 'SPORTS_COACH', reliability: i === 3 ? 0.74 : 0.87 + rnd() * 0.1, punctual: 0.88, joining: contractStart, contractEnd, active: true, email });
    }
    say(`• ${people.length} people (${people.filter((p) => p.active).length} active)`);

    // --- Users
    const hash = await bcrypt.hash(DEMO_PASSWORD, config.isTest ? 4 : 10);
    const addUser = async (name: string, email: string, role: string, personId: string | null = null) =>
      (await c.query('INSERT INTO users (name, email, password_hash, role, person_id, phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [name, email, hash, role, personId, null])).rows[0].id as string;
    const superAdmin = await addUser('Demo Super Admin', 'superadmin@demo.invalid', 'SUPER_ADMIN');
    const officer = await addUser('Demo Establishment Officer', 'officer@demo.invalid', 'OFFICER');
    const coordCse = await addUser('Demo CSE Coordinator', 'coordinator.cse@demo.invalid', 'COORDINATOR');
    const coordSports = await addUser('Demo Sports Coordinator', 'coordinator.sports@demo.invalid', 'COORDINATOR');
    await c.query('INSERT INTO user_scopes (user_id, department_id) VALUES ($1,$2), ($1,$3)', [coordCse, dept.get('CSE'), dept.get('IT')]);
    for (const a of act.values()) await c.query('INSERT INTO user_scopes (user_id, activity_id) VALUES ($1,$2)', [coordSports, a]);
    const staffUser = new Map<string, string>();
    for (const p of people) staffUser.set(p.id, await addUser(p.name, p.email, 'STAFF', p.id));
    await c.query(`UPDATE users SET status = 'INACTIVE' WHERE person_id = $1`, [people.find((p) => !p.active)!.id]);
    await c.query(`UPDATE users SET last_login = now() - (random() * interval '5 days')`);

    // --- Leave requests (history + today + future)
    const leaves: { personIdx: number; from: string; to: string; type: string; reason: string; status: string; reviewer: string | null }[] = [];
    const d = (offsetDays: number) => now.plus({ days: offsetDays }).toISODate()!;
    const s = (offsetDays: number) => start.plus({ days: offsetDays }).toISODate()!;
    leaves.push(
      { personIdx: 0, from: s(9), to: s(10), type: 'CASUAL', reason: 'Family function out of station', status: 'APPROVED', reviewer: officer },
      { personIdx: 3, from: s(22), to: s(24), type: 'MEDICAL', reason: 'Viral fever; medical certificate attached', status: 'APPROVED', reviewer: officer },
      { personIdx: 17, from: s(30), to: s(31), type: 'DUTY', reason: 'Accompanying university team to inter-university meet', status: 'APPROVED', reviewer: coordSports },
      { personIdx: 9, from: s(40), to: s(40), type: 'PERSONAL', reason: 'Personal work at bank', status: 'REJECTED', reviewer: coordCse },
      { personIdx: 12, from: s(45), to: s(46), type: 'CASUAL', reason: 'Travel for a conference presentation', status: 'APPROVED', reviewer: officer },
      { personIdx: 20, from: s(52), to: s(53), type: 'MEDICAL', reason: 'Minor injury during training session', status: 'APPROVED', reviewer: coordSports },
      // Today: two people on approved leave
      { personIdx: 6, from: d(-1), to: d(1), type: 'MEDICAL', reason: 'Scheduled medical procedure', status: 'APPROVED', reviewer: officer },
      { personIdx: 22, from: d(0), to: d(0), type: 'DUTY', reason: 'Umpiring at state-level tournament', status: 'APPROVED', reviewer: coordSports },
      // Pending
      { personIdx: 1, from: d(3), to: d(4), type: 'CASUAL', reason: 'Sibling’s wedding', status: 'PENDING', reviewer: null },
      { personIdx: 13, from: d(7), to: d(7), type: 'PERSONAL', reason: 'Visa appointment', status: 'PENDING', reviewer: null },
      { personIdx: 18, from: d(2), to: d(2), type: 'OTHER', reason: 'Coaching certification exam', status: 'PENDING', reviewer: null },
    );
    const leaveDay = new Map<string, string>(); // `${personId}|${date}` -> leaveId
    for (const l of leaves) {
      const p = people[l.personIdx];
      const r = await c.query(
        `INSERT INTO leaves (person_id, from_date, to_date, leave_type, reason, status, submitted_by, submitted_at, reviewed_by, reviewed_at, reviewer_remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          p.id,
          l.from,
          l.to,
          l.type,
          l.reason,
          l.status,
          staffUser.get(p.id),
          DateTime.fromISO(l.from, { zone: TZ }).minus({ days: 3 }).set({ hour: 11 }).toJSDate() < new Date() ? DateTime.fromISO(l.from, { zone: TZ }).minus({ days: 3 }).set({ hour: 11 }).toJSDate() : new Date(),
          l.reviewer,
          l.reviewer ? DateTime.fromISO(l.from, { zone: TZ }).minus({ days: 2 }).set({ hour: 15 }).toJSDate() : null,
          l.status === 'REJECTED' ? 'Insufficient notice; please reschedule outside teaching hours.' : l.status === 'APPROVED' ? 'Approved.' : null,
        ],
      );
      const id = r.rows[0].id;
      if (l.status === 'APPROVED') for (const date of datesBetween(l.from, l.to)) leaveDay.set(`${p.id}|${date}`, id);
      await c.query(
        `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, summary, new_value, created_at) VALUES ($1,$2,'LEAVE_SUBMIT','leave',$3,$4,$5, now() - interval '3 days')`,
        [staffUser.get(p.id), p.name, id, `${p.name}: leave ${l.from} to ${l.to}`, JSON.stringify({ fromDate: l.from, toDate: l.to, leaveType: l.type })],
      );
      if (l.reviewer)
        await c.query(
          `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, summary, new_value, created_at)
           VALUES ($1,(SELECT name FROM users WHERE id = $1),$2,'leave',$3,$4,$5, now() - interval '2 days')`,
          [l.reviewer, l.status === 'APPROVED' ? 'LEAVE_APPROVE' : 'LEAVE_REJECT', id, `${l.status === 'APPROVED' ? 'Approved' : 'Rejected'} leave for ${p.name}`, JSON.stringify({ status: l.status })],
        );
    }

    // --- Attendance history
    const rows: any[][] = [];
    const nowMinute = now.hour * 60 + now.minute;
    const todayIdx = { leave: [6, 22], absent: [5, 23], notMarked: [11, 19] };
    let seq = 0;
    for (const [idx, p] of people.entries()) {
      const tr = rulesFor(DEFAULT_RULES, p.type);
      const startM = Number(tr.officeStart.slice(0, 2)) * 60 + Number(tr.officeStart.slice(3));
      const endM = Number(tr.officeEnd.slice(0, 2)) * 60 + Number(tr.officeEnd.slice(3));
      const lastDay = p.contractEnd && p.contractEnd < today ? p.contractEnd : today;
      for (const date of datesBetween(p.joining > startDate ? p.joining : startDate, lastDay)) {
        if (!tr.workingDays.includes(isoWeekday(date)) || holidaySet.has(date)) continue;
        const leaveId = leaveDay.get(`${p.id}|${date}`);
        const isToday = date === today;
        if (leaveId) {
          rows.push([p.id, date, 'LEAVE', null, null, null, 'LEAVE_SYNC', 'Approved leave', officer, leaveId]);
          continue;
        }
        if (isToday) {
          if (!todayScenario) continue;
          if (todayIdx.notMarked.includes(idx)) continue;
          if (todayIdx.absent.includes(idx)) {
            rows.push([p.id, date, 'ABSENT', null, null, null, 'MANUAL', 'Informed absence by phone', officer, null]);
            continue;
          }
          // Present today. Keep every timestamp before "now".
          let inM = rnd() < p.punctual ? startM - between(0, 20) : startM + between(16, 50);
          if (inM >= nowMinute - 5) inM = Math.max(1, nowMinute - between(10, Math.min(90, Math.max(10, nowMinute - 1))));
          let outM: number | null = null;
          const plannedOut = endM + between(-5, 25);
          if (plannedOut < nowMinute - 1 && seq++ % 3 !== 0) outM = plannedOut; // some already left; others still in
          const inAt = localToInstant(date, hhmm(inM), TZ);
          const outAt = outM !== null ? localToInstant(date, hhmm(outM), TZ) : null;
          const dur = outAt ? Math.floor((+outAt - +inAt) / 60000) : null;
          rows.push([p.id, date, dur !== null ? classifyByDuration(dur, tr) : 'PRESENT', inAt, outAt, dur, 'SELF', null, staffUser.get(p.id), null]);
          continue;
        }
        const roll = rnd();
        if (roll > p.reliability + 0.02) {
          rows.push([p.id, date, 'ABSENT', null, null, null, 'MANUAL', rnd() < 0.5 ? 'Did not report' : 'Absent without intimation', officer, null]);
          continue;
        }
        if (roll > p.reliability) continue; // not marked
        const inM = rnd() < p.punctual ? startM - between(0, 20) + between(0, 14) : startM + between(16, 55);
        let outM = endM + between(-10, 35);
        const kind = rnd();
        if (kind < 0.05) outM = startM + between(200, 260); // half day
        else if (kind < 0.12) outM = endM - between(20, 75); // early departure
        const incomplete = kind > 0.99;
        const method = rnd() < 0.06 ? 'MANUAL' : 'SELF';
        const inAt = localToInstant(date, hhmm(inM), TZ);
        const outAt = incomplete ? null : localToInstant(date, hhmm(outM), TZ);
        const dur = outAt ? Math.floor((+outAt - +inAt) / 60000) : null;
        const status = dur !== null ? classifyByDuration(dur, tr) : 'PRESENT';
        rows.push([p.id, date, status, inAt, outAt, dur, method, method === 'MANUAL' ? 'Entered from physical register' : null, method === 'MANUAL' ? officer : staffUser.get(p.id), null]);
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const cols = 10;
      const values = chunk.map((_, r) => `(${Array.from({ length: cols }, (_, k) => `$${r * cols + k + 1}`).join(',')})`).join(',');
      await c.query(
        `INSERT INTO attendance (person_id, date, status, check_in_at, check_out_at, duration_minutes, marking_method, remarks, marked_by, leave_id) VALUES ${values}`,
        chunk.flat(),
      );
    }
    // created_at/updated_at realistic: set to check-out/check-in or noon of that date
    await c.query(`UPDATE attendance SET created_at = COALESCE(check_in_at, (date + time '12:00') AT TIME ZONE '${TZ}'), updated_at = COALESCE(check_out_at, check_in_at, (date + time '12:00') AT TIME ZONE '${TZ}')`);
    say(`• ${rows.length} attendance records ${startDate} → ${today}`);

    // --- Audit entries for today's self check-ins/outs
    await c.query(
      `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, summary, new_value, created_at)
       SELECT a.marked_by, p.full_name, 'ATTENDANCE_CHECK_IN', 'attendance', a.id::text, p.full_name || ' checked in', json_build_object('checkInAt', a.check_in_at), a.check_in_at
       FROM attendance a JOIN people p ON p.id = a.person_id WHERE a.date = $1 AND a.check_in_at IS NOT NULL`,
      [today],
    );
    await c.query(
      `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, summary, new_value, created_at)
       SELECT a.marked_by, p.full_name, 'ATTENDANCE_CHECK_OUT', 'attendance', a.id::text, p.full_name || ' checked out', json_build_object('checkOutAt', a.check_out_at, 'durationMinutes', a.duration_minutes), a.check_out_at
       FROM attendance a JOIN people p ON p.id = a.person_id WHERE a.date = $1 AND a.check_out_at IS NOT NULL`,
      [today],
    );
    await c.query(
      `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, summary, new_value, created_at)
       SELECT $2, 'Demo Establishment Officer', 'ATTENDANCE_CREATE', 'attendance', a.id::text, 'Marked ' || p.full_name || ' as ABSENT for ' || a.date, json_build_object('status', a.status), now() - interval '20 minutes'
       FROM attendance a JOIN people p ON p.id = a.person_id WHERE a.date = $1 AND a.marking_method = 'MANUAL'`,
      [today, officer],
    );

    // --- Two applied corrections with full before/after trail
    const corrTargets = await c.query(
      `SELECT a.*, p.full_name FROM attendance a JOIN people p ON p.id = a.person_id WHERE a.check_out_at IS NOT NULL AND a.date < $1 AND p.type = 'GUEST_FACULTY' ORDER BY a.date DESC, p.ref_id LIMIT 2`,
      [today],
    );
    for (const a of corrTargets.rows) {
      const newIn = new Date(+a.check_in_at + 12 * 60000);
      const newOut = new Date(+a.check_out_at + 5 * 60000);
      const dur = Math.floor((+newOut - +newIn) / 60000);
      const prev = { status: a.status, checkInAt: a.check_in_at, checkOutAt: a.check_out_at, durationMinutes: a.duration_minutes };
      const next = { status: a.status, checkInAt: newIn, checkOutAt: newOut, durationMinutes: dur };
      await c.query(`UPDATE attendance SET check_in_at = $2, check_out_at = $3, duration_minutes = $4, marking_method = 'MANUAL', marked_by = $5, version = version + 1 WHERE id = $1`, [
        a.id,
        newIn,
        newOut,
        dur,
        officer,
      ]);
      const reason = 'Biometric terminal clock was fast; times corrected from gate register';
      await c.query(
        `INSERT INTO attendance_corrections (attendance_id, person_id, date, previous_value, proposed_value, reason, status, requested_by, reviewed_by, reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,'APPLIED',$7,$7, now() - interval '1 day')`,
        [a.id, a.person_id, a.date, JSON.stringify(prev), JSON.stringify(next), reason, officer],
      );
      await c.query(
        `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, summary, old_value, new_value, reason, created_at)
         VALUES ($1,'Demo Establishment Officer','ATTENDANCE_UPDATE','attendance',$2,$3,$4,$5,$6, now() - interval '1 day')`,
        [officer, a.id, `Corrected ${a.full_name} on ${a.date}`, JSON.stringify(prev), JSON.stringify(next), reason],
      );
    }

    // --- Notifications
    await c.query(
      `INSERT INTO notifications (user_id, type, title, body, link)
       SELECT u.id, 'LEAVE_SUBMITTED', 'Leave request: ' || p.full_name, to_char(l.from_date, 'DD Mon') || ' to ' || to_char(l.to_date, 'DD Mon'), '/leave?status=PENDING'
       FROM leaves l JOIN people p ON p.id = l.person_id CROSS JOIN users u
       WHERE l.status = 'PENDING' AND u.role IN ('SUPER_ADMIN','OFFICER')`,
    );
    await c.query(
      `INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1, 'CONTRACT_EXPIRING', 'Contract nearing expiry', $2, $3)`,
      [superAdmin, `${people[7].name} — contract ends ${people[7].contractEnd}`, `/people/${people[7].id}`],
    );
    await c.query(
      `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, summary) VALUES ($1, 'System', 'SETTINGS_SYSTEM_UPDATE', 'settings', 'system', 'Demo data seeded')`,
      [superAdmin],
    );

    await c.query('COMMIT');
    say(`• users: superadmin / officer / coordinator.cse / coordinator.sports @demo.invalid + ${people.length} staff — password ${DEMO_PASSWORD}`);
    return { superAdmin, officer, coordCse, coordSports, people, today };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

// Match the script filename, not import.meta.url: after bundling every module shares the server's URL.
if (/[\\/]seed\.(ts|js)$/.test(process.argv[1] ?? '')) {
  if (config.isProd && process.env.ALLOW_PROD_SEED !== 'yes') {
    console.error('Refusing to seed demo data in production. Set ALLOW_PROD_SEED=yes to override (never on a live system).');
    process.exit(1);
  }
  seed()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
