import { describe, expect, it } from 'vitest';

import type { CloudAccount } from '@/types/cloudAccount';
import { collectAvailableModelIds, summarizeModelVisibility } from '@/utils/model-visibility';

const buildAccount = (
  models: Record<string, { percentage: number; resetTime: string }>,
): CloudAccount =>
  ({
    id: 'account-1',
    provider: 'google',
    email: 'user@example.com',
    token: {
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 3600,
      expiry_timestamp: 1,
      token_type: 'Bearer',
    },
    quota: {
      models,
    },
    created_at: 1,
    last_used: 1,
  }) as CloudAccount;

describe('model visibility helpers', () => {
  it('collects only supported quota models from available accounts', () => {
    const modelIds = collectAvailableModelIds([
      buildAccount({
        'gemini-3-flash': { percentage: 80, resetTime: '2026-03-24T00:00:00Z' },
        'gemini-1.5-pro': { percentage: 50, resetTime: '2026-03-24T00:00:00Z' },
        'claude-sonnet-4-6': { percentage: 40, resetTime: '2026-03-24T00:00:00Z' },
      }),
    ]);

    expect(modelIds).toEqual(['claude-sonnet-4-6', 'gemini-3-flash']);
  });

  it('ignores stale hidden config entries that are not available anymore', () => {
    const stats = summarizeModelVisibility(['claude-sonnet-4-6', 'gemini-3-flash'], {
      'claude-sonnet-4-6': false,
      'removed-model': false,
    });

    expect(stats).toEqual({
      totalCount: 2,
      visibleCount: 1,
      hiddenCount: 1,
    });
  });
});
