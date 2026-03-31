import { Injectable, Logger } from '@nestjs/common';
import { RateLimitReason, RateLimitTracker } from './rate-limit-tracker';
import type { ProxyRateLimitSnapshot } from '../../../types/operations';
import { normalizeModelId } from './token-manager.types';

@Injectable()
export class ProxyRateLimitService {
  private readonly logger = new Logger(ProxyRateLimitService.name);
  private readonly rateLimitCooldownMs = 5 * 60 * 1000;
  private readonly forbiddenCooldownMs = 30 * 60 * 1000;
  private readonly accountCooldowns = new Map<string, number>();
  private readonly rateLimitTracker = new RateLimitTracker();

  getCooldownMap(): Map<string, number> {
    return this.accountCooldowns;
  }

  replaceCooldownMap(cooldowns: Map<string, number>): void {
    this.accountCooldowns.clear();
    for (const [accountId, cooldownUntil] of cooldowns.entries()) {
      this.accountCooldowns.set(accountId, cooldownUntil);
    }
  }

  clearAllRateLimits(): void {
    this.accountCooldowns.clear();
    this.rateLimitTracker.clearAll();
  }

  cleanupExpired(now = Date.now()): void {
    for (const [accountId, cooldownUntil] of this.accountCooldowns.entries()) {
      if (cooldownUntil <= now) {
        this.accountCooldowns.delete(accountId);
      }
    }
    this.rateLimitTracker.cleanupExpired();
  }

  isRateLimited(
    accountIdOrEmail: string,
    model: string | undefined,
    resolveAccountId: (accountIdOrEmail: string) => string | null,
  ): boolean {
    const accountId = resolveAccountId(accountIdOrEmail) ?? accountIdOrEmail;
    const now = Date.now();
    const legacyCooldownUntil = this.accountCooldowns.get(accountId);
    if (legacyCooldownUntil && legacyCooldownUntil > now) {
      return true;
    }
    return this.rateLimitTracker.isRateLimited(accountId, model);
  }

  markAsRateLimited(
    accountIdOrEmail: string,
    resolveAccountId: (accountIdOrEmail: string) => string | null,
  ): void {
    this.setAccountCooldown(
      accountIdOrEmail,
      'rate limited',
      this.rateLimitCooldownMs,
      resolveAccountId,
    );
  }

  markAsForbidden(
    accountIdOrEmail: string,
    resolveAccountId: (accountIdOrEmail: string) => string | null,
  ): void {
    this.setAccountCooldown(
      accountIdOrEmail,
      'forbidden',
      this.forbiddenCooldownMs,
      resolveAccountId,
    );
  }

  async markFromUpstreamError(params: {
    accountIdOrEmail: string;
    status?: number;
    retryAfter?: string;
    body?: string;
    model?: string;
    resolveAccountId: (accountIdOrEmail: string) => string | null;
    resolveCachedResetTime: (accountId: string) => string | null;
    refreshRealtimeQuotaResetTime: (accountId: string) => Promise<string | null>;
    backoffSteps: number[];
  }): Promise<void> {
    const accountId = params.resolveAccountId(params.accountIdOrEmail) ?? params.accountIdOrEmail;
    const normalizedModel = normalizeModelId(params.model);
    const hasExplicitRetryWindow =
      Boolean(params.retryAfter && params.retryAfter.trim() !== '') ||
      Boolean(params.body && params.body.includes('quotaResetDelay'));

    if (!hasExplicitRetryWindow && (params.status ?? 0) === 429) {
      const reason = this.detectRateLimitReasonFromBody(params.body);
      const shouldAttemptPreciseLockout =
        reason === RateLimitReason.QuotaExhausted || reason === RateLimitReason.Unknown;

      if (!shouldAttemptPreciseLockout) {
        this.trackAndApplyCooldown({
          accountId,
          status: params.status,
          retryAfter: params.retryAfter,
          body: params.body,
          model: normalizedModel,
          backoffSteps: params.backoffSteps,
        });
        return;
      }

      try {
        const realtimeResetTime = await params.refreshRealtimeQuotaResetTime(accountId);
        if (
          realtimeResetTime &&
          this.rateLimitTracker.setLockoutUntilIso(
            accountId,
            realtimeResetTime,
            reason,
            normalizedModel,
          )
        ) {
          return;
        }
      } catch (error) {
        this.logger.warn(`Failed to refresh realtime quota for account ${accountId}`, error);
      }

      const cachedResetTime = params.resolveCachedResetTime(accountId);
      if (
        cachedResetTime &&
        this.rateLimitTracker.setLockoutUntilIso(
          accountId,
          cachedResetTime,
          reason,
          normalizedModel,
        )
      ) {
        return;
      }
    }

    this.trackAndApplyCooldown({
      accountId,
      status: params.status,
      retryAfter: params.retryAfter,
      body: params.body,
      model: normalizedModel,
      backoffSteps: params.backoffSteps,
    });
  }

  markSuccess(accountId: string): void {
    this.rateLimitTracker.markSuccess(accountId);
  }

  getCooldownUntil(accountId: string): number | undefined {
    return this.accountCooldowns.get(accountId);
  }

  getRemainingWaitSeconds(accountId: string, model?: string): number {
    return this.rateLimitTracker.getRemainingWaitSeconds(accountId, model);
  }

  getSummary(): ProxyRateLimitSnapshot {
    this.cleanupExpired();
    const trackerSummary = this.rateLimitTracker.getSummary();

    let nextCooldownAt: number | null = null;
    for (const cooldownUntil of this.accountCooldowns.values()) {
      if (nextCooldownAt === null || cooldownUntil < nextCooldownAt) {
        nextCooldownAt = cooldownUntil;
      }
    }

    const nextRetryAtCandidates = [trackerSummary.nextRetryAt, nextCooldownAt].filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    );
    const nextRetryAt =
      nextRetryAtCandidates.length > 0 ? Math.min(...nextRetryAtCandidates) : null;
    const nextRetrySec =
      nextRetryAt !== null ? Math.max(0, Math.ceil((nextRetryAt - Date.now()) / 1000)) : null;

    return {
      cooldownCount: this.accountCooldowns.size,
      upstreamLockCount: trackerSummary.activeLockCount,
      reasonSummary: trackerSummary.reasonSummary,
      nextRetryAt,
      nextRetrySec,
    };
  }

  private trackAndApplyCooldown(params: {
    accountId: string;
    status?: number;
    retryAfter?: string;
    body?: string;
    model?: string;
    backoffSteps: number[];
  }): void {
    const parsed = this.rateLimitTracker.trackFromUpstreamError(params);
    if (!parsed) {
      return;
    }

    if (parsed.reason !== RateLimitReason.QuotaExhausted || !parsed.model?.trim()) {
      this.accountCooldowns.set(params.accountId, Date.now() + parsed.retryAfterSec * 1000);
    }

    this.logger.warn(
      `Recorded upstream limit for account ${params.accountId}: reason=${parsed.reason}, wait=${parsed.retryAfterSec}s, model=${parsed.model ?? 'n/a'}`,
    );
  }

  private detectRateLimitReasonFromBody(body: string | undefined): RateLimitReason {
    const lowerBody = (body ?? '').toLowerCase();
    if (lowerBody.includes('model_capacity')) {
      return RateLimitReason.ModelCapacityExhausted;
    }
    if (lowerBody.includes('exhausted') || lowerBody.includes('quota')) {
      return RateLimitReason.QuotaExhausted;
    }
    if (
      lowerBody.includes('per minute') ||
      lowerBody.includes('rate limit') ||
      lowerBody.includes('rate_limit')
    ) {
      return RateLimitReason.RateLimitExceeded;
    }
    return RateLimitReason.Unknown;
  }

  private setAccountCooldown(
    accountIdOrEmail: string,
    reason: 'rate limited' | 'forbidden',
    durationMs: number,
    resolveAccountId: (accountIdOrEmail: string) => string | null,
  ): void {
    const accountId = resolveAccountId(accountIdOrEmail) ?? accountIdOrEmail;
    const cooldownUntil = Date.now() + durationMs;

    this.accountCooldowns.set(accountId, cooldownUntil);
    this.logger.warn(
      `Applied ${reason} cooldown: source=${accountIdOrEmail}, accountId=${accountId}, until=${new Date(cooldownUntil).toISOString()}`,
    );
  }
}
