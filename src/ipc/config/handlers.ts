import { AppConfig } from '../../types/config';
import { ConfigManager } from './manager';
import { syncAutoStart } from '../../utils/autoStart';
import { logger } from '../../utils/logger';
import { setServerConfig } from '../../server/server-config';
import { updateTrayMenu } from '../tray/handler';
import { CodexAutoSwitchService } from '../../services/CodexAutoSwitchService';
import { isErrorReportingEnabled } from '../../utils/errorReporting';

export function loadConfig(): AppConfig {
  return ConfigManager.loadConfig();
}

export async function saveConfig(config: AppConfig): Promise<void> {
  // Logic to notify proxy server if configuration changes (hot update)
  // Logic to update Tray if language changes
  // For now just save
  const previous = ConfigManager.getCachedConfig() ?? ConfigManager.loadConfig();
  await ConfigManager.saveConfig(config);
  const savedConfig = ConfigManager.getCachedConfig() ?? ConfigManager.loadConfig();
  setServerConfig(savedConfig.proxy);
  logger.setErrorReportingEnabled(isErrorReportingEnabled(savedConfig));
  if (previous.auto_startup !== config.auto_startup) {
    syncAutoStart(savedConfig);
  }

  if (
    previous.language !== savedConfig.language ||
    previous.managed_ide_target !== savedConfig.managed_ide_target
  ) {
    updateTrayMenu(undefined, savedConfig.language);
  }

  await CodexAutoSwitchService.syncWithConfig(savedConfig);
}
