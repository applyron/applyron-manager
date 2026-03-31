import { describe, expect, it, vi } from 'vitest';
import {
  ensureVisibleWindowsUninstallLauncher,
  getWindowsSquirrelPaths,
  isWindowsUninstallLauncherExecution,
} from '@/main/windowsInstall';

describe('windows install helpers', () => {
  it('builds squirrel paths from the current executable path', () => {
    const paths = getWindowsSquirrelPaths('C:\\Program Files\\Applyron\\applyron-manager.exe');

    expect(paths.installDirectory).toBe('C:\\Program Files\\Applyron');
    expect(paths.updateExecutablePath).toBe('C:\\Program Files\\Applyron\\Update.exe');
    expect(paths.uninstallLauncherPath).toBe('C:\\Program Files\\Applyron\\Uninstall.exe');
  });

  it('detects uninstall launcher execution only on packaged Windows builds', () => {
    expect(
      isWindowsUninstallLauncherExecution({
        platform: 'win32',
        isPackaged: true,
        execPath: 'C:\\Program Files\\Applyron\\Uninstall.exe',
      }),
    ).toBe(true);

    expect(
      isWindowsUninstallLauncherExecution({
        platform: 'darwin',
        isPackaged: true,
        execPath: '/Applications/Uninstall.exe',
      }),
    ).toBe(false);
  });

  it('copies a visible uninstall launcher when the update executable exists', () => {
    const copyFileSync = vi.fn();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    ensureVisibleWindowsUninstallLauncher({
      platform: 'win32',
      isPackaged: true,
      execPath: 'C:\\Program Files\\Applyron\\applyron-manager.exe',
      existsSync: (targetPath) => targetPath.endsWith('Update.exe'),
      statSync: () => ({ size: 10 }),
      copyFileSync,
      logger,
    });

    expect(copyFileSync).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
