import { Injectable, Logger, Inject } from '@nestjs/common';
import { TokenManagerService } from './token-manager.service';
import { GeminiClient } from './clients/gemini.client';
import { Observable } from 'rxjs';
import { transformClaudeRequestIn } from '../../../lib/antigravity/ClaudeRequestMapper';
import { transformResponse } from '../../../lib/antigravity/ClaudeResponseMapper';
import { GeminiInternalRequest } from '../../../lib/antigravity/types';
import { calculateRetryDelay, sleep } from '../../../lib/antigravity/retry-utils';
import {
  OpenAIChatRequest,
  AnthropicChatRequest,
  GeminiResponse,
  GeminiRequest,
  AnthropicChatResponse,
  OpenAIChatResponse,
} from './interfaces/request-interfaces';
import { getMaxOutputTokens, getThinkingBudget } from '../../../lib/antigravity/ModelSpecs';
import { resolveRequestUserAgent } from './request-user-agent';
import { UpstreamRequestError } from './clients/upstream-error';
import {
  convertClaudeToOpenAIResponse,
  convertOpenAIToClaude,
  createGeminiInternalRequest,
  normalizeGeminiGenerateResponse,
  toAnthropicChatResponse,
  toClaudeRequest,
} from './proxy-message-mappers';
import {
  classifyUpstreamFailure,
  createModelSpecificHeaders,
  extractAnthropicSessionKey,
  extractOpenAISessionKey,
  isProjectContextError,
  isQuotaExhaustedError,
  normalizeGeminiModel,
  normalizeModelIdentifier,
  resolveTargetModel,
  resolveThinkingLevelBudget,
} from './proxy-routing-helpers';
import { generateInternalWithStreamFallback } from './proxy-generation-helpers';
import { getServerConfig } from '../../server-config';
import {
  createSyntheticOpenAIStream,
  passthroughSseStream,
  processAnthropicInternalStream,
  processOpenAICompatibleStream,
} from './proxy-stream-helpers';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(
    @Inject(TokenManagerService) private readonly tokenManager: TokenManagerService,
    @Inject(GeminiClient) private readonly geminiClient: GeminiClient,
  ) {}

  // --- Anthropic Handlers ---

  async handleAnthropicMessages(
    request: AnthropicChatRequest,
  ): Promise<AnthropicChatResponse | Observable<string>> {
    const sessionKey = extractAnthropicSessionKey(request);
    const configSnapshot = getServerConfig();
    const targetModel = resolveTargetModel(request.model, configSnapshot);
    const extraHeaders = createModelSpecificHeaders(request.model);
    this.logger.log(
      `Anthropic request received: model=${request.model}, mappedModel=${targetModel}, stream=${request.stream}`,
    );

    // Retry loop
    let lastError: unknown = null;
    const maxRetries = 3;
    const attemptedAccountIds = new Set<string>();

    for (let i = 0; i < maxRetries; i++) {
      if (i > 0) {
        const delay = calculateRetryDelay(i - 1);
        this.logger.log(`Anthropic retry ${i + 1}/${maxRetries}, backoff=${delay}ms (jittered)`);
        await sleep(delay);
      }

      const token = await this.tokenManager.getNextToken({
        sessionKey,
        excludeAccountIds: Array.from(attemptedAccountIds),
        model: targetModel,
      });
      if (!token) {
        throw this.tokenManager.getCapacityError({
          sessionKey,
          excludeAccountIds: Array.from(attemptedAccountIds),
          model: targetModel,
        });
      }
      attemptedAccountIds.add(token.id);

      try {
        const projectId = token.token.project_id ?? '';
        const requestUserAgent = await resolveRequestUserAgent();
        const geminiBody = transformClaudeRequestIn(
          toClaudeRequest(request),
          projectId,
          requestUserAgent,
        );
        this.applyInternalGenerationConstraints(geminiBody, targetModel, token.id);

        if (request.stream) {
          const stream = await this.geminiClient.streamGenerateInternal(
            geminiBody,
            token.token.access_token,
            token.token.upstream_proxy_url,
            extraHeaders,
            configSnapshot,
          );
          return processAnthropicInternalStream(stream, this.logger);
        } else {
          const response = await generateInternalWithStreamFallback({
            geminiClient: this.geminiClient,
            body: geminiBody,
            accessToken: token.token.access_token,
            upstreamProxyUrl: token.token.upstream_proxy_url,
            extraHeaders,
            configSnapshot,
            logger: this.logger,
          });
          return toAnthropicChatResponse(transformResponse(response));
        }
      } catch (error) {
        if (error instanceof Error && isProjectContextError(error.message)) {
          this.logger.warn(
            `Anthropic request hit project context issue, retrying without project: ${error.message}`,
          );
          try {
            const requestUserAgent = await resolveRequestUserAgent();
            const fallbackBody = transformClaudeRequestIn(
              toClaudeRequest(request),
              '',
              requestUserAgent,
            );
            this.applyInternalGenerationConstraints(fallbackBody, targetModel, token.id);
            if (request.stream) {
              const stream = await this.geminiClient.streamGenerateInternal(
                fallbackBody,
                token.token.access_token,
                token.token.upstream_proxy_url,
                extraHeaders,
                configSnapshot,
              );
              return processAnthropicInternalStream(stream, this.logger);
            } else {
              const response = await generateInternalWithStreamFallback({
                geminiClient: this.geminiClient,
                body: fallbackBody,
                accessToken: token.token.access_token,
                upstreamProxyUrl: token.token.upstream_proxy_url,
                extraHeaders,
                configSnapshot,
                logger: this.logger,
              });
              return toAnthropicChatResponse(transformResponse(response));
            }
          } catch (fallbackErr) {
            lastError = fallbackErr;
          }
        }

        if (error instanceof Error && isQuotaExhaustedError(error.message)) {
          this.logger.warn(
            `Anthropic request hit quota exhaustion on mapped model, retrying with fallback model gemini-3-flash: ${error.message}`,
          );
          try {
            const downgradedRequest = {
              ...toClaudeRequest(request),
              model: 'gemini-3-flash',
            };
            const requestUserAgent = await resolveRequestUserAgent();
            const downgradedBody = transformClaudeRequestIn(
              downgradedRequest,
              token.token.project_id ?? '',
              requestUserAgent,
            );
            this.applyInternalGenerationConstraints(downgradedBody, 'gemini-3-flash', token.id);
            if (request.stream) {
              const stream = await this.geminiClient.streamGenerateInternal(
                downgradedBody,
                token.token.access_token,
                token.token.upstream_proxy_url,
                extraHeaders,
                configSnapshot,
              );
              return processAnthropicInternalStream(stream, this.logger);
            } else {
              const response = await generateInternalWithStreamFallback({
                geminiClient: this.geminiClient,
                body: downgradedBody,
                accessToken: token.token.access_token,
                upstreamProxyUrl: token.token.upstream_proxy_url,
                extraHeaders,
                configSnapshot,
                logger: this.logger,
              });
              const transformed = toAnthropicChatResponse(transformResponse(response));
              return {
                ...transformed,
                model: request.model,
              };
            }
          } catch (downgradeErr) {
            lastError = downgradeErr;
          }
        }

        lastError = error;
        await this.applyUpstreamPenalty(token.id, targetModel, error);
      }
    }
    throw lastError || new Error('Request failed after retries');
  }

  // --- OpenAI / Universal Handlers ---
  async handleGeminiGenerateContent(
    model: string,
    request: GeminiRequest,
  ): Promise<GeminiResponse> {
    const normalizedModel = normalizeGeminiModel(model);
    const configSnapshot = getServerConfig();
    const targetModel = resolveTargetModel(normalizedModel, configSnapshot);
    const extraHeaders = createModelSpecificHeaders(normalizedModel);
    this.logger.log(
      `Gemini generate request received: model=${normalizedModel}, mappedModel=${targetModel}`,
    );

    let lastError: unknown = null;
    const maxRetries = 3;
    const attemptedAccountIds = new Set<string>();

    for (let i = 0; i < maxRetries; i++) {
      if (i > 0) {
        const delay = calculateRetryDelay(i - 1);
        this.logger.log(`Gemini retry attempt ${i + 1}/${maxRetries}, waiting ${delay}ms`);
        await sleep(delay);
      }

      const token = await this.tokenManager.getNextToken({
        excludeAccountIds: Array.from(attemptedAccountIds),
        model: targetModel,
      });
      if (!token) {
        throw this.tokenManager.getCapacityError({
          excludeAccountIds: Array.from(attemptedAccountIds),
          model: targetModel,
        });
      }
      attemptedAccountIds.add(token.id);

      try {
        const requestUserAgent = await resolveRequestUserAgent();
        const internalBody = createGeminiInternalRequest(
          targetModel,
          request,
          token.token.project_id ?? '',
          'generate-content',
          requestUserAgent,
        );
        this.applyInternalGenerationConstraints(internalBody, targetModel, token.id);

        const response = await generateInternalWithStreamFallback({
          geminiClient: this.geminiClient,
          body: internalBody,
          accessToken: token.token.access_token,
          upstreamProxyUrl: token.token.upstream_proxy_url,
          extraHeaders,
          configSnapshot,
          logger: this.logger,
        });

        return normalizeGeminiGenerateResponse(response);
      } catch (err) {
        if (err instanceof Error && isProjectContextError(err.message)) {
          this.logger.warn(
            `Gemini request hit project context issue, retrying without project: ${err.message}`,
          );
          try {
            const requestUserAgent = await resolveRequestUserAgent();
            const fallbackBody = createGeminiInternalRequest(
              targetModel,
              request,
              '',
              'generate-content',
              requestUserAgent,
            );
            this.applyInternalGenerationConstraints(fallbackBody, targetModel, token.id);
            const response = await generateInternalWithStreamFallback({
              geminiClient: this.geminiClient,
              body: fallbackBody,
              accessToken: token.token.access_token,
              upstreamProxyUrl: token.token.upstream_proxy_url,
              extraHeaders,
              configSnapshot,
              logger: this.logger,
            });
            return normalizeGeminiGenerateResponse(response);
          } catch (fallbackErr) {
            lastError = fallbackErr;
          }
        } else {
          lastError = err;
        }

        await this.applyUpstreamPenalty(token.id, targetModel, lastError);
      }
    }

    throw lastError || new Error('Gemini request failed after retries');
  }

  async handleGeminiStreamGenerateContent(
    model: string,
    request: GeminiRequest,
  ): Promise<Observable<string>> {
    const normalizedModel = normalizeGeminiModel(model);
    const configSnapshot = getServerConfig();
    const targetModel = resolveTargetModel(normalizedModel, configSnapshot);
    const extraHeaders = createModelSpecificHeaders(normalizedModel);
    this.logger.log(
      `Gemini stream request received: model=${normalizedModel}, mappedModel=${targetModel}`,
    );

    let lastError: unknown = null;
    const maxRetries = 3;
    const attemptedAccountIds = new Set<string>();

    for (let i = 0; i < maxRetries; i++) {
      if (i > 0) {
        const delay = calculateRetryDelay(i - 1);
        this.logger.log(`Gemini stream retry attempt ${i + 1}/${maxRetries}, waiting ${delay}ms`);
        await sleep(delay);
      }

      const token = await this.tokenManager.getNextToken({
        excludeAccountIds: Array.from(attemptedAccountIds),
        model: targetModel,
      });
      if (!token) {
        throw this.tokenManager.getCapacityError({
          excludeAccountIds: Array.from(attemptedAccountIds),
          model: targetModel,
        });
      }
      attemptedAccountIds.add(token.id);

      try {
        const requestUserAgent = await resolveRequestUserAgent();
        const internalBody = createGeminiInternalRequest(
          targetModel,
          request,
          token.token.project_id ?? '',
          'generate-content',
          requestUserAgent,
        );
        this.applyInternalGenerationConstraints(internalBody, targetModel, token.id);

        const stream = await this.geminiClient.streamGenerateInternal(
          internalBody,
          token.token.access_token,
          token.token.upstream_proxy_url,
          extraHeaders,
          configSnapshot,
        );
        return passthroughSseStream(stream);
      } catch (err) {
        if (err instanceof Error && isProjectContextError(err.message)) {
          this.logger.warn(
            `Gemini stream request hit project context issue, retrying without project: ${err.message}`,
          );
          try {
            const requestUserAgent = await resolveRequestUserAgent();
            const fallbackBody = createGeminiInternalRequest(
              targetModel,
              request,
              '',
              'generate-content',
              requestUserAgent,
            );
            this.applyInternalGenerationConstraints(fallbackBody, targetModel, token.id);
            const stream = await this.geminiClient.streamGenerateInternal(
              fallbackBody,
              token.token.access_token,
              token.token.upstream_proxy_url,
              extraHeaders,
              configSnapshot,
            );
            return passthroughSseStream(stream);
          } catch (fallbackErr) {
            lastError = fallbackErr;
          }
        } else {
          lastError = err;
        }

        await this.applyUpstreamPenalty(token.id, targetModel, lastError);
      }
    }

    throw lastError || new Error('Gemini stream request failed after retries');
  }

  private getModelOutputCap(accountId: string, model: string): number {
    const normalizedModel = normalizeModelIdentifier(model);
    const dynamicCap = this.tokenManager.getModelOutputLimitForAccount(accountId, normalizedModel);
    if (typeof dynamicCap === 'number' && Number.isFinite(dynamicCap) && dynamicCap > 0) {
      return Math.floor(dynamicCap);
    }
    return getMaxOutputTokens(normalizedModel);
  }

  private getModelThinkingBudget(accountId: string, model: string): number {
    const normalizedModel = normalizeModelIdentifier(model);
    const dynamicBudget = this.tokenManager.getModelThinkingBudgetForAccount(
      accountId,
      normalizedModel,
    );
    if (typeof dynamicBudget === 'number' && Number.isFinite(dynamicBudget) && dynamicBudget >= 0) {
      return Math.floor(dynamicBudget);
    }
    return getThinkingBudget(normalizedModel);
  }

  private applyInternalGenerationConstraints(
    body: GeminiInternalRequest,
    model: string,
    accountId: string,
  ): void {
    const generationConfig = body.request.generationConfig;
    if (!generationConfig) {
      return;
    }

    const outputCap = this.getModelOutputCap(accountId, model);
    const thinkingBudgetCap = this.getModelThinkingBudget(accountId, model);
    const normalizedModel = normalizeModelIdentifier(model).toLowerCase();
    const isClaudeModel = normalizedModel.includes('claude');
    const thinkingConfig = generationConfig.thinkingConfig as
      | ({ thinkingLevel?: string; thinkingBudget?: number } & Record<string, unknown>)
      | undefined;
    const adaptiveSentinel =
      thinkingConfig &&
      (typeof thinkingConfig.thinkingLevel === 'string' ||
        thinkingConfig.thinkingBudget === -1 ||
        thinkingConfig.thinkingBudget === 32768);

    if (thinkingConfig) {
      if (!isClaudeModel && typeof thinkingConfig.thinkingLevel === 'string') {
        const converted = resolveThinkingLevelBudget(thinkingConfig.thinkingLevel);
        if (converted !== undefined) {
          thinkingConfig.thinkingBudget = converted;
        }
        delete thinkingConfig.thinkingLevel;
      }

      if (typeof thinkingConfig.thinkingBudget === 'number' && thinkingConfig.thinkingBudget < 0) {
        thinkingConfig.thinkingBudget = Math.min(thinkingBudgetCap, 24576);
      }

      if (
        typeof thinkingConfig.thinkingBudget === 'number' &&
        Number.isFinite(thinkingConfig.thinkingBudget)
      ) {
        thinkingConfig.thinkingBudget = Math.min(
          Math.floor(thinkingConfig.thinkingBudget),
          Math.max(0, outputCap - 1),
          thinkingBudgetCap,
        );

        if (adaptiveSentinel) {
          if (
            generationConfig.maxOutputTokens === undefined ||
            generationConfig.maxOutputTokens < 131072
          ) {
            generationConfig.maxOutputTokens = 131072;
          }
        } else if (
          generationConfig.maxOutputTokens === undefined ||
          generationConfig.maxOutputTokens <= thinkingConfig.thinkingBudget
        ) {
          const hasExplicitMax = generationConfig.maxOutputTokens !== undefined;
          const overhead = hasExplicitMax ? 8192 : 32768;
          const minRequired = Math.min(outputCap, thinkingConfig.thinkingBudget + overhead);
          generationConfig.maxOutputTokens = minRequired;
        }
      }
    }

    if (
      typeof generationConfig.maxOutputTokens === 'number' &&
      Number.isFinite(generationConfig.maxOutputTokens)
    ) {
      generationConfig.maxOutputTokens = Math.min(
        Math.floor(generationConfig.maxOutputTokens),
        outputCap,
      );
    }
  }

  async handleChatCompletions(
    request: OpenAIChatRequest,
  ): Promise<OpenAIChatResponse | Observable<string>> {
    const sessionKey = extractOpenAISessionKey(request);
    const configSnapshot = getServerConfig();
    const targetModel = resolveTargetModel(request.model, configSnapshot);
    const extraHeaders = createModelSpecificHeaders(request.model);
    this.logger.log(
      `OpenAI-compatible request received: model=${request.model}, mappedModel=${targetModel}, stream=${request.stream}`,
    );

    // Retry loop for account selection
    let lastError: unknown = null;
    const maxRetries = 3;
    const attemptedAccountIds = new Set<string>();

    for (let i = 0; i < maxRetries; i++) {
      if (i > 0) {
        const delay = calculateRetryDelay(i - 1);
        this.logger.log(
          `OpenAI-compatible retry ${i + 1}/${maxRetries}, backoff=${delay}ms (jittered)`,
        );
        await sleep(delay);
      }

      // 1. Get Token
      const token = await this.tokenManager.getNextToken({
        sessionKey,
        excludeAccountIds: Array.from(attemptedAccountIds),
        model: targetModel,
      });
      if (!token) {
        throw this.tokenManager.getCapacityError({
          sessionKey,
          excludeAccountIds: Array.from(attemptedAccountIds),
          model: targetModel,
        });
      }
      attemptedAccountIds.add(token.id);

      try {
        const claudeRequest = convertOpenAIToClaude(request);
        const projectId = token.token.project_id ?? '';
        const requestUserAgent = await resolveRequestUserAgent();
        const geminiBody = transformClaudeRequestIn(claudeRequest, projectId, requestUserAgent);
        this.applyInternalGenerationConstraints(geminiBody, targetModel, token.id);

        // Use v1internal API (same as Anthropic handler)
        if (request.stream) {
          try {
            const stream = await this.geminiClient.streamGenerateInternal(
              geminiBody,
              token.token.access_token,
              token.token.upstream_proxy_url,
              extraHeaders,
              configSnapshot,
            );
            return processOpenAICompatibleStream(stream, request.model);
          } catch (streamError) {
            this.logger.warn(
              `Stream path failed for model=${request.model}; falling back to non-stream generation: ${
                streamError instanceof Error ? streamError.message : String(streamError)
              }`,
            );

            const response = await generateInternalWithStreamFallback({
              geminiClient: this.geminiClient,
              body: geminiBody,
              accessToken: token.token.access_token,
              upstreamProxyUrl: token.token.upstream_proxy_url,
              extraHeaders,
              configSnapshot,
              logger: this.logger,
            });
            this.logger.log(
              `Upstream response snippet after stream fallback: ${JSON.stringify(response).substring(0, 500)}`,
            );
            const claudeResponse = transformResponse(response);
            const openaiResponse = convertClaudeToOpenAIResponse(claudeResponse, request.model);
            return createSyntheticOpenAIStream(openaiResponse);
          }
        } else {
          const response = await generateInternalWithStreamFallback({
            geminiClient: this.geminiClient,
            body: geminiBody,
            accessToken: token.token.access_token,
            upstreamProxyUrl: token.token.upstream_proxy_url,
            extraHeaders,
            configSnapshot,
            logger: this.logger,
          });
          this.logger.log(
            `Upstream response snippet (non-stream): ${JSON.stringify(response).substring(0, 500)}`,
          );
          // Transform Gemini response to OpenAI format
          const claudeResponse = transformResponse(response);
          this.logger.log(
            `Transformed Claude response snippet: ${JSON.stringify(claudeResponse).substring(0, 500)}`,
          );
          return convertClaudeToOpenAIResponse(claudeResponse, request.model);
        }
      } catch (err) {
        if (err instanceof Error && isProjectContextError(err.message)) {
          this.logger.warn(
            `OpenAI compatibility request hit project context issue, retrying without project: ${err.message}`,
          );
          try {
            const claudeRequest = convertOpenAIToClaude(request);
            const requestUserAgent = await resolveRequestUserAgent();
            const fallbackBody = transformClaudeRequestIn(claudeRequest, '', requestUserAgent);
            this.applyInternalGenerationConstraints(fallbackBody, targetModel, token.id);
            if (request.stream) {
              const stream = await this.geminiClient.streamGenerateInternal(
                fallbackBody,
                token.token.access_token,
                token.token.upstream_proxy_url,
                extraHeaders,
                configSnapshot,
              );
              return processOpenAICompatibleStream(stream, request.model);
            }

            const response = await generateInternalWithStreamFallback({
              geminiClient: this.geminiClient,
              body: fallbackBody,
              accessToken: token.token.access_token,
              upstreamProxyUrl: token.token.upstream_proxy_url,
              extraHeaders,
              configSnapshot,
              logger: this.logger,
            });
            const claudeResponse = transformResponse(response);
            return convertClaudeToOpenAIResponse(claudeResponse, request.model);
          } catch (fallbackErr) {
            lastError = fallbackErr;
          }
        } else {
          lastError = err;
        }

        await this.applyUpstreamPenalty(token.id, targetModel, lastError);
      }
    }
    throw lastError || new Error('Request failed after retries');
  }

  private async applyUpstreamPenalty(
    accountId: string,
    model: string,
    error: unknown,
  ): Promise<void> {
    this.tokenManager.recordParityError();

    if (error instanceof UpstreamRequestError) {
      const status = error.status;
      if (status === 401 || status === 403) {
        this.tokenManager.markAsForbidden(accountId);
        return;
      }

      await this.tokenManager.markFromUpstreamError({
        accountIdOrEmail: accountId,
        status,
        retryAfter: error.headers?.retryAfter,
        body: error.body,
        model,
      });
      return;
    }

    if (!(error instanceof Error)) {
      return;
    }

    this.logger.warn(`Upstream request failed for account ${accountId}: ${error.message}`);
    const penaltyDecision = classifyUpstreamFailure(error.message);
    if (!penaltyDecision.retry) {
      return;
    }

    if (penaltyDecision.markAsForbidden) {
      this.tokenManager.markAsForbidden(accountId);
      return;
    }

    if (penaltyDecision.markAsRateLimited) {
      this.tokenManager.markAsRateLimited(accountId);
    }
  }
}
