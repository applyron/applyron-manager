import { test, expect, type ElectronApplication } from '@playwright/test';
import {
  closeElectronApp,
  launchPackagedElectronApp,
  launchPackagedElectronAppWithOptions,
  waitForPackagedFirstWindow,
} from './helpers/electron';

async function waitForShell(window: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  await expect(window.locator('aside')).toBeVisible({ timeout: 15000 });
  await expect(window.locator('main')).toBeVisible({ timeout: 15000 });
  await expect(window.locator('a[href="/settings"]').first()).toBeVisible({ timeout: 15000 });
}

test.describe('Applyron Manager', () => {
  test.describe.configure({ mode: 'serial' });
  let electronApp: ElectronApplication | undefined;

  test.beforeAll(async () => {
    electronApp = await launchPackagedElectronApp();
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
    electronApp = undefined;
  });

  test('should launch and display home page', async () => {
    const window = await waitForPackagedFirstWindow(electronApp!);
    await window.waitForLoadState('domcontentloaded');

    const title = await window.title();
    expect(title).toBe('Applyron Manager');

    await waitForShell(window);
  });

  test('should navigate to settings', async () => {
    const window = await waitForPackagedFirstWindow(electronApp!);
    await waitForShell(window);

    // Click settings link (use data-testid or aria-label for reliability)
    await window.click('a[href="/settings"]');
    await window.waitForLoadState('domcontentloaded');

    // Check settings page has content (i18n-agnostic)
    await expect(window.locator('h2').first()).toBeVisible({ timeout: 15000 });
  });

  test.fixme('should show fallback UI when cloud accounts loading fails', async () => {
    await closeElectronApp(electronApp);

    electronApp = await launchPackagedElectronAppWithOptions({
      env: {
        APPLYRON_E2E_ORPC_MODE: 'cloudAccountsFailure',
      },
      args: ['--applyron-e2e-orpc-mode=cloudAccountsFailure'],
    });
    const page = await waitForPackagedFirstWindow(electronApp);
    await page.waitForLoadState('domcontentloaded');
    await waitForShell(page);
    await expect
      .poll(async () => {
        return await page.evaluate(() => window.electronTest?.getOrpcTestMode?.() ?? null);
      })
      .toBe('cloudAccountsFailure');
    await page.click('a[href="/accounts"]');
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('tab', { name: /Gemini/i }).click();
    const mainContent = page.locator('main');
    await expect(mainContent.getByTestId('cloud-load-error-fallback')).toBeVisible({
      timeout: 15000,
    });
    await expect(mainContent.getByTestId('cloud-load-error-retry')).toBeVisible();
  });

  // More detailed tests would require mocking IPC or having a real environment
  // For now, we verify basic navigation and rendering
});
