import type { CloudAccount } from '../types/cloudAccount';
import { CloudAccountRepo } from '../ipc/database/cloudHandler';
import { GoogleAPIService } from './GoogleAPIService';
import { AutoSwitchService } from './AutoSwitchService';
import { logger } from '../utils/logger';
import { ServiceHealthRegistry } from './ServiceHealthRegistry';
import { hasOperationalQuotaChange } from '../utils/cloudQuotaFingerprint';
import { runWithConcurrencyLimit } from '../utils/concurrency';
import { normalizeProjectId } from '../utils/projectId';

export class CloudMonitorService {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly pollIntervalMs = 1000 * 60 * 5;
  private readonly debounceTimeMs = 10000;
  private readonly pollConcurrency = 4;
  private readonly tokenRefreshLeadSeconds = 600;
  private lastFocusTime = 0;
  private isPolling = false;

  resetStateForTesting() {
    this.lastFocusTime = 0;
    this.isPolling = false;
    this.stop();
  }

  start() {
    if (this.intervalId) {
      return;
    }

    logger.info('Starting CloudMonitorService...');
    ServiceHealthRegistry.markStarting('cloud_monitor', 'Preparing Antigravity quota monitor.');
    this.lastFocusTime = Date.now();

    void this.poll({ trigger: 'scheduled' }).catch((error) =>
      logger.error('Initial poll failed', error),
    );

    this.startInterval();
    ServiceHealthRegistry.markReady('cloud_monitor', 'Antigravity quota monitor is running.');
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Stopped CloudMonitorService');
    }

    ServiceHealthRegistry.markIdle('cloud_monitor', null);
  }

  async handleAppFocus() {
    const now = Date.now();

    if (this.isPolling) {
      logger.info('Monitor: App focused, but polling is already in progress. Skipping.');
      return;
    }

    if (now - this.lastFocusTime < this.debounceTimeMs) {
      logger.info('Monitor: App focused, skipping poll (debounce active).');
      return;
    }

    logger.info('Monitor: App focused, triggering immediate poll...');
    this.lastFocusTime = now;

    await this.poll({ trigger: 'focus' }).catch((error) => {
      logger.error('Monitor: Focus poll failed', error);
    });

    this.resetInterval();
  }

  async poll(options?: { trigger?: 'focus' | 'scheduled' }) {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;

    try {
      logger.info('CloudMonitor: Polling quotas...');
      const accounts = await CloudAccountRepo.getAccounts();
      const now = Math.floor(Date.now() / 1000);
      let failureCount = 0;

      await runWithConcurrencyLimit(accounts, this.pollConcurrency, async (account) => {
        try {
          await this.pollSingleAccount(account, now);
        } catch (error) {
          failureCount++;
          logger.error(`Monitor: Failed to update ${account.email}`, error);
        }
      });

      const autoSwitchResult = await AutoSwitchService.checkAndSwitchIfNeeded({
        trigger: options?.trigger ?? 'scheduled',
      });

      if (autoSwitchResult === 'deferred') {
        ServiceHealthRegistry.markDegraded(
          'cloud_monitor',
          'Auto-switch is deferred until the managed IDE is idle.',
        );
      } else if (failureCount > 0) {
        ServiceHealthRegistry.markDegraded(
          'cloud_monitor',
          `${failureCount} Antigravity account poll(s) failed; see logs for details.`,
        );
      } else {
        ServiceHealthRegistry.markReady('cloud_monitor', 'Antigravity quota monitor is healthy.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Antigravity quota poll failed.';
      ServiceHealthRegistry.markError('cloud_monitor', message);
      throw error;
    } finally {
      this.isPolling = false;
    }
  }

  private async pollSingleAccount(account: CloudAccount, nowSeconds: number): Promise<void> {
    const accessToken = await this.warmAccountState(account, nowSeconds);
    const quota = await GoogleAPIService.fetchQuota(accessToken, {
      projectId: normalizeProjectId(account.token.project_id),
      subscriptionTier: account.quota?.subscription_tier,
    });
    if (Object.keys(quota.models).length === 0) {
      logger.warn(
        `Monitor: Quota refresh for ${account.email} returned no valid models; keeping the previous snapshot.`,
      );
      return;
    }

    if (hasOperationalQuotaChange(account.quota, quota)) {
      await CloudAccountRepo.updateQuota(account.id, quota);
    }
  }

  private async warmAccountState(account: CloudAccount, nowSeconds: number): Promise<string> {
    const nextToken = {
      ...account.token,
    };
    let tokenChanged = false;

    if (nextToken.expiry_timestamp < nowSeconds + this.tokenRefreshLeadSeconds) {
      logger.info(`Monitor: Refreshing token for ${account.email}`);
      const newToken = await GoogleAPIService.refreshAccessToken(nextToken.refresh_token);
      nextToken.access_token = newToken.access_token;
      nextToken.expires_in = newToken.expires_in;
      nextToken.expiry_timestamp = nowSeconds + newToken.expires_in;
      tokenChanged = true;
    }

    if (!normalizeProjectId(nextToken.project_id)) {
      try {
        const resolvedProjectId = await GoogleAPIService.fetchProjectId(nextToken.access_token);
        const normalizedProjectId = normalizeProjectId(resolvedProjectId);
        if (normalizedProjectId) {
          nextToken.project_id = normalizedProjectId;
          tokenChanged = true;
        }
      } catch (error) {
        logger.warn(`Monitor: Failed to resolve project for ${account.email}`, error);
      }
    }

    if (tokenChanged) {
      await CloudAccountRepo.updateToken(account.id, nextToken);
      account.token = nextToken;
    }

    return nextToken.access_token;
  }

  private startInterval() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.intervalId = setInterval(() => {
      void this.poll({ trigger: 'scheduled' }).catch((error) =>
        logger.error('Scheduled poll failed', error),
      );
    }, this.pollIntervalMs);
  }

  private resetInterval() {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.startInterval();
  }
}

export const cloudMonitorService = new CloudMonitorService();
