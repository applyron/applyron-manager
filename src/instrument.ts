import { app } from 'electron';
import fs from 'fs';
import { getManagerConfigPath, MANAGER_PRODUCT_SLUG } from './config/managerBrand';
import { isErrorReportingEnabled } from './utils/errorReporting';
import { logger } from './utils/logger';
import { ServiceHealthRegistry } from './services/ServiceHealthRegistry';

export function getQuickConfig() {
  try {
    const configPath = getManagerConfigPath('gui_config.json');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      return isErrorReportingEnabled(config);
    }
  } catch (e) {
    logger.error('Failed to read config for Sentry init:', e);
  }
  return false;
}

export async function initializeErrorReporting() {
  if (!getQuickConfig()) {
    logger.setErrorReportingEnabled(false);
    logger.setSentryReporter(null);
    ServiceHealthRegistry.markIdle('monitoring', 'Anonymous error reporting is disabled.');
    return;
  }

  if (app.isPackaged && !process.env.SENTRY_DSN) {
    const message = 'Anonymous error reporting is enabled, but SENTRY_DSN is missing.';
    logger.error(message);
    logger.setErrorReportingEnabled(false);
    logger.setSentryReporter(null);
    ServiceHealthRegistry.markError('monitoring', message);
    return;
  }

  try {
    const Sentry = await import('@sentry/electron/main');

    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      release: `${MANAGER_PRODUCT_SLUG}@${app.getVersion()}`,
      beforeSend(event) {
        if (event.exception?.values?.[0]?.value) {
          event.exception.values[0].value = event.exception.values[0].value.replace(
            /Users\\\\[^\\\\]+/g,
            'Users\\\\***',
          );
        }
        return event;
      },
    });
    logger.setErrorReportingEnabled(true);
    ServiceHealthRegistry.markReady('monitoring', 'Anonymous error reporting is enabled.');
    logger.setSentryReporter((payload) => {
      Sentry.withScope((scope) => {
        scope.setTag('log_level', payload.level);
        scope.setContext('recent_logs', {
          entries: payload.logs.map((entry) => ({
            timestamp: new Date(entry.timestamp).toISOString(),
            level: entry.level,
            message: entry.message,
            formatted: entry.formatted,
          })),
        });
        scope.setExtra('log_message', payload.message);
        if (payload.error) {
          Sentry.captureException(payload.error);
          return;
        }
        Sentry.captureMessage(payload.message, 'error');
      });
    });
  } catch (error) {
    logger.error('Failed to initialize Sentry', error);
    logger.setErrorReportingEnabled(false);
    logger.setSentryReporter(null);
    ServiceHealthRegistry.markError(
      'monitoring',
      error instanceof Error ? error.message : 'Failed to initialize Sentry.',
    );
  }
}

export const initializeErrorReportingPromise = initializeErrorReporting();
