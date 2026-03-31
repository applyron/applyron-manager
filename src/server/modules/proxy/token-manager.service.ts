import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { CloudAccount } from '../../../types/cloudAccount';
import {
  getServerConfig,
  resolveServerDefaultProjectId,
  updateServerConfig,
} from '../../server-config';
import { ProxyCapacityError } from './clients/upstream-error';
import { ConfigManager } from '../../../ipc/config/manager';
import { ProxyAccountCacheService } from './proxy-account-cache.service';
import { ProxyRateLimitService } from './proxy-rate-limit.service';
import { ProxySchedulingService } from './proxy-scheduling.service';
import { GetNextTokenOptions, TokenData } from './token-manager.types';
import type {
  ProxyCapacitySnapshot,
  ProxyParitySnapshot,
  ProxyRateLimitSnapshot,
} from '../../../types/operations';

@Injectable()
export class TokenManagerService implements OnModuleInit {
  private readonly logger = new Logger(TokenManagerService.name);
  private readonly defaultBackoffSteps = [60, 300, 1800, 7200];
  private readonly accountCache: ProxyAccountCacheService;
  private readonly rateLimitService: ProxyRateLimitService;
  private readonly schedulingService: ProxySchedulingService;

  constructor(
    @Optional() accountCache?: ProxyAccountCacheService,
    @Optional() rateLimitService?: ProxyRateLimitService,
    @Optional() schedulingService?: ProxySchedulingService,
  ) {
    this.accountCache = accountCache ?? new ProxyAccountCacheService();
    this.rateLimitService = rateLimitService ?? new ProxyRateLimitService();
    this.schedulingService = schedulingService ?? new ProxySchedulingService();
  }

  private get tokens(): Map<string, TokenData> {
    return this.accountCache.getTokenMap();
  }

  private set tokens(tokens: Map<string, TokenData>) {
    this.accountCache.replaceTokens(tokens);
  }

  private get accountCooldowns(): Map<string, number> {
    return this.rateLimitService.getCooldownMap();
  }

  private set accountCooldowns(cooldowns: Map<string, number>) {
    this.rateLimitService.replaceCooldownMap(cooldowns);
  }

  private get currentIndex(): number {
    return this.schedulingService.getCurrentIndex();
  }

  private set currentIndex(index: number) {
    this.schedulingService.setCurrentIndex(index);
  }

  async onModuleInit() {
    await this.loadAccounts();
  }

  async loadAccounts(): Promise<number> {
    return this.accountCache.loadAccounts();
  }

  async reloadAllAccounts(): Promise<number> {
    this.accountCache.invalidateLoadState({ clearTokens: true });
    const count = await this.accountCache.loadAccounts({ force: true });
    this.clearAllRateLimits();
    this.clearAllSessions();
    return count;
  }

  clearAllSessions(): void {
    this.schedulingService.clearAllSessions();
  }

  clearAllRateLimits(): void {
    this.rateLimitService.clearAllRateLimits();
  }

  recordParityError(): void {
    this.schedulingService.recordParityError(this.getConfigSnapshot());
  }

  setPreferredAccount(accountId?: string): void {
    const preferredAccountId = accountId?.trim() ?? '';
    updateServerConfig({
      preferred_account_id: preferredAccountId,
    });

    const cachedConfig = ConfigManager.getCachedConfig();
    if (!cachedConfig) {
      return;
    }

    void ConfigManager.saveConfig({
      ...cachedConfig,
      proxy: {
        ...cachedConfig.proxy,
        preferred_account_id: preferredAccountId,
      },
    }).catch((error) => {
      this.logger.error('Failed to persist preferred proxy account selection', error);
    });
  }

  isRateLimited(accountIdOrEmail: string, model?: string): boolean {
    return this.rateLimitService.isRateLimited(accountIdOrEmail, model, (value) =>
      this.accountCache.resolveAccountId(value),
    );
  }

  markAsRateLimited(accountIdOrEmail: string): void {
    this.rateLimitService.markAsRateLimited(accountIdOrEmail, (value) =>
      this.accountCache.resolveAccountId(value),
    );
  }

  markAsForbidden(accountIdOrEmail: string): void {
    this.rateLimitService.markAsForbidden(accountIdOrEmail, (value) =>
      this.accountCache.resolveAccountId(value),
    );
  }

  async markFromUpstreamError(params: {
    accountIdOrEmail: string;
    status?: number;
    retryAfter?: string;
    body?: string;
    model?: string;
  }): Promise<void> {
    await this.rateLimitService.markFromUpstreamError({
      ...params,
      resolveAccountId: (value) => this.accountCache.resolveAccountId(value),
      resolveCachedResetTime: (accountId) => this.accountCache.getEarliestQuotaResetTime(accountId),
      refreshRealtimeQuotaResetTime: async (accountId) => {
        return this.accountCache.refreshRealtimeQuota(accountId);
      },
      backoffSteps: this.getCircuitBreakerBackoffSteps(),
    });
  }

  async getNextToken(options?: GetNextTokenOptions): Promise<CloudAccount | null> {
    try {
      if (this.tokens.size === 0) {
        await this.loadAccounts();
      }
      if (this.tokens.size === 0) {
        return null;
      }

      const now = Date.now();
      const nowSeconds = Math.floor(now / 1000);
      const sessionKey = options?.sessionKey?.trim();
      const model = options?.model;
      const excludedAccountIds = new Set(options?.excludeAccountIds ?? []);

      this.schedulingService.clearExpiredSessionBindings(now);
      this.rateLimitService.cleanupExpired(now);

      const fullAccountPool = this.accountCache.getEntries();
      const filteredAccountPool = fullAccountPool.filter(
        ([accountId]) => !excludedAccountIds.has(accountId),
      );
      const candidateAccountPool =
        filteredAccountPool.length > 0 ? filteredAccountPool : fullAccountPool;

      if (filteredAccountPool.length === 0 && excludedAccountIds.size > 0) {
        this.logger.warn(
          'Exclusion filter removed all accounts; retrying with the full account pool',
        );
      }

      if (candidateAccountPool.length === 0) {
        this.logger.warn('No eligible account found after exclusion filtering');
        return null;
      }

      this.accountCache.scheduleWarmups(candidateAccountPool, nowSeconds);
      const readyCandidatePool = candidateAccountPool.filter(
        ([, tokenData]) => tokenData.expiry_timestamp > nowSeconds + 300,
      );

      if (readyCandidatePool.length === 0) {
        this.logger.warn(
          'No request-ready account found; waiting for background warm-up to complete',
        );
        return null;
      }

      const config = this.getConfigSnapshot();
      if (this.schedulingService.shouldExecuteShadowComparison(config)) {
        this.schedulingService.executeShadowComparison({
          allTokens: readyCandidatePool,
          sessionKey,
          model,
          now,
          config,
          getCooldownUntil: (accountId) => this.rateLimitService.getCooldownUntil(accountId),
          isRateLimited: (accountId, targetModel) =>
            this.rateLimitService.isRateLimited(accountId, targetModel, (value) =>
              this.accountCache.resolveAccountId(value),
            ),
        });
      }

      const selectedTokenEntry = this.schedulingService.isParitySchedulingEnabled(config)
        ? await this.schedulingService.selectParityTokenCandidate({
            allTokens: readyCandidatePool,
            sessionKey,
            model,
            now,
            config,
            isRateLimited: (accountId, targetModel) =>
              this.rateLimitService.isRateLimited(accountId, targetModel, (value) =>
                this.accountCache.resolveAccountId(value),
              ),
            getRemainingWaitSeconds: (accountId, targetModel) =>
              this.rateLimitService.getRemainingWaitSeconds(accountId, targetModel),
          })
        : this.schedulingService.selectLegacyTokenCandidate(
            readyCandidatePool,
            sessionKey,
            now,
            (accountId) => this.rateLimitService.getCooldownUntil(accountId),
          );

      if (!selectedTokenEntry) {
        return null;
      }

      if (this.schedulingService.isParitySchedulingEnabled(config)) {
        this.schedulingService.markParityRequest();
      }

      const [accountId, tokenData] = selectedTokenEntry;
      return this.finalizeSelectedToken(accountId, tokenData, nowSeconds, sessionKey);
    } catch (error) {
      this.logger.error('Failed to select the next account token', error);
      return null;
    }
  }

  getCapacityError(options?: GetNextTokenOptions): ProxyCapacityError {
    const state = this.getCapacityState(options);
    return new ProxyCapacityError({
      message: 'No proxy account is currently available.',
      reason: state.reason,
      retryAfterSec: state.retryAfterSec,
    });
  }

  getAccountCount(): number {
    return this.accountCache.getAccountCount();
  }

  getAllCollectedModels(): Set<string> {
    return this.accountCache.getAllCollectedModels();
  }

  getModelOutputLimitForAccount(accountId: string, modelName: string): number | undefined {
    return this.accountCache.getModelOutputLimitForAccount(accountId, modelName);
  }

  getModelThinkingBudgetForAccount(accountId: string, modelName: string): number | undefined {
    return this.accountCache.getModelThinkingBudgetForAccount(accountId, modelName);
  }

  getCapacitySnapshot(options?: GetNextTokenOptions): ProxyCapacitySnapshot {
    const state = this.getCapacityState(options);
    return {
      reason: state.reason,
      retryAfterSec: state.retryAfterSec,
    };
  }

  getRateLimitSummary(): ProxyRateLimitSnapshot {
    return this.rateLimitService.getSummary();
  }

  getParitySummary(): ProxyParitySnapshot {
    return this.schedulingService.getParitySummary(this.getConfigSnapshot());
  }

  private getConfigSnapshot() {
    return getServerConfig();
  }

  private getCircuitBreakerBackoffSteps(): number[] {
    const config = this.getConfigSnapshot();
    const configured = config?.circuit_breaker_backoff_steps ?? this.defaultBackoffSteps;
    const normalized = configured
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.ceil(value));
    if (normalized.length > 0) {
      return normalized;
    }
    return this.defaultBackoffSteps;
  }

  private finalizeSelectedToken(
    accountId: string,
    tokenData: TokenData,
    nowSeconds: number,
    sessionKey?: string,
  ): CloudAccount | null {
    try {
      const tokenExpiresSoon = nowSeconds >= tokenData.expiry_timestamp - 300;
      if (tokenExpiresSoon || !tokenData.project_id) {
        this.accountCache.warmAccountInBackground(accountId);
      }

      const effectiveProjectId = tokenData.project_id ?? resolveServerDefaultProjectId();
      if (!tokenData.project_id) {
        this.logger.warn(
          `Using configured fallback project ID for ${tokenData.email}: ${effectiveProjectId}`,
        );
      }

      this.rateLimitService.markSuccess(accountId);
      this.schedulingService.bindSession(sessionKey, accountId);

      const timestamp = Date.now();
      return {
        id: accountId,
        provider: 'google',
        email: tokenData.email,
        token: {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_type: tokenData.token_type,
          expires_in: tokenData.expires_in,
          expiry_timestamp: tokenData.expiry_timestamp,
          project_id: effectiveProjectId,
          session_id: tokenData.session_id,
          upstream_proxy_url: tokenData.upstream_proxy_url,
        },
        created_at: timestamp,
        last_used: timestamp,
      };
    } catch (error) {
      this.logger.error('Failed to finalize selected account token', error);
      return null;
    }
  }

  private getCapacityState(options?: GetNextTokenOptions) {
    return this.schedulingService.getCapacityState({
      fullAccountPool: this.accountCache.getEntries(),
      options,
      getCooldownUntil: (accountId) => this.rateLimitService.getCooldownUntil(accountId),
      getRemainingWaitSeconds: (accountId, model) =>
        this.rateLimitService.getRemainingWaitSeconds(accountId, model),
    });
  }
}
