import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  closeElectronApp,
  launchPackagedElectronApp,
  waitForPackagedFirstWindow,
} from './helpers/electron';

let electronApp: ElectronApplication | undefined;

async function waitForShell(page: Page) {
  await expect(page.locator('aside')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('a[href="/proxy"]').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('a[href="/settings"]').first()).toBeVisible({ timeout: 15000 });
}

test.beforeAll(async () => {
  electronApp = await launchPackagedElectronApp();
});

test.afterAll(async () => {
  await closeElectronApp(electronApp);
  electronApp = undefined;
});

test('renders the application shell', async () => {
  const page: Page = await waitForPackagedFirstWindow(electronApp!);

  await page.waitForLoadState('domcontentloaded');
  await waitForShell(page);
  await expect(page.locator('text=Applyron').first()).toBeVisible();
  await expect(page).toHaveTitle('Applyron Manager');
});
