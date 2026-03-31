import { ManagedIdeService } from '../managedIde/service';
import { logger } from '../utils/logger';
import { ServiceHealthRegistry } from './ServiceHealthRegistry';

export class CodexMonitorService {
  private static intervalId: NodeJS.Timeout | null = null;
  private static readonly POLL_INTERVAL_MS = 1000 * 60 * 5;
  private static readonly DEBOUNCE_TIME_MS = 10000;
  private static lastFocusTime = 0;
  private static isPolling = false;

  static resetStateForTesting() {
    this.lastFocusTime = 0;
    this.isPolling = false;
    this.stop();
  }

  static start() {
    if (this.intervalId) {
      return;
    }

    logger.info('Starting CodexMonitorService...');
    ServiceHealthRegistry.markStarting('codex_monitor', 'Preparing Codex monitor.');
    this.lastFocusTime = Date.now();

    void this.poll().catch((error) => logger.error('Initial Codex monitor poll failed', error));
    this.startInterval();
    ServiceHealthRegistry.markReady('codex_monitor', 'Codex monitor is running.');
  }

  static stop() {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = null;
    logger.info('Stopped CodexMonitorService');
    ServiceHealthRegistry.markIdle('codex_monitor', null);
  }

  static async handleAppFocus() {
    const now = Date.now();

    if (this.isPolling) {
      logger.info('CodexMonitor: App focused, but polling is already in progress. Skipping.');
      return;
    }

    if (now - this.lastFocusTime < this.DEBOUNCE_TIME_MS) {
      logger.info('CodexMonitor: App focused, skipping poll (debounce active).');
      return;
    }

    logger.info('CodexMonitor: App focused, triggering immediate poll...');
    this.lastFocusTime = now;

    await this.poll().catch((error) => {
      logger.error('CodexMonitor: Focus poll failed', error);
    });
    this.resetInterval();
  }

  private static startInterval() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.intervalId = setInterval(() => {
      void this.poll().catch((error) => logger.error('Scheduled Codex monitor poll failed', error));
    }, this.POLL_INTERVAL_MS);
  }

  private static resetInterval() {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.startInterval();
  }

  static async poll() {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;

    try {
      logger.info('CodexMonitor: Refreshing Codex status...');
      const currentStatus = await ManagedIdeService.getCurrentStatus({
        targetId: 'vscode-codex',
        refresh: true,
      });

      if (!currentStatus.installation.available) {
        logger.info('CodexMonitor: VS Code Codex is unavailable; skipping account refresh.');
        ServiceHealthRegistry.markIdle(
          'codex_monitor',
          'VS Code Codex is unavailable on this device.',
        );
        return;
      }

      logger.info('CodexMonitor: Refreshing pooled Codex accounts...');
      await ManagedIdeService.refreshAllCodexAccounts();
      ServiceHealthRegistry.markReady('codex_monitor', 'Codex monitor is healthy.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Codex monitor refresh failed.';
      ServiceHealthRegistry.markError('codex_monitor', message);
      throw error;
    } finally {
      this.isPolling = false;
    }
  }
}
