import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_CONFIG } from '@/types/config';
import { setServerConfig } from '@/server/server-config';
import {
  classifyUpstreamFailure,
  createModelSpecificHeaders,
  extractAnthropicSessionKey,
  extractOpenAISessionKey,
  normalizeGeminiModel,
  normalizeModelIdentifier,
  resolveTargetModel,
  resolveThinkingLevelBudget,
} from '@/server/modules/proxy/proxy-routing-helpers';

describe('proxy routing helpers', () => {
  it('normalizes Gemini model identifiers', () => {
    expect(normalizeGeminiModel('models/gemini-3-flash')).toBe('gemini-3-flash');
    expect(normalizeModelIdentifier('models/gemini-3-flash ')).toBe('gemini-3-flash');
  });

  it('maps thinking levels to concrete budgets', () => {
    expect(resolveThinkingLevelBudget('LOW')).toBe(4096);
    expect(resolveThinkingLevelBudget('MEDIUM')).toBe(8192);
    expect(resolveThinkingLevelBudget('HIGH')).toBe(24576);
    expect(resolveThinkingLevelBudget('NONE')).toBe(0);
  });

  it('classifies retryable upstream failures and rate limits', () => {
    expect(classifyUpstreamFailure('429 resource_exhausted')).toEqual({
      retry: true,
      markAsForbidden: false,
      markAsRateLimited: true,
    });
    expect(classifyUpstreamFailure('403 forbidden')).toEqual({
      retry: true,
      markAsForbidden: true,
      markAsRateLimited: false,
    });
    expect(classifyUpstreamFailure('validation failed')).toEqual({
      retry: false,
      markAsForbidden: false,
      markAsRateLimited: false,
    });
  });

  it('builds model-specific headers only for Claude models', () => {
    expect(createModelSpecificHeaders('claude-sonnet')['anthropic-beta']).toContain(
      'claude-code-20250219',
    );
    expect(createModelSpecificHeaders('gemini-3-flash')).toEqual({});
  });

  it('extracts stable session keys from Anthropic and OpenAI payloads', () => {
    expect(
      extractAnthropicSessionKey({
        metadata: { session_id: 'abc' },
      } as never),
    ).toBe('anthropic:abc');
    expect(
      extractOpenAISessionKey({
        extra: { userId: 'xyz' },
      } as never),
    ).toBe('openai:xyz');
  });

  it('uses the supplied config snapshot for model resolution', () => {
    setServerConfig({
      ...DEFAULT_APP_CONFIG.proxy,
      custom_mapping: {
        'gpt-4o': 'gemini-live-global',
      },
    });

    const requestSnapshot = {
      ...DEFAULT_APP_CONFIG.proxy,
      custom_mapping: {
        'gpt-4o': 'gemini-live-request',
      },
    };

    expect(resolveTargetModel('gpt-4o', requestSnapshot)).toBe('gemini-live-request');
  });
});
