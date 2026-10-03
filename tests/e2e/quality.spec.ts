import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Demo@12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  if (serious.length) console.log(JSON.stringify(serious.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target) })), null, 1));
  return serious;
}

test.describe('accessibility (axe, WCAG 2 A/AA — serious & critical)', () => {
  test('login page', async ({ page }) => {
    await page.goto('/login');
    expect(await axe(page)).toEqual([]);
  });
  for (const path of ['/', '/attendance/today', '/attendance/monthly', '/leave?status=PENDING', '/reports/monthly', '/admin/rules']) {
    test(`admin ${path}`, async ({ page }) => {
      await signIn(page, 'superadmin@demo.invalid');
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(await axe(page)).toEqual([]);
    });
  }
  test('staff /me', async ({ page }) => {
    await signIn(page, 'coach01.rajesh@demo.invalid');
    await page.waitForLoadState('networkidle');
    expect(await axe(page)).toEqual([]);
  });
  test('keyboard: skip link and focusable navigation', async ({ page }) => {
    await signIn(page, 'officer@demo.invalid');
    await page.goto('/attendance/today');
    await expect(page.getByRole('heading', { name: "Today's Attendance" })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });
});

test('print view hides navigation and controls and keeps the report', async ({ page }) => {
  await signIn(page, 'officer@demo.invalid');
  await page.goto('/reports/monthly');
  await expect(page.getByRole('heading', { name: 'Monthly Attendance Report' }).first()).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'PDF' })).toBeHidden();
  await expect(page.getByRole('group', { name: 'Filters' })).toBeHidden();
  await expect(page.getByText('Guest Faculty & Sports Coach Attendance Report')).toBeVisible();
  await expect(page.getByText('Signature of Authorized Officer')).toBeVisible();
  await expect(page.locator('article table')).toBeVisible();
  await page.screenshot({ path: 'test-results/print-monthly.png', fullPage: true });
  const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
});
