import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudMonitorService } from '../../services/CloudMonitorService';
import { CloudAccountRepo } from '../../ipc/database/cloudHandler';
import { GoogleAPIService } from '../../services/GoogleAPIService';
import { AutoSwitchService } from '../../services/AutoSwitchService';
import { TokenManagerService } from '../../server/modules/proxy/token-manager.service';
import { logger } from '../../utils/logger';

// Mock dependencies
vi.mock('../../ipc/database/cloudHandler');
vi.mock('../../services/GoogleAPIService');
vi.mock('../../services/AutoSwitchService');
vi.mock('../../utils/logger');

describe('CloudMonitorService', () => {
  let monitor: CloudMonitorService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(AutoSwitchService.checkAndSwitchIfNeeded).mockResolvedValue('idle' as never);
    monitor = new CloudMonitorService();
    monitor.resetStateForTesting();
  });

  afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
  });

  it('should start polling on start() and set up interval', async () => {
    const pollSpy = vi.spyOn(monitor, 'poll').mockResolvedValue(undefined);

    monitor.start();

    // Should call initial poll
    expect(pollSpy).toHaveBeenCalledTimes(1);

    // Fast forward 5 minutes
    await vi.advanceTimersByTimeAsync(1000 * 60 * 5);
    expect(pollSpy).toHaveBeenCalledTimes(2);

    pollSpy.mockRestore();
  });

  it('should poll accounts correctly', async () => {
    const mockAccounts = [
      {
        id: 'acc1',
        email: 'test@example.com',
        token: { access_token: 'valid_token', expiry_timestamp: Date.now() / 1000 + 3600 },
      },
    ];

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue(mockAccounts as never);
    vi.mocked(GoogleAPIService.fetchQuota).mockResolvedValue({ models: {} } as never);

    await monitor.poll({ trigger: 'scheduled' });

    expect(CloudAccountRepo.getAccounts).toHaveBeenCalled();
    expect(GoogleAPIService.fetchQuota).toHaveBeenCalledWith('valid_token');
    expect(CloudAccountRepo.updateQuota).toHaveBeenCalledWith('acc1', expect.anything());
    expect(AutoSwitchService.checkAndSwitchIfNeeded).toHaveBeenCalledWith({
      trigger: 'scheduled',
    });
  });

  it('should refresh token if expired during poll', async () => {
    const mockAccounts = [
      {
        id: 'acc1',
        email: 'expired@example.com',
        token: {
          access_token: 'old_token',
          refresh_token: 'ref_token',
          expiry_timestamp: Math.floor(Date.now() / 1000) - 100, // Expired
        },
      },
    ];

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue(mockAccounts as never);
    vi.mocked(GoogleAPIService.refreshAccessToken).mockResolvedValue({
      access_token: 'new_token',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    vi.mocked(GoogleAPIService.fetchQuota).mockResolvedValue({ models: {} } as never);

    await monitor.poll({ trigger: 'scheduled' });

    expect(GoogleAPIService.refreshAccessToken).toHaveBeenCalledWith('ref_token');
    expect(CloudAccountRepo.updateToken).toHaveBeenCalled();
    expect(GoogleAPIService.fetchQuota).toHaveBeenCalledWith('new_token');
  });

  it('skips quota persistence when the operational fingerprint is unchanged', async () => {
    const existingQuota = {
      models: {
        'gemini-2.5-flash': {
          percentage: 81,
          resetTime: '2026-03-30T18:00:00.000Z',
          display_name: 'Gemini 2.5 Flash',
        },
      },
      subscription_tier: 'pro',
      model_forwarding_rules: {
        'gemini-2.5-flash-preview': 'gemini-2.5-flash',
      },
    };
    const mockAccounts = [
      {
        id: 'acc1',
        email: 'test@example.com',
        quota: existingQuota,
        token: {
          access_token: 'valid_token',
          project_id: 'project-1',
          expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    ];

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue(mockAccounts as never);
    vi.mocked(GoogleAPIService.fetchQuota).mockResolvedValue({
      ...existingQuota,
      models: {
        'gemini-2.5-flash': {
          ...existingQuota.models['gemini-2.5-flash'],
          display_name: 'renamed but operationally identical',
        },
      },
    } as never);

    await monitor.poll({ trigger: 'scheduled' });

    expect(CloudAccountRepo.updateQuota).not.toHaveBeenCalled();
  });

  it('caps polling concurrency at four accounts', async () => {
    vi.useRealTimers();

    const mockAccounts = Array.from({ length: 6 }, (_, index) => ({
      id: `acc-${index + 1}`,
      email: `acc-${index + 1}@example.com`,
      token: {
        access_token: `token-${index + 1}`,
        project_id: `project-${index + 1}`,
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
      },
    }));

    let activeFetches = 0;
    let maxConcurrentFetches = 0;
    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue(mockAccounts as never);
    vi.mocked(GoogleAPIService.fetchQuota).mockImplementation(async () => {
      activeFetches++;
      maxConcurrentFetches = Math.max(maxConcurrentFetches, activeFetches);
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      activeFetches--;
      return { models: {} };
    });

    await monitor.poll({ trigger: 'scheduled' });

    expect(maxConcurrentFetches).toBe(4);
  });

  describe('handleAppFocus (Smart Refresh)', () => {
    it('should trigger poll when focused after debounce time', async () => {
      const pollSpy = vi.spyOn(monitor, 'poll').mockResolvedValue(undefined);

      monitor.start();
      vi.setSystemTime(Date.now() + 20000);

      await monitor.handleAppFocus();

      // Called once by start, once by focus
      expect(pollSpy).toHaveBeenCalledTimes(2);
    });

    it('should NOT trigger poll if debounced (focused too soon)', async () => {
      const pollSpy = vi.spyOn(monitor, 'poll').mockResolvedValue(undefined);

      monitor.start();

      vi.setSystemTime(Date.now() + 1000);

      await monitor.handleAppFocus();

      // Called once by start, 0 by focus
      expect(pollSpy).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('debounce active'));
    });

    it('should NOT trigger poll if already polling (concurrency guard)', async () => {
      vi.setSystemTime(Date.now() + 20000);

      let resolveGetAccounts: (value: unknown) => void;
      const getAccountsPromise = new Promise((resolve) => {
        resolveGetAccounts = resolve;
      });
      vi.mocked(CloudAccountRepo.getAccounts).mockImplementation(() => getAccountsPromise as never);

      const p1 = monitor.poll({ trigger: 'focus' });
      await Promise.resolve();

      await monitor.handleAppFocus();

      resolveGetAccounts!([]);

      await p1;

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('polling is already in progress'),
      );
      expect(CloudAccountRepo.getAccounts).toHaveBeenCalledTimes(1);
    });

    it('should reset interval after successful focus poll', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      // Spy on poll to consume the start() call
      const pollSpy = vi.spyOn(monitor, 'poll').mockResolvedValue(undefined);
      monitor.start();
      pollSpy.mockRestore(); // Restore real poll

      vi.setSystemTime(Date.now() + 20000);

      // Needs to handle async poll
      vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([]);

      await monitor.handleAppFocus();

      expect(clearIntervalSpy).toHaveBeenCalled();
      // 1 for start (initial), 1 for reset = 2
      expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    });
  });
});

describe('TokenManagerService project-id hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('hydrates missing project_id in the background and uses fallback immediately', async () => {
    const account = {
      id: 'acc-1',
      provider: 'google',
      email: 'user@example.com',
      token: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
      },
      created_at: 1,
      last_used: 1,
    };

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([account] as never);
    vi.mocked(CloudAccountRepo.getAccount).mockResolvedValue(account as never);
    vi.mocked(CloudAccountRepo.updateToken).mockResolvedValue(undefined as never);
    vi.mocked(GoogleAPIService.fetchProjectId).mockResolvedValue('resolved-project' as never);

    const service = new TokenManagerService();
    const selectedToken = await service.getNextToken();

    expect(selectedToken?.token.project_id).toBe('silver-orbit-5m7qc');
    await vi.waitFor(() => {
      expect(GoogleAPIService.fetchProjectId).toHaveBeenCalledWith('access-token');
    });
    expect(CloudAccountRepo.updateToken).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        project_id: 'resolved-project',
      }),
    );
  });

  it('keeps existing valid project_id without extra fetch', async () => {
    const account = {
      id: 'acc-2',
      provider: 'google',
      email: 'existing@example.com',
      token: {
        access_token: 'access-token-2',
        refresh_token: 'refresh-token-2',
        token_type: 'Bearer',
        expires_in: 3600,
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
        project_id: 'existing-project',
      },
      created_at: 1,
      last_used: 1,
    };

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([account] as never);
    vi.mocked(GoogleAPIService.fetchProjectId).mockResolvedValue('new-project' as never);

    const service = new TokenManagerService();
    const selectedToken = await service.getNextToken();

    expect(GoogleAPIService.fetchProjectId).not.toHaveBeenCalled();
    expect(selectedToken?.token.project_id).toBe('existing-project');
  });

  it('uses fallback project_id when project_id cannot be resolved', async () => {
    const account = {
      id: 'acc-3',
      provider: 'google',
      email: 'missing@example.com',
      token: {
        access_token: 'access-token-3',
        refresh_token: 'refresh-token-3',
        token_type: 'Bearer',
        expires_in: 3600,
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
        project_id: 'cloud-code-123',
      },
      created_at: 1,
      last_used: 1,
    };

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([account] as never);
    vi.mocked(GoogleAPIService.fetchProjectId).mockResolvedValue(null as never);

    const service = new TokenManagerService();
    const selectedToken = await service.getNextToken();

    await vi.waitFor(() => {
      expect(GoogleAPIService.fetchProjectId).toHaveBeenCalledWith('access-token-3');
    });
    expect(CloudAccountRepo.updateToken).not.toHaveBeenCalled();
    expect(selectedToken?.token.project_id).toBe('silver-orbit-5m7qc');
  });

  it('rehydrates malformed legacy resource-style project_id values in the background', async () => {
    const account = {
      id: 'acc-4',
      provider: 'google',
      email: 'legacy@example.com',
      token: {
        access_token: 'access-token-4',
        refresh_token: 'refresh-token-4',
        token_type: 'Bearer',
        expires_in: 3600,
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
        project_id: 'projects/',
      },
      created_at: 1,
      last_used: 1,
    };

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([account] as never);
    vi.mocked(CloudAccountRepo.getAccount).mockResolvedValue(account as never);
    vi.mocked(CloudAccountRepo.updateToken).mockResolvedValue(undefined as never);
    vi.mocked(GoogleAPIService.fetchProjectId).mockResolvedValue('resolved-project-4' as never);

    const service = new TokenManagerService();
    const selectedToken = await service.getNextToken();

    expect(selectedToken?.token.project_id).toBe('silver-orbit-5m7qc');
    await vi.waitFor(() => {
      expect(GoogleAPIService.fetchProjectId).toHaveBeenCalledWith('access-token-4');
    });
    expect(CloudAccountRepo.updateToken).toHaveBeenCalledWith(
      'acc-4',
      expect.objectContaining({
        project_id: 'resolved-project-4',
      }),
    );
  });
});
