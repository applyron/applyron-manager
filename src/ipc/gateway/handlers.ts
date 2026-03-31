/**
 * Gateway IPC Handlers
 * Provides ORPC handlers for controlling the API Gateway service (NestJS version)
 */
import {
  bootstrapNestServer,
  stopNestServer,
  getNestServerStatus,
  getNestServerDiagnostics,
} from '../../server/main';
import { ConfigManager } from '../config/manager';
import { logger } from '../../utils/logger';
import { ensureProxyApiKeyInAppConfig, generateProxyApiKey } from '../../utils/proxyApiKey';
import { ActivityLogService } from '../../services/ActivityLogService';

/**
 * Start the gateway server (NestJS)
 */
export const startGateway = async (port: number): Promise<boolean> => {
  try {
    // Stop if already running
    await stopNestServer();

    // Load full config, enforce a persisted API key, and start NestJS server.
    const config = ensureProxyApiKeyInAppConfig(ConfigManager.loadConfig());
    const nextConfig = {
      ...config,
      proxy: {
        ...config.proxy,
        port,
      },
    };
    await ConfigManager.saveConfig(nextConfig);

    const started = await bootstrapNestServer(nextConfig.proxy);
    if (!started) {
      throw new Error('PROXY_START_FAILED|API proxy could not be started.');
    }
    ActivityLogService.record({
      category: 'proxy',
      action: 'start',
      target: `127.0.0.1:${port}`,
      outcome: 'success',
      message: `Proxy started on port ${port}.`,
      metadata: { port },
    });
    return true;
  } catch (e) {
    logger.error('Failed to start gateway:', e);
    ActivityLogService.record({
      category: 'proxy',
      action: 'start',
      target: `127.0.0.1:${port}`,
      outcome: 'failure',
      message: e instanceof Error ? e.message : 'Proxy start failed.',
      metadata: { port },
    });
    const errno = e as NodeJS.ErrnoException;
    if (errno.code === 'EADDRINUSE') {
      throw new Error('PROXY_PORT_IN_USE|API proxy port is already in use.');
    }
    throw e;
  }
};

/**
 * Stop the gateway server (NestJS)
 */
export const stopGateway = async (): Promise<boolean> => {
  try {
    const success = await stopNestServer();
    ActivityLogService.record({
      category: 'proxy',
      action: 'stop',
      target: 'proxy',
      outcome: success ? 'success' : 'failure',
      message: success ? 'Proxy stopped.' : 'Proxy stop failed.',
    });
    return success;
  } catch (e) {
    logger.error('Failed to stop gateway:', e);
    ActivityLogService.record({
      category: 'proxy',
      action: 'stop',
      target: 'proxy',
      outcome: 'failure',
      message: e instanceof Error ? e.message : 'Proxy stop failed.',
    });
    return false;
  }
};

/**
 * Get gateway status (NestJS)
 */
export const getGatewayStatus = async () => {
  return getNestServerStatus();
};

export const getGatewayDiagnostics = async () => {
  return getNestServerDiagnostics();
};

/**
 * Generate a new API key
 */
export const generateApiKey = async (): Promise<string> => {
  const newKey = generateProxyApiKey();

  // Save to config
  const config = ConfigManager.loadConfig();
  await ConfigManager.saveConfig({
    ...config,
    proxy: {
      ...config.proxy,
      api_key: newKey,
    },
  });

  ActivityLogService.record({
    category: 'proxy',
    action: 'generate-key',
    target: 'proxy',
    outcome: 'success',
    message: 'Proxy API key regenerated.',
  });

  return newKey;
};
