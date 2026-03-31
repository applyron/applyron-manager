import type { AppConfig } from '../types/config';
import { ConfigManager } from '../ipc/config/manager';
import { findBestCodexAutoSwitchCandidate, getCodexHealthState } from '../managedIde/codexHealth';
import { ManagedIdeService } from '../managedIde/service';
import { logger } from '../utils/logger';
import { isPackagedE2EEnvironment } from '../utils/runtimeMode';

export class CodexAutoSwitchService {
  private static intervalId: NodeJS.Timeout | null = null;
  private static readonly POLL_INTERVAL_MS = 60_000;
  private static isPolling = false;

  static resetStateForTesting() {
    this.isPolling = false;
    this.stop();
  }

  static async syncWithConfig(config?: AppConfig): Promise<void> {
    const resolvedConfig = config ?? ConfigManager.loadConfig();

    if (isPackagedE2EEnvironment()) {
      if (resolvedConfig.codex_auto_switch_enabled) {
        logger.info('Codex auto-switch enabled during E2E package run; skipping service start.');
      }
      this.stop();
      return;
    }

    if (resolvedConfig.codex_auto_switch_enabled) {
      this.start();
      return;
    }

    this.stop();
  }

  static start() {
    if (this.intervalId) {
      return;
    }

    logger.info('Starting CodexAutoSwitchService...');
    void this.poll().catch((error) => logger.error('Initial Codex auto-switch poll failed', error));

    this.intervalId = setInterval(() => {
      void this.poll().catch((error) =>
        logger.error('Scheduled Codex auto-switch poll failed', error),
      );
    }, this.POLL_INTERVAL_MS);
  }

  static stop() {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = null;
    logger.info('Stopped CodexAutoSwitchService');
  }

  static async poll(): Promise<boolean> {
    if (this.isPolling) {
      return false;
    }

    if (!ConfigManager.loadConfig().codex_auto_switch_enabled) {
      return false;
    }

    this.isPolling = true;

    try {
      const currentStatus = await ManagedIdeService.getCurrentStatus({
        targetId: 'vscode-codex',
        refresh: true,
      });
      if (!currentStatus.installation.available) {
        logger.info('Codex auto-switch skipped because VS Code Codex is unavailable.');
        return false;
      }

      const accounts = await ManagedIdeService.refreshAllCodexAccounts();
      const activeAccount = accounts.find((account) => account.isActive);
      if (!activeAccount) {
        logger.info('Codex auto-switch skipped because there is no active pooled account.');
        return false;
      }

      const activeHealth = getCodexHealthState(activeAccount);
      if (activeHealth === 'ready') {
        return false;
      }

      const nextAccount = findBestCodexAutoSwitchCandidate(accounts, activeAccount.id);
      if (!nextAccount) {
        logger.info('Codex auto-switch found no healthy standby account.');
        return false;
      }

      logger.info(
        `Codex auto-switch: switching from ${activeAccount.id} (${activeHealth}) to ${nextAccount.id}.`,
      );
      await ManagedIdeService.activateCodexAccount(nextAccount.id);
      return true;
    } catch (error) {
      logger.error('Codex auto-switch poll failed', error);
      return false;
    } finally {
      this.isPolling = false;
    }
  }
}
