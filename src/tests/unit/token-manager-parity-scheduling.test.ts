import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_CONFIG, ProxyConfig } from '../../types/config';
import { setServerConfig } from '../../server/server-config';
import { TokenManagerService } from '../../server/modules/proxy/token-manager.service';
import { GoogleAPIService } from '../../services/GoogleAPIService';
import { CloudAccountRepo } from '../../ipc/database/cloudHandler';

function createProxyConfig(overrides: Partial<ProxyConfig>): ProxyConfig {
  return {
    ...DEFAULT_APP_CONFIG.proxy,
    ...overrides,
    upstream_proxy: {
      ...DEFAULT_APP_CONFIG.proxy.upstream_proxy,
      ...(overrides.upstream_proxy ?? {}),
    },
  };
}

function seedTokens(service: TokenManagerService): void {
  const nowSec = Math.floor(Date.now() / 1000);
  (service as any).tokens = new Map([
    [
      'acc-1',
      {
        account_id: 'acc-1',
        email: 'acc-1@test.dev',
        access_token: 'token-1',
        refresh_token: 'refresh-1',
        token_type: 'Bearer',
        expires_in: 3600,
        expiry_timestamp: nowSec + 3600,
        project_id: 'project-1',
        session_id: 'session-1',
      },
    ],
    [
      'acc-2',
      {
        account_id: 'acc-2',
        email: 'acc-2@test.dev',
        access_token: 'token-2',
        refresh_token: 'refresh-2',
        token_type: 'Bearer',
        expires_in: 3600,
        expiry_timestamp: nowSec + 3600,
        project_id: 'project-2',
        session_id: 'session-2',
      },
    ],
  ]);
}

describe('TokenManagerService parity scheduling replay', () => {
  let service: TokenManagerService;

  beforeEach(() => {
    service = new TokenManagerService();
    seedTokens(service);
  });

  it('prioritizes preferred account in parity mode', async () => {
    setServerConfig(
      createProxyConfig({
        parity_enabled: true,
        parity_kill_switch: false,
        scheduling_mode: 'balance',
        preferred_account_id: 'acc-2',
      }),
    );

    const token = await service.getNextToken({ model: 'gemini-2.5-flash' });
    expect(token?.id).toBe('acc-2');
  });

  it('rotates sticky account when limited in balance mode', async () => {
    setServerConfig(
      createProxyConfig({
        parity_enabled: true,
        parity_kill_switch: false,
        scheduling_mode: 'balance',
        preferred_account_id: '',
      }),
    );

    const first = await service.getNextToken({
      sessionKey: 'openai:user-1',
      model: 'gemini-2.5-flash',
    });
    expect(first?.id).toBe('acc-1');

    await service.markFromUpstreamError({
      accountIdOrEmail: 'acc-1',
      status: 429,
      model: 'gemini-2.5-flash',
      body: JSON.stringify({
        error: {
          details: [{ reason: 'RATE_LIMIT_EXCEEDED' }],
        },
      }),
    });

    const second = await service.getNextToken({
      sessionKey: 'openai:user-1',
      model: 'gemini-2.5-flash',
    });
    expect(second?.id).toBe('acc-2');
  });

  it('applies model-level lock for quota exhausted only on the same model', async () => {
    setServerConfig(
      createProxyConfig({
        parity_enabled: true,
        parity_kill_switch: false,
        scheduling_mode: 'performance-first',
      }),
    );

    await service.markFromUpstreamError({
      accountIdOrEmail: 'acc-1',
      status: 429,
      model: 'gemini-2.5-flash',
      body: JSON.stringify({
        error: {
          details: [{ reason: 'QUOTA_EXHAUSTED', metadata: { quotaResetDelay: '30s' } }],
        },
      }),
    });

    const sameModel = await service.getNextToken({ model: 'gemini-2.5-flash' });
    expect(sameModel?.id).toBe('acc-2');

    const otherModel = await service.getNextToken({
      model: 'gemini-2.5-pro',
      excludeAccountIds: ['acc-2'],
    });
    expect(otherModel?.id).toBe('acc-1');
  });

  it('falls back to excluded pool when retry exclusions would empty all candidates', async () => {
    setServerConfig(
      createProxyConfig({
        parity_enabled: false,
        parity_kill_switch: false,
      }),
    );

    const nowSec = Math.floor(Date.now() / 1000);
    (service as any).tokens = new Map([
      [
        'acc-1',
        {
          account_id: 'acc-1',
          email: 'acc-1@test.dev',
          access_token: 'token-1',
          refresh_token: 'refresh-1',
          token_type: 'Bearer',
          expires_in: 3600,
          expiry_timestamp: nowSec + 3600,
          project_id: 'project-1',
          session_id: 'session-1',
        },
      ],
    ]);

    const token = await service.getNextToken({ excludeAccountIds: ['acc-1'] });
    expect(token?.id).toBe('acc-1');
  });

  it('does not bypass legacy cooldowns when every account is cooling down', async () => {
    setServerConfig(
      createProxyConfig({
        parity_enabled: false,
        parity_kill_switch: false,
      }),
    );

    (service as any).accountCooldowns.set('acc-1', Date.now() + 15_000);
    (service as any).accountCooldowns.set('acc-2', Date.now() + 8_000);

    const token = await service.getNextToken();
    const capacityError = service.getCapacityError();

    expect(token).toBeNull();
    expect(capacityError.status).toBe(503);
    expect(capacityError.reason).toBe('accounts_cooling_down');
    expect(capacityError.retryAfterSec).toBeGreaterThanOrEqual(2);
  });

  it('keeps request-path selection async-free and deduplicates background warm-up', async () => {
    setServerConfig(
      createProxyConfig({
        parity_enabled: false,
        parity_kill_switch: false,
      }),
    );

    let resolveRefresh!: (value: unknown) => void;
    const refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
    });

    const nowSec = Math.floor(Date.now() / 1000);

    const refreshSpy = vi
      .spyOn(GoogleAPIService, 'refreshAccessToken')
      .mockImplementation(() => refreshPromise as never);
    const projectSpy = vi
      .spyOn(GoogleAPIService, 'fetchProjectId')
      .mockResolvedValue('resolved-project' as never);
    vi.spyOn(CloudAccountRepo, 'getAccount').mockResolvedValue({
      id: 'acc-cold',
      provider: 'google',
      email: 'acc-cold@test.dev',
      token: {
        access_token: 'token-cold',
        refresh_token: 'refresh-cold',
        token_type: 'Bearer',
        expires_in: 3600,
        expiry_timestamp: nowSec + 30,
      },
      created_at: 1,
      last_used: 1,
    } as never);
    vi.spyOn(CloudAccountRepo, 'updateToken').mockResolvedValue(undefined as never);
    (service as any).tokens = new Map([
      [
        'acc-cold',
        {
          account_id: 'acc-cold',
          email: 'acc-cold@test.dev',
          access_token: 'token-cold',
          refresh_token: 'refresh-cold',
          token_type: 'Bearer',
          expires_in: 3600,
          expiry_timestamp: nowSec + 30,
          session_id: 'session-cold',
        },
      ],
      [
        'acc-ready',
        {
          account_id: 'acc-ready',
          email: 'acc-ready@test.dev',
          access_token: 'token-ready',
          refresh_token: 'refresh-ready',
          token_type: 'Bearer',
          expires_in: 3600,
          expiry_timestamp: nowSec + 3600,
          project_id: 'project-ready',
          session_id: 'session-ready',
        },
      ],
    ]);

    const first = await service.getNextToken();
    const second = await service.getNextToken();

    expect(first?.id).toBe('acc-ready');
    expect(second?.id).toBe('acc-ready');
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(projectSpy).not.toHaveBeenCalled();

    resolveRefresh({
      access_token: 'token-cold-refreshed',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    await vi.waitFor(() => {
      expect(projectSpy).toHaveBeenCalledWith('token-cold-refreshed');
    });
  });
});
