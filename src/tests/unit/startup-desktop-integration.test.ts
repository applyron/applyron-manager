import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_CONFIG } from '@/types/config';
import { prepareStartupDesktopIntegration } from '@/main/startupDesktopIntegration';

describe('prepareStartupDesktopIntegration', () => {
  it('skips desktop integration side effects in packaged E2E mode', () => {
    const logger = {
      info: vi.fn(),
    };
    const syncAutoStart = vi.fn();
    const detectAutoStartLaunch = vi.fn(() => true);
    const ensureVisibleWindowsUninstallLauncher = vi.fn();

    const result = prepareStartupDesktopIntegration({
      config: DEFAULT_APP_CONFIG,
      isPackagedE2E: true,
      logger,
      syncAutoStart,
      detectAutoStartLaunch,
      ensureVisibleWindowsUninstallLauncher,
    });

    expect(result).toEqual({ shouldStartHidden: false });
    expect(syncAutoStart).not.toHaveBeenCalled();
    expect(detectAutoStartLaunch).not.toHaveBeenCalled();
    expect(ensureVisibleWindowsUninstallLauncher).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Skipping desktop integration startup side effects in E2E package',
    );
  });

  it('applies desktop integration side effects outside packaged E2E mode', () => {
    const logger = {
      info: vi.fn(),
    };
    const syncAutoStart = vi.fn();
    const detectAutoStartLaunch = vi.fn(() => true);
    const ensureVisibleWindowsUninstallLauncher = vi.fn();

    const result = prepareStartupDesktopIntegration({
      config: {
        ...DEFAULT_APP_CONFIG,
        auto_startup: true,
      },
      isPackagedE2E: false,
      logger,
      syncAutoStart,
      detectAutoStartLaunch,
      ensureVisibleWindowsUninstallLauncher,
    });

    expect(result).toEqual({ shouldStartHidden: true });
    expect(syncAutoStart).toHaveBeenCalledWith({
      ...DEFAULT_APP_CONFIG,
      auto_startup: true,
    });
    expect(detectAutoStartLaunch).toHaveBeenCalledTimes(1);
    expect(ensureVisibleWindowsUninstallLauncher).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'Startup: Auto-start detected, window will start hidden',
    );
  });
});
