import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudAccountCard } from '@/components/CloudAccountCard';
import type { CloudAccount } from '@/types/cloudAccount';
import type { AccountStats } from '@/utils/provider-grouping';

const mockUseAppConfig = vi.fn();
const mockUseProviderGrouping = vi.fn();

vi.mock('@/hooks/useAppConfig', () => ({
  useAppConfig: () => mockUseAppConfig(),
}));

vi.mock('@/hooks/useProviderGrouping', () => ({
  useProviderGrouping: () => mockUseProviderGrouping(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'a11y.menu': 'Menu',
        'a11y.expand': 'Expand',
        'a11y.collapse': 'Collapse',
        'a11y.expandAccount': 'Expand {{target}}',
        'a11y.collapseAccount': 'Collapse {{target}}',
        'a11y.selectAccount': 'Select {{target}}',
        'a11y.actionsFor': 'Actions for {{target}}',
        'a11y.toggleProviderGroup': 'Toggle {{provider}} group',
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

      let template = translations[key] ?? key;
      if (options) {
        for (const [optionKey, optionValue] of Object.entries(options)) {
          template = template.replace(`{{${optionKey}}}`, String(optionValue));
        }
      }

      return template;
    },
  }),
}));

function createAccount(overrides: Partial<CloudAccount> = {}): CloudAccount {
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
      models: {
        'gemini-3-flash': {
          percentage: 80,
          resetTime: '2026-02-16T10:00:00Z',
        },
      },
    },
    created_at: 1_700_000_000,
    last_used: Math.floor(Date.now() / 1000) - 60,
    status: 'active',
    is_active: false,
    ...overrides,
  };
}

function createProviderStats(overrides: Partial<AccountStats> = {}): AccountStats {
  return {
    providers: [
      {
        providerKey: 'gemini-',
        providerInfo: { name: 'Gemini', company: 'Google', color: '#4285F4' },
        models: [],
        visibleModels: [],
        avgPercentage: 80,
        earliestReset: null,
      },
    ],
    totalModels: 1,
    visibleModels: 1,
    overallPercentage: 80,
    healthStatus: 'healthy',
    ...overrides,
  };
}

describe('CloudAccountCard', () => {
  beforeEach(() => {
    mockUseAppConfig.mockReturnValue({
      config: {
        model_visibility: {},
      },
    });
    mockUseProviderGrouping.mockReturnValue({
      enabled: false,
      getAccountStats: vi.fn(() => createProviderStats()),
      isProviderCollapsed: vi.fn(() => false),
      toggleProviderCollapse: vi.fn(),
    });
  });

  it('does not expose the use-account menu item for the active account', async () => {
    render(
      React.createElement(CloudAccountCard, {
        account: createAccount({ is_active: true, status: 'active' }),
        onRefresh: vi.fn(),
        onDelete: vi.fn(),
        onSwitch: vi.fn(),
        onManageIdentity: vi.fn(),
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Gemini User' }));

    expect(await screen.findByRole('menuitem', { name: 'Refresh Quota' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Use Account' })).toBeNull();
  });

  it('renders an explicit expired status badge', () => {
    render(
      React.createElement(CloudAccountCard, {
        account: createAccount({ status: 'expired' }),
        onRefresh: vi.fn(),
        onDelete: vi.fn(),
        onSwitch: vi.fn(),
        onManageIdentity: vi.fn(),
      }),
    );

    expect(screen.getByText('Expired')).toBeTruthy();
  });

  it('keeps hover behavior out of inline DOM mutation and marks selected state explicitly', () => {
    render(
      React.createElement(CloudAccountCard, {
        account: createAccount(),
        onRefresh: vi.fn(),
        onDelete: vi.fn(),
        onSwitch: vi.fn(),
        onManageIdentity: vi.fn(),
        isSelected: true,
      }),
    );

    const card = screen.getByTestId('cloud-account-card-cloud-1');

    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);

    expect(card.getAttribute('style')).toBeNull();
    expect(card.getAttribute('data-selected')).toBe('true');
  });

  it('uses display_name in the expanded direct model list', async () => {
    render(
      React.createElement(CloudAccountCard, {
        account: createAccount({
          is_active: true,
          quota: {
            models: {
              'gemini-3-flash': {
                percentage: 80,
                resetTime: '2026-02-16T10:00:00Z',
                display_name: 'Gemini 3 Flash API Label',
              },
            },
          },
        }),
        onRefresh: vi.fn(),
        onDelete: vi.fn(),
        onSwitch: vi.fn(),
        onManageIdentity: vi.fn(),
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Expand Gemini User' }));
    expect(screen.getByText('Gemini 3 Flash API Label')).toBeTruthy();
  });

  it('uses display_name in provider grouping rows', async () => {
    mockUseProviderGrouping.mockReturnValue({
      enabled: true,
      getAccountStats: vi.fn(() =>
        createProviderStats({
          providers: [
            {
              providerKey: 'gemini-',
              providerInfo: { name: 'Gemini', company: 'Google', color: '#4285F4' },
              models: [
                {
                  id: 'gemini-3-flash',
                  displayName: 'Gemini 3 Flash API Label',
                  percentage: 80,
                  resetTime: '2026-02-16T10:00:00Z',
                },
              ],
              visibleModels: [
                {
                  id: 'gemini-3-flash',
                  displayName: 'Gemini 3 Flash API Label',
                  percentage: 80,
                  resetTime: '2026-02-16T10:00:00Z',
                },
              ],
              avgPercentage: 80,
              earliestReset: '2026-02-16T10:00:00Z',
            },
          ],
        }),
      ),
      isProviderCollapsed: vi.fn(() => false),
      toggleProviderCollapse: vi.fn(),
    });

    render(
      React.createElement(CloudAccountCard, {
        account: createAccount({ is_active: true }),
        onRefresh: vi.fn(),
        onDelete: vi.fn(),
        onSwitch: vi.fn(),
        onManageIdentity: vi.fn(),
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Expand Gemini User' }));
    expect(screen.getByText('Gemini 3 Flash API Label')).toBeTruthy();
  });
});
