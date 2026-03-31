import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloudAccount } from '@/types/cloudAccount';

const {
  mockUseAppConfig,
  mockUseProviderGrouping,
  mockGetCanonicalVisibleQuotaModels,
  mockSummarizeCanonicalQuotaModels,
} = vi.hoisted(() => ({
  mockUseAppConfig: vi.fn(),
  mockUseProviderGrouping: vi.fn(),
  mockGetCanonicalVisibleQuotaModels: vi.fn(() => [
    {
      id: 'gemini-3-flash',
      displayName: 'Gemini 3 Flash',
      percentage: 80,
      resetTime: '2026-02-16T10:00:00Z',
    },
  ]),
  mockSummarizeCanonicalQuotaModels: vi.fn(() => ({
    geminiModels: [
      {
        id: 'gemini-3-flash',
        displayName: 'Gemini 3 Flash',
        percentage: 80,
        resetTime: '2026-02-16T10:00:00Z',
      },
    ],
    claudeModels: [],
    overallPercentage: 80,
    visibleModelCount: 1,
  })),
}));

vi.mock('@/hooks/useAppConfig', () => ({
  useAppConfig: () => mockUseAppConfig(),
}));

vi.mock('@/hooks/useProviderGrouping', () => ({
  useProviderGrouping: () => mockUseProviderGrouping(),
}));

vi.mock('@/utils/cloud-quota-models', () => ({
  getCanonicalVisibleQuotaModels: mockGetCanonicalVisibleQuotaModels,
  summarizeCanonicalQuotaModels: mockSummarizeCanonicalQuotaModels,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'a11y.menu': 'Menu',
        'a11y.expand': 'Expand',
        'a11y.collapse': 'Collapse',
        'cloud.card.active': 'Active',
        'cloud.card.rateLimited': 'Rate Limited',
        'cloud.card.expired': 'Expired',
        'cloud.card.actions': 'Actions',
        'cloud.card.useAccount': 'Use Account',
        'cloud.card.refresh': 'Refresh Quota',
        'cloud.card.identityProfile': 'Identity Profile',
        'cloud.card.delete': 'Delete Account',
        'cloud.card.quotaUsage': 'QUOTA USAGE',
        'cloud.card.noQuota': 'No quota data',
        'cloud.card.groupGoogleGemini': 'Google Gemini',
        'cloud.card.groupAnthropicClaude': 'Anthropic Claude',
        'cloud.card.left': 'left',
        'cloud.card.rateLimitedQuota': 'Rate Limited',
        'cloud.card.resetPrefix': 'reset',
        'cloud.card.resetUnknown': 'Unknown',
        'cloud.card.resetTime': 'Reset time',
      };

      if (key === 'settings.providerGroupings.models') {
        return `${String(options?.count ?? 0)} models`;
      }

      if (key === 'account.lastUsed') {
        return `Last used ${String(options?.time ?? '')}`;
      }

      return translations[key] ?? key;
    },
  }),
}));

import { CloudAccountCard } from '@/components/CloudAccountCard';

function createAccount(
  quotaModels: NonNullable<CloudAccount['quota']>['models'],
  overrides: Partial<CloudAccount> = {},
): CloudAccount {
  return {
    id: 'cloud-1',
    provider: 'google',
    email: 'gemini@example.com',
    name: 'Gemini User',
    avatar_url: null,
    token: {
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 3600,
      expiry_timestamp: 1_800_000_000,
      token_type: 'Bearer',
      email: 'gemini@example.com',
    },
    quota: {
      models: quotaModels,
    },
    created_at: 1_700_000_000,
    last_used: Math.floor(Date.now() / 1000) - 60,
    status: 'active',
    is_active: false,
    ...overrides,
  };
}

describe('CloudAccountCard memo verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAppConfig.mockReturnValue({
      config: {
        model_visibility: {},
      },
    });
    mockUseProviderGrouping.mockReturnValue({
      enabled: false,
      getAccountStats: vi.fn(() => null),
      isProviderCollapsed: vi.fn(() => false),
      toggleProviderCollapse: vi.fn(),
    });
  });

  it('does not recompute canonical quota data on rerender with stable dependencies', () => {
    const sharedModels = {
      'gemini-3-flash': {
        percentage: 80,
        resetTime: '2026-02-16T10:00:00Z',
      },
    };
    const stableAccount = createAccount(sharedModels);

    const view = render(
      React.createElement(CloudAccountCard, {
        account: stableAccount,
        onRefresh: vi.fn(),
        onDelete: vi.fn(),
        onSwitch: vi.fn(),
        onManageIdentity: vi.fn(),
      }),
    );

    expect(mockGetCanonicalVisibleQuotaModels).toHaveBeenCalledTimes(1);
    expect(mockSummarizeCanonicalQuotaModels).toHaveBeenCalledTimes(1);

    view.rerender(
      React.createElement(CloudAccountCard, {
        account: stableAccount,
        onRefresh: vi.fn(),
        onDelete: vi.fn(),
        onSwitch: vi.fn(),
        onManageIdentity: vi.fn(),
      }),
    );

    expect(mockGetCanonicalVisibleQuotaModels).toHaveBeenCalledTimes(1);
    expect(mockSummarizeCanonicalQuotaModels).toHaveBeenCalledTimes(1);
  });

  it('keeps memoized quota computation stable when unrelated account fields change', () => {
    const sharedModels = {
      'gemini-3-flash': {
        percentage: 80,
        resetTime: '2026-02-16T10:00:00Z',
      },
    };

    const firstAccount = createAccount(sharedModels, { last_used: 100 });
    const secondAccount = createAccount(sharedModels, { last_used: 200 });

    const view = render(
      React.createElement(CloudAccountCard, {
        account: firstAccount,
        onRefresh: vi.fn(),
        onDelete: vi.fn(),
        onSwitch: vi.fn(),
        onManageIdentity: vi.fn(),
      }),
    );

    expect(mockGetCanonicalVisibleQuotaModels).toHaveBeenCalledTimes(1);
    expect(mockSummarizeCanonicalQuotaModels).toHaveBeenCalledTimes(1);

    view.rerender(
      React.createElement(CloudAccountCard, {
        account: secondAccount,
        onRefresh: vi.fn(),
        onDelete: vi.fn(),
        onSwitch: vi.fn(),
        onManageIdentity: vi.fn(),
      }),
    );

    expect(mockGetCanonicalVisibleQuotaModels).toHaveBeenCalledTimes(1);
    expect(mockSummarizeCanonicalQuotaModels).toHaveBeenCalledTimes(1);
  });
});
