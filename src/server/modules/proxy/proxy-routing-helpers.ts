import { isPlainObject, isString } from 'lodash-es';
import { getServerConfig } from '../../server-config';
import type { ProxyConfig } from '../../../types/config';
import {
  normalizeGeminiModelAlias,
  resolveModelRoute,
} from '../../../lib/antigravity/ModelMapping';
import type { AnthropicChatRequest, OpenAIChatRequest } from './interfaces/request-interfaces';
import type { GeminiPart as InternalGeminiPart } from '../../../lib/antigravity/types';

export function normalizeGeminiModel(model: string): string {
  return model.replace(/^models\//i, '');
}

export function normalizeModelIdentifier(model: string): string {
  return model.replace(/^models\//i, '').trim();
}

export function resolveThinkingLevelBudget(level: string): number | undefined {
  const normalized = level.trim().toUpperCase();
  if (normalized === 'NONE') {
    return 0;
  }
  if (normalized === 'LOW') {
    return 4096;
  }
  if (normalized === 'MEDIUM') {
    return 8192;
  }
  if (normalized === 'HIGH') {
    return 24576;
  }
  return undefined;
}

export function resolveTargetModel(
  model: string,
  configSnapshot?: Readonly<ProxyConfig> | null,
): string {
  const normalizedModel = model.replace(/^models\//i, '').trim();
  const config = configSnapshot ?? getServerConfig();
  const configuredMapping = {
    ...(config?.custom_mapping ?? {}),
    ...(config?.anthropic_mapping ?? {}),
  };

  const customExactMapping: Record<string, string> = {};
  const wildcardMapping: Array<{
    pattern: RegExp;
    target: string;
  }> = [];

  for (const [key, target] of Object.entries(configuredMapping)) {
    if (!key || !target) {
      continue;
    }

    if (key.includes('*')) {
      const escaped = key.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      wildcardMapping.push({
        pattern: new RegExp(`^${escaped}$`, 'i'),
        target,
      });
      continue;
    }

    customExactMapping[key] = target;
  }

  for (const wildcardRule of wildcardMapping) {
    if (wildcardRule.pattern.test(normalizedModel)) {
      return wildcardRule.target;
    }
  }

  const routedModel = resolveModelRoute(normalizedModel, customExactMapping, {}, {});
  return normalizeGeminiModelAlias(routedModel);
}

export function classifyUpstreamFailure(errorMessage: string): {
  retry: boolean;
  markAsForbidden: boolean;
  markAsRateLimited: boolean;
} {
  const normalizedErrorMessage = errorMessage.toLowerCase();
  const isForbidden =
    normalizedErrorMessage.includes('401') ||
    normalizedErrorMessage.includes('unauthorized') ||
    normalizedErrorMessage.includes('invalid_grant') ||
    normalizedErrorMessage.includes('403') ||
    normalizedErrorMessage.includes('permission_denied') ||
    normalizedErrorMessage.includes('forbidden');

  if (isForbidden) {
    return {
      retry: true,
      markAsForbidden: true,
      markAsRateLimited: false,
    };
  }

  const isRateLimitedSignal =
    normalizedErrorMessage.includes('429') ||
    normalizedErrorMessage.includes('resource_exhausted') ||
    normalizedErrorMessage.includes('quota') ||
    normalizedErrorMessage.includes('rate_limit') ||
    normalizedErrorMessage.includes('rate limit');

  const shouldRetryByStatus =
    normalizedErrorMessage.includes('408') ||
    normalizedErrorMessage.includes('429') ||
    normalizedErrorMessage.includes('500') ||
    normalizedErrorMessage.includes('502') ||
    normalizedErrorMessage.includes('503') ||
    normalizedErrorMessage.includes('504');

  const shouldRetryByKeyword =
    normalizedErrorMessage.includes('resource_exhausted') ||
    normalizedErrorMessage.includes('quota') ||
    normalizedErrorMessage.includes('rate_limit') ||
    normalizedErrorMessage.includes('timeout') ||
    normalizedErrorMessage.includes('socket hang up') ||
    normalizedErrorMessage.includes('empty response stream') ||
    normalizedErrorMessage.includes('connection reset');

  if (shouldRetryByStatus || shouldRetryByKeyword) {
    return {
      retry: true,
      markAsForbidden: false,
      markAsRateLimited: isRateLimitedSignal,
    };
  }

  return {
    retry: false,
    markAsForbidden: false,
    markAsRateLimited: false,
  };
}

export function createModelSpecificHeaders(model: string | undefined): Record<string, string> {
  if (!model) {
    return {};
  }

  if (model.toLowerCase().includes('claude')) {
    return {
      'anthropic-beta':
        'claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
    };
  }

  return {};
}

export function isProjectLicenseError(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes('#3501') ||
    (msg.includes('google cloud project') && msg.includes('code assist license'))
  );
}

export function isProjectNotFoundError(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes('invalid project resource name projects/') ||
    (msg.includes('resource projects/') && msg.includes('could not be found')) ||
    (msg.includes('project') && msg.includes('not found'))
  );
}

export function isProjectContextError(errorMessage: string): boolean {
  return isProjectLicenseError(errorMessage) || isProjectNotFoundError(errorMessage);
}

export function isQuotaExhaustedError(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes('resource has been exhausted') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota')
  );
}

export function extractAnthropicSessionKey(request: AnthropicChatRequest): string | undefined {
  const metadata = request.metadata;
  const sessionCandidate =
    metadata?.session_id ?? metadata?.sessionId ?? metadata?.user_id ?? metadata?.userId;
  if (!isString(sessionCandidate) || sessionCandidate.trim() === '') {
    return undefined;
  }
  return `anthropic:${sessionCandidate.trim()}`;
}

export function extractOpenAISessionKey(request: OpenAIChatRequest): string | undefined {
  const extra = request.extra;
  const sessionCandidate = extra?.session_id ?? extra?.sessionId ?? extra?.user_id ?? extra?.userId;
  if (!isString(sessionCandidate) || sessionCandidate.trim() === '') {
    return undefined;
  }
  return `openai:${sessionCandidate.trim()}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}

export function isGeminiPart(value: unknown): value is InternalGeminiPart {
  return isRecord(value);
}
