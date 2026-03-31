import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProxyAccountCacheService } from '../../server/modules/proxy/proxy-account-cache.service';
import { CloudAccountRepo } from '../../ipc/database/cloudHandler';

vi.mock('../../ipc/database/cloudHandler');

function createCloudAccount(accountId: string, overrides?: Partial<any>) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    id: accountId,
    provider: 'google',
    email: `${accountId}@example.com`,
    token: {
      access_token: `access-${accountId}`,
      refresh_token: `refresh-${accountId}`,
      token_type: 'Bearer',
      expires_in: 3600,
      expiry_timestamp: nowSec + 3600,
      project_id: `project-${accountId}`,
      ...(overrides?.token ?? {}),
    },
    quota: overrides?.quota,
    created_at: 1,
    last_used: 1,
    ...overrides,
  };
}

describe('ProxyAccountCacheService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies empty-load negative cache for 30 seconds', async () => {
    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([] as never);

    const cache = new ProxyAccountCacheService();

    expect(await cache.loadAccounts()).toBe(0);
    expect(await cache.loadAccounts()).toBe(0);
    expect(CloudAccountRepo.getAccounts).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_001);

    expect(await cache.loadAccounts()).toBe(0);
    expect(CloudAccountRepo.getAccounts).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent loads and atomically swaps token maps', async () => {
    let resolveAccounts!: (value: unknown) => void;
    const getAccountsPromise = new Promise((resolve) => {
      resolveAccounts = resolve;
    });
    vi.mocked(CloudAccountRepo.getAccounts).mockImplementation(() => getAccountsPromise as never);

    const cache = new ProxyAccountCacheService();
    cache.replaceTokens(
      new Map([
        [
          'old-account',
          {
            account_id: 'old-account',
            email: 'old-account@example.com',
            access_token: 'old-access',
            refresh_token: 'old-refresh',
            token_type: 'Bearer',
            expires_in: 3600,
            expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
            project_id: 'old-project',
            session_id: 'old-session',
            quota: undefined,
            model_quotas: {},
            model_limits: {},
            model_reset_times: {},
            model_forwarding_rules: {},
          },
        ],
      ]),
    );

    const firstLoad = cache.loadAccounts({ force: true });
    const secondLoad = cache.loadAccounts({ force: true });

    expect(CloudAccountRepo.getAccounts).toHaveBeenCalledTimes(1);
    expect(cache.get('old-account')?.access_token).toBe('old-access');

    resolveAccounts([createCloudAccount('new-account')]);
    await Promise.all([firstLoad, secondLoad]);

    expect(cache.get('old-account')).toBeUndefined();
    expect(cache.get('new-account')?.access_token).toBe('access-new-account');
  });
});
