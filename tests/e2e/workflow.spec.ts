import { expect, test, type Page } from '@playwright/test';
import { DateTime } from 'luxon';

/**
 * End-to-end acceptance flow (spec §37):
 * 1 Admin login → 2 Create person → 3 Person logs in → 4 Check-in → 5 Check-out →
 * 6 Admin views attendance → 7 Admin generates report → 8 Person submits leave →
 * 9 Admin approves leave → 10 Attendance reflects approved leave
 */
const ADMIN = { email: 'superadmin@demo.invalid', password: 'Demo@12345' };
const REF = `E2E-GF-${Date.now().toString().slice(-6)}`;
const NAME = 'Dr. Eshaan E2E-Verma';
const EMAIL = `e2e.${REF.toLowerCase()}@demo.invalid`;
const PASSWORD = 'E2ePassw0rd!';
const nextMonday = DateTime.now().setZone('Asia/Kolkata').plus({ weeks: 1 }).startOf('week');

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test.describe.serial('attendance lifecycle', () => {
  let personUrl = '';

  test('1–2. admin signs in and creates a Guest Faculty profile with a login', async ({ page }) => {
    await signIn(page, ADMIN.email, ADMIN.password);
    await expect(page.getByRole('heading', { name: /Attendance Overview/ })).toBeVisible();
    await expect(page.getByText('Total personnel')).toBeVisible();

    await page.goto('/people/new?type=GUEST_FACULTY');
    await page.getByLabel('Employee / Reference ID').fill(REF);
    await page.getByLabel('Full name').fill(NAME);
    await page.getByLabel('Department').selectOption({ label: 'Mechanical Engineering' });
    await page.getByLabel('Specialization').fill('Heat Transfer');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Initial password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create profile' }).click();
    await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
    personUrl = new URL(page.url()).pathname;
    expect(personUrl).toMatch(/^\/people\/[0-9a-f-]{36}$/);
  });

  test('3–5. the person signs in, checks in, then checks out', async ({ page }) => {
    await signIn(page, EMAIL, PASSWORD);
    await expect(page.getByRole('heading', { name: 'My Attendance' })).toBeVisible();
    await page.getByRole('button', { name: 'CHECK IN' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Attendance marked successfully' }).first()).toBeVisible();
    await expect(page.getByText(/Check-in: \d{2}:\d{2} (AM|PM)/).first()).toBeVisible();
    // Duplicate prevention: the check-in button is gone, only check-out remains
    await expect(page.getByRole('button', { name: 'CHECK IN' })).toHaveCount(0);
    await page.getByRole('button', { name: 'CHECK OUT' }).click();
    await expect(page.getByText(/Check-out: \d{2}:\d{2} (AM|PM)/).first()).toBeVisible();
    await expect(page.getByText('Attendance complete for today')).toBeVisible();
  });

  test('6–7. admin sees the attendance and generates a report', async ({ page }) => {
    await signIn(page, ADMIN.email, ADMIN.password);
    await page.goto('/attendance/today');
    await page.getByPlaceholder('Name or ref. ID').fill(REF);
    const row = page.getByRole('row', { name: new RegExp(NAME) });
    await expect(row).toBeVisible();
    await expect(row.getByText(/\d{2}:\d{2} (AM|PM)/).first()).toBeVisible();

    await page.goto('/reports/daily');
    await expect(page.getByRole('heading', { name: 'Daily Attendance Report' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: REF })).toBeVisible();
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF' }).click()]);
    expect(pdf.suggestedFilename()).toMatch(/nsut-daily-report-.*\.pdf$/);
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV' }).click()]);
    expect(csv.suggestedFilename()).toMatch(/\.csv$/);
    const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel' }).click()]);
    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test('8. the person submits a leave request', async ({ page }) => {
    await signIn(page, EMAIL, PASSWORD);
    await page.goto('/leave');
    await page.getByRole('button', { name: 'Apply for leave' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('From date').fill(nextMonday.toISODate()!);
    await dlg.getByLabel('To date').fill(nextMonday.plus({ days: 1 }).toISODate()!);
    await dlg.getByLabel('Leave type').selectOption('MEDICAL');
    await dlg.getByLabel('Reason').fill('Scheduled medical appointment');
    await dlg.getByRole('button', { name: 'Submit request' }).click();
    await expect(page.getByText('Leave request submitted')).toBeVisible();
    await expect(page.getByRole('row', { name: /Scheduled medical appointment/ }).getByText('Pending')).toBeVisible();
  });

  test('9–10. admin approves the leave and it appears in attendance', async ({ page }) => {
    await signIn(page, ADMIN.email, ADMIN.password);
    await page.goto('/leave?status=PENDING');
    const row = page.getByRole('row', { name: new RegExp(NAME) });
    await row.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/2 working day\(s\) marked as leave/)).toBeVisible();

    const id = personUrl.split('/').pop();
    await page.goto(`/attendance/calendar?personId=${id}&year=${nextMonday.year}&month=${nextMonday.month}`);
    const cell = page.getByRole('gridcell', { name: new RegExp(`^${nextMonday.toFormat('d MMMM')}: On Leave`) });
    await expect(cell).toBeVisible();
    await cell.click();
    await expect(page.getByRole('dialog').getByText('Approved leave')).toBeVisible();
  });

  test('audit trail records the whole flow', async ({ page }) => {
    await signIn(page, ADMIN.email, ADMIN.password);
    await page.goto(`/audit?q=${encodeURIComponent('E2E-Verma')}`);
    for (const action of ['PERSON_CREATE', 'ATTENDANCE_CHECK_IN', 'ATTENDANCE_CHECK_OUT', 'LEAVE_SUBMIT', 'LEAVE_APPROVE']) {
      await expect(page.getByText(action, { exact: true }).first()).toBeVisible();
    }
  });
});

test.describe('access control and responsive layout', () => {
  test('staff cannot open admin pages', async ({ page }) => {
    await signIn(page, 'coach01.rajesh@demo.invalid', 'Demo@12345');
    await expect(page.getByRole('heading', { name: 'My Attendance' })).toBeVisible();
    await page.goto('/admin/users');
    await expect(page.getByText('You do not have permission to view this page.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Audit Logs' })).toHaveCount(0);
  });

  test('unauthenticated users are redirected to sign in', async ({ page }) => {
    await page.goto('/attendance/today');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('mobile: navigation becomes a drawer and tables become cards', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'officer@demo.invalid', 'Demo@12345');
    await expect(page.getByRole('heading', { name: /Attendance Overview/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: "Today's Attendance" }).click();
    await expect(page.getByRole('heading', { name: "Today's Attendance" })).toBeVisible();
    await expect(page.locator('table')).toBeHidden();
    await expect(page.locator('ul li dl').first()).toBeVisible();
  });
});
