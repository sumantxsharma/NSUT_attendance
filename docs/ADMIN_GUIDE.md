# Admin Guide

For **Super Admins**, **Authorized Officers** and **Sport / Activity Coordinators**.

## Who can do what

| Task | Super Admin | Officer | Coordinator | Staff |
|---|:-:|:-:|:-:|:-:|
| Dashboard, live presence, daily sheet, calendar, monthly records | ✓ | ✓ | ✓ (own scope) | – |
| View Guest Faculty / Coaches | ✓ | ✓ | ✓ (own scope) | own profile |
| Create / edit / deactivate profiles | ✓ | – | – | – |
| Mark attendance manually | ✓ | ✓ | – | – |
| Correct attendance | ✓ | ✓ | – | – |
| Delete an attendance record | ✓ | – | – | – |
| Approve / reject corrections (when approval is required) | ✓ | – | – | – |
| Approve / reject leave | ✓ | ✓ | ✓ (own scope) | – |
| Reports and export | ✓ | ✓ | ✓ (own scope) | – |
| Users, roles, rules, system settings, sports | ✓ | – | – | – |
| Audit logs | ✓ | – | – | – |
| Check in / out, apply for leave | – | – | – | ✓ |

The full permission matrix is under **Administration → Roles**.

## First-time setup (Super Admin)

1. **System Settings.** Set the university name and administrative unit, and upload the **official logo** (PNG/JPEG supplied by the University; nothing else). Check the timezone (`Asia/Kolkata`), date format and report footer. Add the year's **holidays**.
2. **Attendance Rules.** The rules read as a policy statement; click a highlighted value to change it. Set these for Guest Faculty and Sports Coaches separately:
   - office start and end
   - grace period (late threshold)
   - early-departure allowance
   - minimum hours for a full day and a half day
   - working days

   Then decide how leave, holidays and weekends affect the percentage, the half-day credit, and whether officer corrections need your approval. The *Resulting formula* box shows exactly how % will be calculated. Every change is recorded in the audit log.
3. **Sports & Activities**. Add or rename them; deactivate rather than delete. Every Guest Faculty member and coach belongs to one.
4. **People.** Use *Guest Faculty / Sports Coaches → Add*. Give each person a unique Employee/Reference ID. Tick *Create a login* to let them check in, and set an initial password. Alternatively, create logins later under *Users*.
5. **Users.** Create Officers and Coordinators. For a Coordinator, tick the sports / activities they supervise. They will see nobody else.

## Daily routine (Officer / Coordinator)

**Dashboard.** This answers the key questions at a glance:

- present today, currently present, absent, on leave, not marked, late arrivals
- attendance % this month compared with last month
- a live presence table
- a 30-day trend
- a sport / activity summary (lowest % first; anything under 75% is flagged *Low*)
- recent activity
- items needing attention (pending leave, contracts ending within 30 days)

Click any number to open the matching filtered list.

**Today's Attendance** is the working sheet:

- Filter by type, sport, status or name. Filters stay in the URL, so a view can be bookmarked or shared.
- Change the date to review a past day.
- **Mark** records attendance for someone who has no entry. You choose Date → Person → Status → In-time → Out-time → Remarks, then **Review**. A confirmation screen shows exactly what will be saved.
- **Correct** changes an existing entry. You see *Previous* and *Changed to* side by side, and **a reason is required**. The change appears in the person's *Audit / Corrections* history and in the audit log. If the rules require approval, the correction waits for a Super Admin under *Attendance → Corrections*.

**Live Presence** ("Who is Present Now?") groups everyone as *Currently Present / Checked Out / Absent / On Leave / Not Marked* and refreshes every 30 seconds.

**Calendar.** Pick a person and month. Each day shows its status with an icon and label (never colour alone). Click a day for in/out times, duration, how it was marked, and whether it counted towards the percentage.

**Monthly Records.** One row per person: working days, present, absent (including not-marked days), leave, half days, late, hours and attendance %. Click a column header to sort. *How % is calculated* explains the current formula.

## Statuses

| Status | Meaning |
|---|---|
| Present | Attended. With automatic classification on, at least the full-day minimum hours |
| Half Day | Attended between the half-day and full-day minimums, or marked as such |
| Absent | Marked absent, or checked out below the half-day minimum |
| On Leave | Approved leave (created automatically on approval) |
| Holiday | Institutional holiday |
| Not Marked | A working day with no record. Counts as not attended once the day has passed; *today* is not counted until marked |
| Currently Present | Checked in, not yet checked out (live views) |

*Late* and *Early* flags are calculated from the rules for that person's type. *No out* means a past day with a check-in but no check-out. Fix these from the *Incomplete Attendance* report.

## Leave

**Leave → Requests** lists pending requests for your scope.

- **Approve** marks every working, non-holiday day in the range as *On Leave*. Days on which the person actually attended are left unchanged, and the confirmation tells you how many.
- **Reject** requires a reason, which the requester sees.
- **Cancel** an approved leave (for example, when the person returned early). Its leave days revert to *Not Marked*.
- **Record leave** on someone's behalf (for example, a phoned-in medical leave). It still goes through approval.
- You cannot approve your own request.

## Reports

**Reports** offers ten report types:

- Daily
- Monthly
- Individual
- Sports / Activity-wise
- Absence
- Leave
- Late Arrival
- Early Departure
- Incomplete Attendance

Choose the period and filters to see a live preview laid out as an official document: letterhead, title, period, filters, generation time and user, table, summary and calculation notes. Then:

- **Print** uses a dedicated print layout. Navigation and buttons are hidden, and the page number and signature line are added.
- **CSV** is a plain table, UTF-8, safe to open in Excel.
- **Excel** includes a header block, frozen header row, filters and summary.
- **PDF** is A4 landscape with a logo area, repeated table headers, summary, signature line, footer and page numbers.

Every export is recorded in the audit log.

## People lifecycle

- **Edit** a profile to change sport / activity, contract dates or assigned hours.
- **Deactivate** when a contract ends. The person disappears from active lists and their login is disabled, but all history remains in reports. You can **Reactivate** later.
- **Photograph.** Use the camera button on the profile (PNG/JPEG up to 2 MB).
- **Contract ending soon** is flagged on the dashboard and in people lists.

## Users and access

- **Reset link.** The key icon on *Users* issues a single-use link valid for 24 hours. Share it through a trusted channel.
- **Unlock.** After 5 failed sign-ins an account locks for 15 minutes. Unlock it from *Users*.
- Deactivating a user ends their sessions immediately. Changing someone's role signs them out.

## Audit Logs (Super Admin)

The audit log is an append-only record of sign-ins, attendance and leave changes, user and profile changes, configuration changes and exports. Filter by text, action, record type and date. Click a row to see full old and new values, the reason, IP address and browser. Entries cannot be edited or deleted, even by administrators.

## Good practice

- Correct attendance only with evidence (register, gate log) and write it in the reason.
- Review the *Incomplete Attendance* and *Absence* reports weekly.
- Keep holidays up to date before each semester.
- Give Coordinators the narrowest scope that works.
