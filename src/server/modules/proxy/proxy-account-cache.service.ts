import { randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { CloudAccountRepo } from '../../../ipc/database/cloudHandler';
import { GoogleAPIService } from '../../../services/GoogleAPIService';
import { CloudAccount, CloudQuotaData } from '../../../types/cloudAccount';
import {
  buildOperationalQuotaFingerprint,
  hasOperationalQuotaChange,
} from '../../../utils/cloudQuotaFingerprint';
import { updateDynamicForwardingRules } from '../../../lib/antigravity/ModelMapping';
import { normalizeProjectId } from '../../../utils/projectId';
import { normalizeModelId, TokenData, TokenEntry } from './token-manager.types';

@Injectable()
export class ProxyAccountCacheService {
  private readonly logger = new Logger(ProxyAccountCacheService.name);
  private readonly emptyLoadCooldownMs = 30_000;
  private readonly tokenRefreshLeadSeconds = 300;
  private tokens = new Map<string, TokenData>();
  private lastSuccessfulLoadAt = 0;
  private lastEmptyLoadAt = 0;
  private loadInFlight: Promise<number> | null = null;
  private readonly warmInFlight = new Map<string, Promise<TokenData | null>>();

  async loadAccounts(options?: { force?: boolean }): Promise<number> {
    if (this.loadInFlight) {
      return this.loadInFlight;
    }

    if (
      !options?.force &&
      this.tokens.size === 0 &&
      this.lastEmptyLoadAt > 0 &&
      Date.now() - this.lastEmptyLoadAt < this.emptyLoadCooldownMs
    ) {
      this.logger.debug('Skipping account reload because empty-load negative cache is active.');
      return 0;
    }

    const loadPromise = this.performLoadAccounts();
    this.loadInFlight = loadPromise;

    try {
      return await loadPromise;
    } finally {
      this.loadInFlight = null;
    }
  }

  invalidateLoadState(options?: { clearTokens?: boolean }): void {
    this.lastEmptyLoadAt = 0;
    if (options?.clearTokens) {
      this.tokens = new Map();
    }
  }

  replaceTokens(tokens: Map<string, TokenData>): void {
    this.tokens = new Map(tokens);
    this.lastSuccessfulLoadAt = Date.now();
    this.lastEmptyLoadAt = this.tokens.size === 0 ? Date.now() : 0;
  }

  getTokenMap(): Map<string, TokenData> {
    return this.tokens;
  }

  getEntries(): TokenEntry[] {
    return Array.from(this.tokens.entries());
  }

  getRequestReadyEntries(nowSeconds: number): TokenEntry[] {
    return Array.from(this.tokens.entries()).filter(([, tokenData]) =>
      this.isReadyForRequest(tokenData, nowSeconds),
    );
  }

  scheduleWarmups(
    entries: readonly TokenEntry[],
    nowSeconds = Math.floor(Date.now() / 1000),
  ): void {
    for (const [accountId, tokenData] of entries) {
      if (!this.shouldWarmAccount(tokenData, nowSeconds)) {
        continue;
      }
      this.warmAccountInBackground(accountId);
    }
  }

  warmAccountInBackground(accountId: string): void {
    if (this.warmInFlight.has(accountId)) {
      return;
    }

    const warmPromise = this.warmAccount(accountId)
      .catch((error) => {
        this.logger.warn(`Background account warm-up failed for ${accountId}`, error);
        return null;
      })
      .finally(() => {
        this.warmInFlight.delete(accountId);
      });

    this.warmInFlight.set(accountId, warmPromise);
  }

  async warmAccount(accountId: string): Promise<TokenData | null> {
    const existingWarm = this.warmInFlight.get(accountId);
    if (existingWarm) {
      return existingWarm;
    }

    const warmPromise = this.performWarmAccount(accountId).finally(() => {
      this.warmInFlight.delete(accountId);
    });
    this.warmInFlight.set(accountId, warmPromise);
    return warmPromise;
  }

  get(accountId: string): TokenData | undefined {
    return this.tokens.get(accountId);
  }

  set(accountId: string, tokenData: TokenData): void {
    this.tokens.set(accountId, tokenData);
  }

  resolveAccountId(accountIdOrEmail: string): string | null {
    if (this.tokens.has(accountIdOrEmail)) {
      return accountIdOrEmail;
    }

    for (const [accountId, tokenData] of this.tokens.entries()) {
      if (tokenData.email === accountIdOrEmail) {
        return accountId;
      }
    }

    return null;
  }

  getAccountCount(): number {
    return this.tokens.size;
  }

  getAllCollectedModels(): Set<string> {
    const allModels = new Set<string>();
    for (const tokenData of this.tokens.values()) {
      for (const modelId of Object.keys(tokenData.model_quotas)) {
        allModels.add(modelId);
      }
    }
    return allModels;
  }

  getModelOutputLimitForAccount(accountId: string, modelName: string): number | undefined {
    const tokenData = this.tokens.get(accountId);
    const normalizedModel = normalizeModelId(modelName);
    if (!tokenData || !normalizedModel) {
      return undefined;
    }
    return tokenData.model_limits[normalizedModel];
  }

  getModelThinkingBudgetForAccount(accountId: string, modelName: string): number | undefined {
    const tokenData = this.tokens.get(accountId);
    const normalizedModel = normalizeModelId(modelName);
    if (!tokenData || !normalizedModel) {
      return undefined;
    }

    for (const [quotaModelName, modelInfo] of Object.entries(tokenData.quota?.models ?? {})) {
      if (normalizeModelId(quotaModelName) !== normalizedModel) {
        continue;
      }

      const budget = modelInfo?.thinking_budget;
      if (typeof budget === 'number' && Number.isFinite(budget) && budget >= 0) {
        return Math.floor(budget);
      }
    }

    return undefined;
  }

  getEarliestQuotaResetTime(accountId: string): string | null {
    const tokenData = this.tokens.get(accountId);
    if (!tokenData) {
      return null;
    }
    return this.findEarliestQuotaResetTime(tokenData.model_reset_times);
  }

  async refreshRealtimeQuota(accountId: string): Promise<string | null> {
    const tokenData = (await this.warmAccount(accountId)) ?? this.tokens.get(accountId);
    if (!tokenData) {
      return null;
    }

    const latestQuota = await GoogleAPIService.fetchQuota(tokenData.access_token);
    const extractedState = this.extractQuotaSnapshot(latestQuota);
    const quotaChanged = hasOperationalQuotaChange(tokenData.quota, latestQuota);

    tokenData.quota = latestQuota;
    tokenData.model_quotas = extractedState.modelQuotas;
    tokenData.model_limits = extractedState.modelLimits;
    tokenData.model_reset_times = extractedState.modelResetTimes;
    tokenData.model_forwarding_rules = extractedState.modelForwardingRules;
    this.tokens.set(accountId, tokenData);

    if (quotaChanged) {
      await CloudAccountRepo.updateQuota(accountId, latestQuota);
      this.logger.debug(
        `Persisted refreshed quota fingerprint for ${accountId}: ${buildOperationalQuotaFingerprint(latestQuota)}`,
      );
    }

    return this.findEarliestQuotaResetTime(extractedState.modelResetTimes);
  }

  async resolveProjectId(accountId: string, tokenData: TokenData): Promise<string | undefined> {
    const normalizedExistingProjectId = normalizeProjectId(tokenData.project_id);
    if (normalizedExistingProjectId) {
      tokenData.project_id = normalizedExistingProjectId;
      this.tokens.set(accountId, tokenData);
      return normalizedExistingProjectId;
    }

    try {
      const fetchedProjectId = await GoogleAPIService.fetchProjectId(tokenData.access_token);
      const normalizedProjectId = normalizeProjectId(fetchedProjectId);
      if (!normalizedProjectId) {
        this.logger.warn(
          `Project ID unavailable for ${tokenData.email}; continuing without project context`,
        );
        return undefined;
      }

      tokenData.project_id = normalizedProjectId;
      await this.persistTokenState(accountId, tokenData);
      this.tokens.set(accountId, tokenData);
      this.logger.log(`Resolved project ID for ${tokenData.email}: ${normalizedProjectId}`);
      return normalizedProjectId;
    } catch (error) {
      this.logger.warn(`Unable to resolve project ID for ${tokenData.email}`, error);
      return undefined;
    }
  }

  async persistTokenState(accountId: string, tokenData: TokenData): Promise<void> {
    try {
      const account = await CloudAccountRepo.getAccount(accountId);
      if (!account?.token) {
        return;
      }

      const newToken = {
        ...account.token,
        access_token: tokenData.access_token,
        expires_in: tokenData.expires_in,
        expiry_timestamp: tokenData.expiry_timestamp,
        project_id: tokenData.project_id ?? account.token.project_id,
        session_id: tokenData.session_id ?? account.token.session_id,
        upstream_proxy_url: tokenData.upstream_proxy_url ?? account.token.upstream_proxy_url,
      };
      await CloudAccountRepo.updateToken(accountId, newToken);
    } catch (error) {
      this.logger.error('Failed to persist token state to database', error);
    }
  }

  private async performLoadAccounts(): Promise<number> {
    try {
      const accounts = await CloudAccountRepo.getAccounts();
      const nextTokens = new Map<string, TokenData>();

      for (const account of accounts) {
        const tokenData = this.mapAccountToTokenData(account);
        if (!tokenData) {
          continue;
        }

        nextTokens.set(account.id, tokenData);
      }

      this.tokens = nextTokens;
      const count = nextTokens.size;
      if (count === 0) {
        this.lastEmptyLoadAt = Date.now();
      } else {
        this.lastSuccessfulLoadAt = Date.now();
        this.lastEmptyLoadAt = 0;
        this.scheduleWarmups(Array.from(nextTokens.entries()));
      }

      this.logger.log(`Token manager loaded ${count} cloud accounts into cache`);
      return count;
    } catch (error) {
      this.logger.error('Failed to load cloud accounts into token cache', error);
      return 0;
    }
  }

  private async performWarmAccount(accountId: string): Promise<TokenData | null> {
    const currentToken = this.tokens.get(accountId);
    if (!currentToken) {
      return null;
    }

    const nextToken: TokenData = {
      ...currentToken,
      model_quotas: { ...currentToken.model_quotas },
      model_limits: { ...currentToken.model_limits },
      model_reset_times: { ...currentToken.model_reset_times },
      model_forwarding_rules: { ...currentToken.model_forwarding_rules },
      quota: currentToken.quota ? structuredClone(currentToken.quota) : undefined,
    };

    const nowSeconds = Math.floor(Date.now() / 1000);
    let changed = false;

    if (this.isTokenNearExpiry(nextToken, nowSeconds)) {
      this.logger.log(`Refreshing near-expiry access token for ${nextToken.email}`);
      const refreshedToken = await GoogleAPIService.refreshAccessToken(nextToken.refresh_token);
      nextToken.access_token = refreshedToken.access_token;
      nextToken.expires_in = refreshedToken.expires_in;
      nextToken.expiry_timestamp = nowSeconds + refreshedToken.expires_in;
      changed = true;
    }

    if (!normalizeProjectId(nextToken.project_id)) {
      const fetchedProjectId = await GoogleAPIService.fetchProjectId(nextToken.access_token);
      const normalizedProjectId = normalizeProjectId(fetchedProjectId);
      if (normalizedProjectId) {
        nextToken.project_id = normalizedProjectId;
        changed = true;
      }
    }

    if (changed) {
      await this.persistTokenState(accountId, nextToken);
      this.tokens.set(accountId, nextToken);
    }

    return nextToken;
  }

  private isReadyForRequest(tokenData: TokenData, nowSeconds: number): boolean {
    return !this.isTokenNearExpiry(tokenData, nowSeconds);
  }

  private shouldWarmAccount(tokenData: TokenData, nowSeconds: number): boolean {
    return (
      this.isTokenNearExpiry(tokenData, nowSeconds) || !normalizeProjectId(tokenData.project_id)
    );
  }

  private isTokenNearExpiry(tokenData: TokenData, nowSeconds: number): boolean {
    return nowSeconds >= tokenData.expiry_timestamp - this.tokenRefreshLeadSeconds;
  }

  private mapAccountToTokenData(account: CloudAccount): TokenData | null {
    if (!account.token) {
      return null;
    }

    const quota = account.quota;
    const extractedState = this.extractQuotaSnapshot(quota);

    return {
      account_id: account.id,
      email: account.email,
      access_token: account.token.access_token,
      refresh_token: account.token.refresh_token,
      token_type: account.token.token_type || 'Bearer',
      expires_in: account.token.expires_in,
      expiry_timestamp: account.token.expiry_timestamp,
      project_id: normalizeProjectId(account.token.project_id),
      session_id: account.token.session_id || this.generateSessionId(),
      upstream_proxy_url: account.token.upstream_proxy_url || undefined,
      quota,
      model_quotas: extractedState.modelQuotas,
      model_limits: extractedState.modelLimits,
      model_reset_times: extractedState.modelResetTimes,
      model_forwarding_rules: extractedState.modelForwardingRules,
    };
  }

  private generateSessionId(): string {
    return `-${randomBytes(8).readBigUInt64BE().toString()}`;
  }

  private extractQuotaSnapshot(quota: CloudQuotaData | undefined): {
    modelQuotas: Record<string, number>;
    modelLimits: Record<string, number>;
    modelResetTimes: Record<string, string>;
    modelForwardingRules: Record<string, string>;
  } {
    const modelQuotas: Record<string, number> = {};
    const modelLimits: Record<string, number> = {};
    const modelResetTimes: Record<string, string> = {};
    const modelForwardingRules: Record<string, string> = {};

    for (const [modelName, modelInfo] of Object.entries(quota?.models ?? {})) {
      const normalizedModel = normalizeModelId(modelName);
      if (!normalizedModel) {
        continue;
      }

      if (Number.isFinite(modelInfo.percentage)) {
        modelQuotas[normalizedModel] = Math.floor(modelInfo.percentage);
      }

      const limitCandidate = modelInfo.max_output_tokens ?? modelInfo.max_tokens;
      if (
        typeof limitCandidate === 'number' &&
        Number.isFinite(limitCandidate) &&
        limitCandidate > 0
      ) {
        modelLimits[normalizedModel] = Math.floor(limitCandidate);
      }

      if (typeof modelInfo.resetTime === 'string' && modelInfo.resetTime.trim() !== '') {
        modelResetTimes[normalizedModel] = modelInfo.resetTime;
      }
    }

    for (const [oldModel, newModel] of Object.entries(quota?.model_forwarding_rules ?? {})) {
      const normalizedOld = normalizeModelId(oldModel);
      const normalizedNew = normalizeModelId(newModel);
      if (!normalizedOld || !normalizedNew) {
        continue;
      }

      modelForwardingRules[normalizedOld] = normalizedNew;
      updateDynamicForwardingRules(normalizedOld, normalizedNew);
    }

    return {
      modelQuotas,
      modelLimits,
      modelResetTimes,
      modelForwardingRules,
    };
  }

  private findEarliestQuotaResetTime(modelResetTimes: Record<string, string>): string | null {
    const validTimes = Object.values(modelResetTimes).filter((value) => value.trim() !== '');
    if (validTimes.length === 0) {
      return null;
    }

    return [...validTimes].sort()[0];
  }
}
