import { expect, test } from '@playwright/test';
import {
  closeElectronApp,
  launchPackagedElectronApp,
  waitForPackagedFirstWindow,
} from '../helpers/electron';

test('benchmark smoke opens settings from the sidebar', async () => {
  const electronApp = await launchPackagedElectronApp();

  try {
    const page = await waitForPackagedFirstWindow(electronApp);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('a[href="/settings"]').first()).toBeVisible({ timeout: 15000 });
    await page.click('a[href="/settings"]');
    await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 15000 });
  } finally {
    await closeElectronApp(electronApp);
  }
});
