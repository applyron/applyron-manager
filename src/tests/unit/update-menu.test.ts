import { describe, expect, it, vi } from 'vitest';
import type { AppUpdateStatus } from '@/types/dashboard';
import { getTrayTexts } from '@/ipc/tray/i18n';
import { buildUpdateMenuItems } from '@/ipc/tray/updateMenu';

function createStatus(status: AppUpdateStatus['status'], overrides: Partial<AppUpdateStatus> = {}) {
  return {
    status,
    currentVersion: '0.10.0',
    latestVersion: '0.10.1',
    lastCheckedAt: Date.now(),
    message: null,
    ...overrides,
  } satisfies AppUpdateStatus;
}

describe('buildUpdateMenuItems', () => {
  it('returns no tray update section for idle and up-to-date states', () => {
    const texts = getTrayTexts('en');
    const onRestart = vi.fn();

    expect(buildUpdateMenuItems(createStatus('idle'), texts, onRestart)).toEqual([]);
    expect(buildUpdateMenuItems(createStatus('up_to_date'), texts, onRestart)).toEqual([]);
  });

  it('builds a disabled downloading section while an update is still arriving', () => {
    const texts = getTrayTexts('en');

    const items = buildUpdateMenuItems(createStatus('update_available'), texts, vi.fn());

    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      label: 'Update: Downloading update (0.10.1)',
      enabled: false,
    });
  });

  it('builds a restart action once the update is ready to install', async () => {
    const texts = getTrayTexts('en');
    const onRestart = vi.fn();
    const items = buildUpdateMenuItems(createStatus('ready_to_install'), texts, onRestart);
    const restartItem = items.find(
      (item) => 'label' in item && item.label === 'Restart and install',
    );

    expect(restartItem).toBeTruthy();
    await restartItem?.click?.(
      {} as Electron.MenuItem,
      {} as Electron.BrowserWindow,
      {} as KeyboardEvent,
    );

    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('shows the error message line when update status enters an error state', () => {
    const texts = getTrayTexts('en');
    const items = buildUpdateMenuItems(
      createStatus('error', {
        message: 'Updater endpoint returned 503 Service Unavailable',
      }),
      texts,
      vi.fn(),
    );

    expect(items[1]).toMatchObject({
      label: 'Update: Update error',
      enabled: false,
    });
    expect(items[2]).toMatchObject({
      label: 'Updater endpoint returned 503 Service Unavailable',
      enabled: false,
    });
  });
});
