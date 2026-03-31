import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { logger } from '../utils/logger';
import { TokenManagerService } from './modules/proxy/token-manager.service';
import { ProxyMetricsRegistry } from './modules/proxy/proxy-metrics.registry';

import { ProxyConfig } from '../types/config';
import { setServerConfig } from './server-config';
import { ServiceHealthRegistry } from '../services/ServiceHealthRegistry';
import { hasProxyApiKey } from '../utils/proxyApiKey';
import type { ProxyDiagnosticsSnapshot } from '../types/operations';

let app: NestFastifyApplication | null = null;
let currentPort: number = 0;
const LOOPBACK_PROXY_HOST = '127.0.0.1';

export function isAllowedLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin || origin.trim() === '') {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === LOOPBACK_PROXY_HOST)
    );
  } catch {
    return false;
  }
}

export async function bootstrapNestServer(config: ProxyConfig): Promise<boolean> {
  const port = config.port || 8045;
  if (app) {
    logger.info('NestJS server already running.');
    ServiceHealthRegistry.markReady('proxy_server', `Listening on port ${currentPort || port}.`);
    return true;
  }

  if (!hasProxyApiKey(config.api_key)) {
    const message = 'Proxy API key is missing. Generate a key before starting the API proxy.';
    logger.error(message);
    ServiceHealthRegistry.markError('proxy_server', message);
    return false;
  }

  setServerConfig(config);
  ServiceHealthRegistry.markStarting('proxy_server', `Starting API proxy on port ${port}.`);

  try {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: ['error', 'warn', 'log'],
    });

    app.enableCors({
      origin(origin, callback) {
        if (isAllowedLoopbackOrigin(origin)) {
          callback(null, true);
          return;
        }

        logger.warn(`Rejected proxy CORS origin: ${origin}`);
        callback(new Error('Proxy CORS origin is not allowed.'), false);
      },
    });

    await app.listen(port, LOOPBACK_PROXY_HOST);
    app.get(ProxyMetricsRegistry).reset();
    currentPort = port;
    logger.info(`NestJS Proxy Server running on http://${LOOPBACK_PROXY_HOST}:${port}`);
    ServiceHealthRegistry.markReady('proxy_server', `Listening on port ${port}.`);
    return true;
  } catch (error) {
    logger.error('Failed to start NestJS server', error);
    ServiceHealthRegistry.markError(
      'proxy_server',
      error instanceof Error ? error.message : `Failed to start on port ${port}.`,
    );
    throw error;
  }
}

export async function stopNestServer(): Promise<boolean> {
  if (app) {
    try {
      await app.close();
      app = null;
      currentPort = 0;
      logger.info('NestJS server stopped.');
      ServiceHealthRegistry.markIdle('proxy_server', null);
      return true;
    } catch (e) {
      logger.error('Failed to stop NestJS server', e);
      ServiceHealthRegistry.markError(
        'proxy_server',
        e instanceof Error ? e.message : 'Failed to stop API proxy.',
      );
      return false;
    }
  }
  ServiceHealthRegistry.markIdle('proxy_server', null);
  return true;
}

export function isNestServerRunning(): boolean {
  return app !== null;
}

export async function getNestServerStatus(): Promise<{
  running: boolean;
  port: number;
  base_url: string;
  active_accounts: number;
}> {
  const running = isNestServerRunning();
  let activeAccounts = 0;

  if (app) {
    try {
      const tokenManager = app.get(TokenManagerService);
      activeAccounts = tokenManager.getAccountCount();
    } catch {
      // TokenManager might not be available
    }
  }

  return {
    running,
    port: currentPort,
    base_url: running ? `http://${LOOPBACK_PROXY_HOST}:${currentPort}` : '',
    active_accounts: activeAccounts,
  };
}

export async function getNestServerDiagnostics(): Promise<ProxyDiagnosticsSnapshot> {
  const status = await getNestServerStatus();
  const serviceHealth = ServiceHealthRegistry.getItem('proxy_server');

  if (!app) {
    return {
      status,
      serviceHealth,
      metrics: {
        totalRequests: 0,
        successResponses: 0,
        errorResponses: 0,
        capacityRejects: 0,
        rateLimitEvents: 0,
        streamRequests: 0,
        avgLatencyMs: 0,
        lastRequestAt: null,
        lastError: null,
        modelBreakdown: {},
      },
      capacity: {
        reason: null,
        retryAfterSec: null,
      },
      rateLimits: {
        cooldownCount: 0,
        upstreamLockCount: 0,
        reasonSummary: {},
        nextRetryAt: null,
        nextRetrySec: null,
      },
      parity: {
        enabled: false,
        shadowEnabled: false,
        noGoBlocked: false,
        shadowComparisonCount: 0,
        shadowMismatchCount: 0,
        parityRequestCount: 0,
        parityErrorCount: 0,
      },
    };
  }

  const tokenManager = app.get(TokenManagerService);
  const metricsRegistry = app.get(ProxyMetricsRegistry);

  return {
    status,
    serviceHealth,
    metrics: metricsRegistry.getSnapshot(),
    capacity: tokenManager.getCapacitySnapshot(),
    rateLimits: tokenManager.getRateLimitSummary(),
    parity: tokenManager.getParitySummary(),
  };
}
