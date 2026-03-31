import fs from 'fs';
import path from 'path';
import {
  AppConfig,
  AppConfigSchema,
  DEFAULT_APP_CONFIG,
  normalizeGridLayout,
} from '../../types/config';
import { getManagerConfigPath } from '../../config/managerBrand';
import { logger } from '../../utils/logger';
import { DEFAULT_APP_LANGUAGE, normalizeAppLanguage } from '../../utils/language';
import { ServiceHealthRegistry } from '../../services/ServiceHealthRegistry';
import { ensureProxyApiKeyInAppConfig } from '../../utils/proxyApiKey';
import { resolveDefaultProjectId } from '../../utils/projectId';

const CONFIG_FILENAME = 'gui_config.json';

export class ConfigManager {
  private static cachedConfig: AppConfig | null = null;
  private static saveQueue: Promise<void> = Promise.resolve();
  private static recoveryMessage: string | null = null;

  private static getConfigPath(): string {
    return getManagerConfigPath(CONFIG_FILENAME);
  }

  private static normalizeConfig(config: AppConfig): AppConfig {
    const normalized = ensureProxyApiKeyInAppConfig({
      ...config,
      language: normalizeAppLanguage(config.language, DEFAULT_APP_LANGUAGE),
      grid_layout: normalizeGridLayout(config.grid_layout),
      proxy: {
        ...config.proxy,
        default_project_id: resolveDefaultProjectId(config.proxy.default_project_id),
        upstream_proxy: {
          ...config.proxy.upstream_proxy,
        },
      },
    });

    return normalized;
  }

  private static persistConfigSync(configPath: string, config: AppConfig): void {
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      logger.warn('Config: Failed to persist normalized config synchronously', error);
    }
  }

  static loadConfig(): AppConfig {
    const configPath = this.getConfigPath();

    try {
      if (!fs.existsSync(configPath)) {
        logger.info(`Config: File not found at ${configPath}, returning default`);
        const defaultConfig = this.normalizeConfig(DEFAULT_APP_CONFIG);
        this.persistConfigSync(configPath, defaultConfig);
        this.cachedConfig = defaultConfig;
        if (this.recoveryMessage) {
          ServiceHealthRegistry.markError('config', this.recoveryMessage);
        } else {
          ServiceHealthRegistry.markReady('config', null);
        }
        return defaultConfig;
      }

      const content = fs.readFileSync(configPath, 'utf-8');
      const raw = JSON.parse(content);

      // Merge with default to ensure new fields are present
      // Zod parse helps validate
      const merged = AppConfigSchema.parse({
        ...DEFAULT_APP_CONFIG,
        ...raw,
        proxy: { ...DEFAULT_APP_CONFIG.proxy, ...(raw.proxy || {}) },
      });
      // Fix deep merge for upstream_proxy if needed
      if (raw.proxy && raw.proxy.upstream_proxy) {
        merged.proxy.upstream_proxy = {
          ...DEFAULT_APP_CONFIG.proxy.upstream_proxy,
          ...raw.proxy.upstream_proxy,
        };
      }

      // Handle Anthropic Mapping Map vs Object
      // In JSON it's object

      const normalizedConfig = this.normalizeConfig(merged);
      if (normalizedConfig.proxy.api_key !== merged.proxy.api_key) {
        this.persistConfigSync(configPath, normalizedConfig);
      }

      this.cachedConfig = normalizedConfig;
      this.recoveryMessage = null;
      ServiceHealthRegistry.markReady('config', null);
      return normalizedConfig;
    } catch (e) {
      logger.error('Config: Failed to load config', e);
      const backupPath = this.backupInvalidConfig(configPath);
      this.recoveryMessage = backupPath
        ? `Recovered from an invalid config backup: ${path.basename(backupPath)}`
        : 'Recovered from an invalid config by falling back to defaults.';
      ServiceHealthRegistry.markError('config', this.recoveryMessage);
      const fallbackConfig = this.normalizeConfig(DEFAULT_APP_CONFIG);
      this.persistConfigSync(configPath, fallbackConfig);
      this.cachedConfig = fallbackConfig;
      return fallbackConfig;
    }
  }

  static getCachedConfig(): AppConfig | null {
    return this.cachedConfig;
  }

  static async saveConfig(config: AppConfig): Promise<void> {
    const configPath = this.getConfigPath();
    const normalizedConfig = this.normalizeConfig(config);
    const content = JSON.stringify(normalizedConfig, null, 2);

    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(async () => {
        await fs.promises.writeFile(configPath, content, 'utf-8');
        this.cachedConfig = normalizedConfig;
        this.recoveryMessage = null;
        ServiceHealthRegistry.markReady('config', null);
        logger.info(`Config: Saved to ${configPath}`);
      })
      .catch((e) => {
        logger.error('Config: Failed to save config', e);
        throw e;
      });

    return this.saveQueue;
  }

  private static backupInvalidConfig(configPath: string): string | null {
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${configPath}.${timestamp}.invalid.json`;

    try {
      fs.renameSync(configPath, backupPath);
      logger.warn(`Config: Moved invalid config to ${backupPath}`);
      return backupPath;
    } catch (renameError) {
      logger.warn('Config: Failed to move invalid config, attempting copy fallback', renameError);

      try {
        fs.copyFileSync(configPath, backupPath);
        fs.unlinkSync(configPath);
        logger.warn(`Config: Copied invalid config to ${backupPath}`);
        return backupPath;
      } catch (copyError) {
        logger.error('Config: Failed to backup invalid config', copyError);
        return null;
      }
    }
  }
}
