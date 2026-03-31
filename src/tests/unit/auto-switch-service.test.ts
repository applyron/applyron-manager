import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudAccount } from '../../types/cloudAccount';

const getSettingMock = vi.fn();
const getAccountsMock = vi.fn();
const switchCloudAccountMock = vi.fn();
const isProcessRunningMock = vi.fn();

vi.mock('../../ipc/database/cloudHandler', () => ({
  CloudAccountRepo: {
    getSetting: getSettingMock,
    getAccounts: getAccountsMock,
  },
}));

vi.mock('../../ipc/cloud/handler', () => ({
  switchCloudAccount: switchCloudAccountMock,
}));

vi.mock('../../ipc/process/handler', () => ({
  isProcessRunning: isProcessRunningMock,
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function createCloudAccount(overrides: Partial<CloudAccount> = {}): CloudAccount {
  return {
    id: 'account-id',
    provider: 'google',
    email: 'account@example.com',
    token: {
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 3600,
      expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
    },
    quota: {
      models: {
        'gemini-3-flash': {
          percentage: 80,
          resetTime: 'soon',
        },
      },
    },
    created_at: 1,
    last_used: 1,
    status: 'active',
    is_active: false,
    ...overrides,
  };
}

describe('AutoSwitchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isProcessRunningMock.mockResolvedValue(false);
  });

  it('does not switch accounts when auto-switch is disabled', async () => {
    getSettingMock.mockReturnValue(false);
    getAccountsMock.mockResolvedValue([
      createCloudAccount({
        id: 'active-account',
        email: 'active@example.com',
        is_active: true,
        quota: {
          models: {
            'gemini-3-flash': {
              percentage: 3,
              resetTime: 'soon',
            },
          },
        },
      }),
      createCloudAccount({
        id: 'healthy-account',
        email: 'healthy@example.com',
      }),
    ]);

    const { AutoSwitchService } = await import('../../services/AutoSwitchService');
    const result = await AutoSwitchService.checkAndSwitchIfNeeded();

    expect(result).toBe('idle');
    expect(switchCloudAccountMock).not.toHaveBeenCalled();
  });

  it('switches to the healthiest account during a scheduled poll when the IDE is idle', async () => {
    getSettingMock.mockReturnValue(true);
    getAccountsMock.mockResolvedValue([
      createCloudAccount({
        id: 'active-account',
        email: 'active@example.com',
        is_active: true,
        quota: {
          models: {
            'gemini-3-flash': {
              percentage: 2,
              resetTime: 'soon',
            },
          },
        },
      }),
      createCloudAccount({
        id: 'healthy-account',
        email: 'healthy@example.com',
        quota: {
          models: {
            'gemini-3-flash': {
              percentage: 92,
              resetTime: 'soon',
            },
          },
        },
      }),
      createCloudAccount({
        id: 'weaker-account',
        email: 'weaker@example.com',
        quota: {
          models: {
            'gemini-3-flash': {
              percentage: 51,
              resetTime: 'soon',
            },
          },
        },
      }),
    ]);

    const { AutoSwitchService } = await import('../../services/AutoSwitchService');
    const result = await AutoSwitchService.checkAndSwitchIfNeeded({ trigger: 'scheduled' });

    expect(result).toBe('switched');
    expect(switchCloudAccountMock).toHaveBeenCalledWith('healthy-account');
  });

  it('defers auto-switch on focus-triggered polls', async () => {
    getSettingMock.mockReturnValue(true);
    getAccountsMock.mockResolvedValue([
      createCloudAccount({
        id: 'active-account',
        email: 'active@example.com',
        is_active: true,
        quota: {
          models: {
            'gemini-3-flash': {
              percentage: 2,
              resetTime: 'soon',
            },
          },
        },
      }),
      createCloudAccount({
        id: 'healthy-account',
        email: 'healthy@example.com',
      }),
    ]);

    const { AutoSwitchService } = await import('../../services/AutoSwitchService');
    const result = await AutoSwitchService.checkAndSwitchIfNeeded({ trigger: 'focus' });

    expect(result).toBe('deferred');
    expect(switchCloudAccountMock).not.toHaveBeenCalled();
    expect(isProcessRunningMock).not.toHaveBeenCalled();
  });
});
