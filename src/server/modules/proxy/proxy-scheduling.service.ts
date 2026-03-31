import { Injectable, Logger } from '@nestjs/common';
import type { ProxyConfig } from '../../../types/config';
import {
  CapacityState,
  GetNextTokenOptions,
  SchedulingMode,
  TokenEntry,
} from './token-manager.types';
import type { ProxyParitySnapshot } from '../../../types/operations';

type StickySessionBinding = {
  accountId: string;
  expiresAt: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

@Injectable()
export class ProxySchedulingService {
  private readonly logger = new Logger(ProxySchedulingService.name);
  private readonly stickySessionTtlMs = 10 * 60 * 1000;
  private currentIndex = 0;
  private readonly sessionBindings = new Map<string, StickySessionBinding>();
  private shadowComparisonCount = 0;
  private shadowMismatchCount = 0;
  private parityRequestCount = 0;
  private parityErrorCount = 0;
  private noGoBlocked = false;

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  setCurrentIndex(index: number): void {
    this.currentIndex = index;
  }

  clearAllSessions(): void {
    this.sessionBindings.clear();
  }

  clearExpiredSessionBindings(now: number): void {
    for (const [sessionKey, binding] of this.sessionBindings.entries()) {
      if (binding.expiresAt <= now) {
        this.sessionBindings.delete(sessionKey);
      }
    }
  }

  bindSession(sessionKey: string | undefined, accountId: string): void {
    if (!sessionKey) {
      return;
    }

    this.sessionBindings.set(sessionKey, {
      accountId,
      expiresAt: Date.now() + this.stickySessionTtlMs,
    });
  }

  recordParityError(config: Readonly<ProxyConfig> | null): void {
    if (!this.isParitySchedulingEnabled(config)) {
      return;
    }

    this.parityErrorCount++;
    const threshold = this.getNoGoErrorRateThreshold(config);
    const errorRate = this.parityErrorCount / Math.max(1, this.parityRequestCount);
    if (errorRate > threshold) {
      this.noGoBlocked = true;
      this.logger.error(
        `Parity no-go triggered by error threshold: rate=${errorRate.toFixed(4)}, requests=${this.parityRequestCount}, errors=${this.parityErrorCount}`,
      );
    }
  }

  shouldExecuteShadowComparison(config: Readonly<ProxyConfig> | null): boolean {
    return (
      Boolean(config?.parity_shadow_enabled) &&
      !this.isParitySchedulingEnabled(config) &&
      !this.noGoBlocked
    );
  }

  isParitySchedulingEnabled(config: Readonly<ProxyConfig> | null): boolean {
    if (!config) {
      return false;
    }
    if (config.parity_kill_switch || this.noGoBlocked) {
      return false;
    }
    return Boolean(config.parity_enabled);
  }

  markParityRequest(): void {
    this.parityRequestCount++;
  }

  selectLegacyTokenCandidate(
    allTokens: TokenEntry[],
    sessionKey: string | undefined,
    now: number,
    getCooldownUntil: (accountId: string) => number | undefined,
  ): TokenEntry | null {
    const availableByCooldown = allTokens.filter(([accountId]) => {
      const cooldownUntil = getCooldownUntil(accountId);
      return !cooldownUntil || cooldownUntil <= now;
    });

    if (availableByCooldown.length === 0) {
      this.logger.warn('Legacy scheduler found no accounts outside cooldown.');
      return null;
    }

    const stickyToken = this.findStickySessionToken(availableByCooldown, sessionKey, now);
    if (stickyToken) {
      return stickyToken;
    }

    return this.pickRoundRobinEntry(availableByCooldown);
  }

  async selectParityTokenCandidate(params: {
    allTokens: TokenEntry[];
    sessionKey: string | undefined;
    model: string | undefined;
    now: number;
    config: Readonly<ProxyConfig> | null;
    isRateLimited: (accountId: string, model: string | undefined) => boolean;
    getRemainingWaitSeconds: (accountId: string, model: string | undefined) => number;
  }): Promise<TokenEntry | null> {
    const mode = this.getSchedulingMode(params.config);
    const availableTokens = this.collectEligibleTokens(
      params.allTokens,
      params.model,
      params.now,
      params.isRateLimited,
    );
    if (availableTokens.length === 0) {
      return null;
    }

    const preferredAccountId = this.getPreferredAccountId(params.config);
    if (preferredAccountId) {
      const preferred = availableTokens.find(([accountId]) => accountId === preferredAccountId);
      if (preferred) {
        return preferred;
      }
    }

    const stickyToken = this.findStickySessionToken(availableTokens, params.sessionKey, params.now);
    if (stickyToken) {
      return stickyToken;
    }

    const stickyBinding = this.getValidSessionBinding(params.sessionKey, params.now);
    if (stickyBinding && mode === 'cache-first') {
      const waitSec = params.getRemainingWaitSeconds(stickyBinding.accountId, params.model);
      const waitMs = waitSec * 1000;
      const maxWaitMs = this.getMaxWaitDurationMs(params.config);
      if (waitMs > 0 && waitMs <= maxWaitMs) {
        await delay(waitMs);
        const refreshedAvailable = this.collectEligibleTokens(
          params.allTokens,
          params.model,
          Date.now(),
          params.isRateLimited,
        );
        const stickyAfterWait =
          refreshedAvailable.find(([accountId]) => accountId === stickyBinding.accountId) ?? null;
        if (stickyAfterWait) {
          return stickyAfterWait;
        }
        if (refreshedAvailable.length > 0) {
          return this.pickRoundRobinEntry(refreshedAvailable);
        }
      }
    }

    return this.pickRoundRobinEntry(availableTokens);
  }

  executeShadowComparison(params: {
    allTokens: TokenEntry[];
    sessionKey: string | undefined;
    model: string | undefined;
    now: number;
    config: Readonly<ProxyConfig> | null;
    getCooldownUntil: (accountId: string) => number | undefined;
    isRateLimited: (accountId: string, model: string | undefined) => boolean;
  }): void {
    const legacyAccountId = this.predictLegacyAccountCandidateId(
      params.allTokens,
      params.sessionKey,
      params.now,
      params.getCooldownUntil,
    );
    const parityAccountId = this.predictParityAccountCandidateId(
      params.allTokens,
      params.sessionKey,
      params.model,
      params.now,
      params.config,
      params.isRateLimited,
    );
    this.shadowComparisonCount++;

    if (legacyAccountId !== parityAccountId) {
      this.shadowMismatchCount++;
      this.logger.warn(
        `Parity shadow mismatch detected: legacy=${legacyAccountId ?? 'n/a'}, parity=${parityAccountId ?? 'n/a'}`,
      );
    }

    const mismatchRate = this.shadowMismatchCount / Math.max(1, this.shadowComparisonCount);
    if (mismatchRate > this.getNoGoMismatchRateThreshold(params.config)) {
      this.noGoBlocked = true;
      this.logger.error(
        `Parity no-go triggered by mismatch threshold: rate=${mismatchRate.toFixed(4)}, comparisons=${this.shadowComparisonCount}`,
      );
    }
  }

  getCapacityState(params: {
    fullAccountPool: TokenEntry[];
    options?: GetNextTokenOptions;
    getCooldownUntil: (accountId: string) => number | undefined;
    getRemainingWaitSeconds: (accountId: string, model: string | undefined) => number;
  }): CapacityState {
    const now = Date.now();
    if (params.fullAccountPool.length === 0) {
      return {
        reason: 'no_accounts_configured',
        retryAfterSec: 2,
      };
    }

    const excludedAccountIds = new Set(params.options?.excludeAccountIds ?? []);
    const filteredAccountPool = params.fullAccountPool.filter(
      ([accountId]) => !excludedAccountIds.has(accountId),
    );
    const candidateAccountPool =
      filteredAccountPool.length > 0 ? filteredAccountPool : params.fullAccountPool;

    let minRetryAfterSec = Number.POSITIVE_INFINITY;
    let sawCooldown = false;
    let sawRateLimit = false;

    for (const [accountId] of candidateAccountPool) {
      const cooldownUntil = params.getCooldownUntil(accountId);
      if (cooldownUntil && cooldownUntil > now) {
        sawCooldown = true;
        minRetryAfterSec = Math.min(
          minRetryAfterSec,
          Math.max(2, Math.ceil((cooldownUntil - now) / 1000)),
        );
      }

      const rateLimitWaitSec = params.getRemainingWaitSeconds(accountId, params.options?.model);
      if (rateLimitWaitSec > 0) {
        sawRateLimit = true;
        minRetryAfterSec = Math.min(minRetryAfterSec, rateLimitWaitSec);
      }
    }

    if (sawCooldown && sawRateLimit) {
      return {
        reason: 'accounts_unavailable',
        retryAfterSec: Number.isFinite(minRetryAfterSec) ? minRetryAfterSec : 2,
      };
    }

    if (sawCooldown) {
      return {
        reason: 'accounts_cooling_down',
        retryAfterSec: Number.isFinite(minRetryAfterSec) ? minRetryAfterSec : 2,
      };
    }

    if (sawRateLimit) {
      return {
        reason: 'accounts_rate_limited',
        retryAfterSec: Number.isFinite(minRetryAfterSec) ? minRetryAfterSec : 2,
      };
    }

    return {
      reason: 'no_candidate_available',
      retryAfterSec: 2,
    };
  }

  getParitySummary(config: Readonly<ProxyConfig> | null): ProxyParitySnapshot {
    return {
      enabled: this.isParitySchedulingEnabled(config),
      shadowEnabled: Boolean(config?.parity_shadow_enabled),
      noGoBlocked: this.noGoBlocked,
      shadowComparisonCount: this.shadowComparisonCount,
      shadowMismatchCount: this.shadowMismatchCount,
      parityRequestCount: this.parityRequestCount,
      parityErrorCount: this.parityErrorCount,
    };
  }

  private collectEligibleTokens(
    allTokens: TokenEntry[],
    model: string | undefined,
    now: number,
    isRateLimited: (accountId: string, model: string | undefined) => boolean,
  ): TokenEntry[] {
    return allTokens.filter(([accountId]) => {
      const stickyBinding = this.getValidSessionBinding(undefined, now);
      void stickyBinding;
      return !isRateLimited(accountId, model);
    });
  }

  private getValidSessionBinding(
    sessionKey: string | undefined,
    now: number,
  ): StickySessionBinding | null {
    if (!sessionKey) {
      return null;
    }

    const stickyBinding = this.sessionBindings.get(sessionKey);
    if (!stickyBinding || stickyBinding.expiresAt <= now) {
      return null;
    }

    return stickyBinding;
  }

  private findStickySessionToken(
    candidates: TokenEntry[],
    sessionKey: string | undefined,
    now: number,
  ): TokenEntry | null {
    const stickyBinding = this.getValidSessionBinding(sessionKey, now);
    if (!stickyBinding) {
      return null;
    }

    return candidates.find(([accountId]) => accountId === stickyBinding.accountId) ?? null;
  }

  private pickRoundRobinEntry(candidates: TokenEntry[]): TokenEntry | null {
    if (candidates.length === 0) {
      return null;
    }

    const picked = candidates[this.currentIndex % candidates.length];
    this.currentIndex++;
    return picked;
  }

  private peekRoundRobinCandidateAccountId(candidates: TokenEntry[]): string | null {
    if (candidates.length === 0) {
      return null;
    }

    return candidates[this.currentIndex % candidates.length][0];
  }

  private predictLegacyAccountCandidateId(
    allTokens: TokenEntry[],
    sessionKey: string | undefined,
    now: number,
    getCooldownUntil: (accountId: string) => number | undefined,
  ): string | null {
    const availableByCooldown = allTokens.filter(([accountId]) => {
      const cooldownUntil = getCooldownUntil(accountId);
      return !cooldownUntil || cooldownUntil <= now;
    });
    const candidateAccountPool = availableByCooldown.length > 0 ? availableByCooldown : allTokens;
    if (candidateAccountPool.length === 0) {
      return null;
    }

    const stickyToken = this.findStickySessionToken(candidateAccountPool, sessionKey, now);
    if (stickyToken) {
      return stickyToken[0];
    }

    return this.peekRoundRobinCandidateAccountId(candidateAccountPool);
  }

  private predictParityAccountCandidateId(
    allTokens: TokenEntry[],
    sessionKey: string | undefined,
    model: string | undefined,
    now: number,
    config: Readonly<ProxyConfig> | null,
    isRateLimited: (accountId: string, model: string | undefined) => boolean,
  ): string | null {
    const availableTokens = this.collectEligibleTokens(allTokens, model, now, isRateLimited);
    if (availableTokens.length === 0) {
      return null;
    }

    const preferredAccountId = this.getPreferredAccountId(config);
    if (preferredAccountId) {
      const preferred = availableTokens.find(([accountId]) => accountId === preferredAccountId);
      if (preferred) {
        return preferred[0];
      }
    }

    const stickyToken = this.findStickySessionToken(availableTokens, sessionKey, now);
    if (stickyToken) {
      return stickyToken[0];
    }

    return this.peekRoundRobinCandidateAccountId(availableTokens);
  }

  private getSchedulingMode(config: Readonly<ProxyConfig> | null): SchedulingMode {
    const mode = (config?.scheduling_mode ?? 'balance').toLowerCase();
    if (mode === 'cache-first' || mode === 'performance-first' || mode === 'balance') {
      return mode;
    }
    return 'balance';
  }

  private getMaxWaitDurationMs(config: Readonly<ProxyConfig> | null): number {
    const seconds = config?.max_wait_seconds ?? 60;
    return Math.max(0, seconds) * 1000;
  }

  private getPreferredAccountId(config: Readonly<ProxyConfig> | null): string | undefined {
    const preferred = config?.preferred_account_id?.trim();
    return preferred ? preferred : undefined;
  }

  private getNoGoMismatchRateThreshold(config: Readonly<ProxyConfig> | null): number {
    const threshold = config?.parity_no_go_mismatch_rate ?? 0.15;
    if (!Number.isFinite(threshold)) {
      return 0.15;
    }
    return Math.min(1, Math.max(0, threshold));
  }

  private getNoGoErrorRateThreshold(config: Readonly<ProxyConfig> | null): number {
    const threshold = config?.parity_no_go_error_rate ?? 0.4;
    if (!Number.isFinite(threshold)) {
      return 0.4;
    }
    return Math.min(1, Math.max(0, threshold));
  }
}
