import { CloudAccountRepo } from '../ipc/database/cloudHandler';
import { CloudAccount } from '../types/cloudAccount';
import { switchCloudAccount } from '../ipc/cloud/handler';
import { isProcessRunning } from '../ipc/process/handler';
import { logger } from '../utils/logger';

export class AutoSwitchService {
  static async checkAndSwitchIfNeeded(options?: {
    trigger?: 'focus' | 'scheduled';
  }): Promise<'idle' | 'deferred' | 'switched'> {
    const trigger = options?.trigger ?? 'scheduled';
    const enabled = CloudAccountRepo.getSetting<boolean>('auto_switch_enabled', false);
    if (!enabled) return 'idle';

    const accounts = await CloudAccountRepo.getAccounts();
    const currentAccount = accounts.find((a) => a.is_active);
    if (!currentAccount) return 'idle';

    const isDepleted = this.isAccountDepleted(currentAccount);
    const requiresSwitch = isDepleted || currentAccount.status === 'rate_limited';
    if (!requiresSwitch) {
      return 'idle';
    }

    logger.info(`AutoSwitch: Current account ${currentAccount.email} requires rotation.`);

    if (trigger !== 'scheduled') {
      logger.info('AutoSwitch: Deferred because the poll was triggered by app focus.');
      return 'deferred';
    }

    if (await isProcessRunning('antigravity')) {
      logger.info('AutoSwitch: Deferred because Antigravity is currently active.');
      return 'deferred';
    }

    const nextAccount = await this.findBestAccount(currentAccount.id);
    if (!nextAccount) {
      logger.warn('AutoSwitch: No healthy accounts available to switch to.');
      return 'deferred';
    }

    logger.info(`AutoSwitch: Switching to ${nextAccount.email}...`);
    await switchCloudAccount(nextAccount.id);
    return 'switched';
  }

  /**
   * Finds the best cloud account to switch to.
   * Criteria:
   * 1. Not the current account (unless it's the only one).
   * 2. Status is 'active'.
   * 3. Has quota > 5% for all models (or at least gemini-pro).
   * 4. Sorted by highest quota then last_used (least recently used preferred for rotation? or most? Let's say highest quota first).
   */
  static async findBestAccount(currentAccountId: string): Promise<CloudAccount | null> {
    const accounts = await CloudAccountRepo.getAccounts();

    // Filter potential candidates
    const candidates = accounts.filter((acc) => {
      if (acc.id === currentAccountId) return false;
      if (acc.status !== 'active') return false; // Rate limited or expired accounts are skipped

      // Check quota
      // We assume simple check: if any model has < 5%, we skip it.
      // Or better: check average? NO, check critical models.
      // For now, let's just check if quota object exists.
      if (!acc.quota) return false; // No quota data means risky

      const models = Object.values(acc.quota.models);
      // If any model is depleted (< 5%), skip.
      const isDepleted = models.some((m) => m.percentage < 5);
      return !isDepleted;
    });

    if (candidates.length === 0) return null;

    // Sort by "Best"
    // Heuristic: Highest average quota availability
    candidates.sort((a, b) => {
      const avgA = this.calculateAverageQuota(a);
      const avgB = this.calculateAverageQuota(b);
      return avgB - avgA; // Descending
    });

    return candidates[0];
  }

  private static calculateAverageQuota(account: CloudAccount): number {
    if (!account.quota) return 0;
    const values = Object.values(account.quota.models).map((m) => m.percentage);
    if (values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
  }

  static isAccountDepleted(account: CloudAccount): boolean {
    if (!account.quota) return false; // Unknown, assume fine or let fetchQuota find out
    // Threshold = 5%
    const THRESHOLD = 5;
    return Object.values(account.quota.models).some((m) => m.percentage < THRESHOLD);
  }
}
