import { expect, test } from '@playwright/test';
import {
  closeElectronApp,
  launchPackagedElectronApp,
  waitForPackagedFirstWindow,
} from '../helpers/electron';

test('benchmark smoke opens the dashboard shell', async () => {
  const electronApp = await launchPackagedElectronApp();

  try {
    const page = await waitForPackagedFirstWindow(electronApp);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('aside')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('a[href="/accounts"]').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('dashboard-service-health')).toBeVisible({ timeout: 15000 });
  } finally {
    await closeElectronApp(electronApp);
  }
});
