import type { AppConfig } from '@/types/config';

interface StartupDesktopIntegrationLogger {
  info: (message: string) => void;
}

export function prepareStartupDesktopIntegration(input: {
  config: AppConfig;
  isPackagedE2E: boolean;
  logger: StartupDesktopIntegrationLogger;
  syncAutoStart: (config: AppConfig) => void;
  detectAutoStartLaunch: () => boolean;
  ensureVisibleWindowsUninstallLauncher: () => void;
}): {
  shouldStartHidden: boolean;
} {
  const {
    config,
    isPackagedE2E,
    logger,
    syncAutoStart,
    detectAutoStartLaunch,
    ensureVisibleWindowsUninstallLauncher,
  } = input;

  if (isPackagedE2E) {
    logger.info('Skipping desktop integration startup side effects in E2E package');
    return { shouldStartHidden: false };
  }

  syncAutoStart(config);
  ensureVisibleWindowsUninstallLauncher();

  const shouldStartHidden = detectAutoStartLaunch() && config.auto_startup;
  if (shouldStartHidden) {
    logger.info('Startup: Auto-start detected, window will start hidden');
  }

  return { shouldStartHidden };
}
