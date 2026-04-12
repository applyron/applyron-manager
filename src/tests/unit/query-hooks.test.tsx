import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAddCodexAccount, mockActivateCodexAccount, mockRefreshAccountQuota } = vi.hoisted(
  () => ({
    mockAddCodexAccount: vi.fn(),
    mockActivateCodexAccount: vi.fn(),
    mockRefreshAccountQuota: vi.fn(),
  }),
);

vi.mock('@/actions/managedIde', () => ({
  activateCodexAccount: mockActivateCodexAccount,
  addCodexAccount: mockAddCodexAccount,
  deleteCodexAccount: vi.fn(),
  getManagedIdeCurrentStatus: vi.fn(),
  importCurrentCodexAccount: vi.fn(),
  importManagedIdeCurrentSession: vi.fn(),
  listCodexAccounts: vi.fn(),
  listManagedIdeTargets: vi.fn(),
  openManagedIde: vi.fn(),
  openManagedIdeLoginGuidance: vi.fn(),
  refreshAllCodexAccounts: vi.fn(),
  refreshCodexAccount: vi.fn(),
  refreshManagedIdeCurrentStatus: vi.fn(),
  syncCodexRuntimeState: vi.fn(),
}));

vi.mock('@/actions/cloud', () => ({
  addGoogleAccount: vi.fn(),
  deleteCloudAccount: vi.fn(),
  deleteCloudAccountsBatch: vi.fn(),
  forcePollCloudMonitor: vi.fn(),
  getAutoSwitchEnabled: vi.fn(),
  listCloudAccounts: vi.fn(),
  refreshAccountQuota: mockRefreshAccountQuota,
  setAutoSwitchEnabled: vi.fn(),
  startAuthFlow: vi.fn(),
  switchCloudAccount: vi.fn(),
  syncLocalAccount: vi.fn(),
}));

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('query hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddCodexAccount.mockResolvedValue([]);
    mockActivateCodexAccount.mockResolvedValue({
      id: 'codex-1',
      isActive: true,
    });
    mockRefreshAccountQuota.mockResolvedValue({
      id: 'cloud-1',
      provider: 'google',
      email: 'cloud@example.com',
      token: {
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
        expiry_timestamp: 7200,
        token_type: 'Bearer',
      },
      created_at: 1,
      last_used: 2,
    });
  });

  it('invalidates managed IDE queries without issuing explicit refetches', async () => {
    const { MANAGED_IDE_QUERY_KEYS, useAddCodexAccount, useActivateCodexAccount } =
      await import('../../hooks/useManagedIde');

    for (const runCase of [
      {
        render: useAddCodexAccount,
        args: undefined,
      },
      {
        render: useActivateCodexAccount,
        args: 'codex-1',
      },
    ]) {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      const invalidateSpy = vi
        .spyOn(queryClient, 'invalidateQueries')
        .mockResolvedValue(undefined as never);
      const refetchSpy = vi
        .spyOn(queryClient, 'refetchQueries')
        .mockResolvedValue(undefined as never);

      const { result, unmount } = renderHook(() => runCase.render(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync(runCase.args as never);
      });

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: MANAGED_IDE_QUERY_KEYS.codexAccounts,
          refetchType: 'active',
        }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: MANAGED_IDE_QUERY_KEYS.status('vscode-codex'),
          refetchType: 'active',
        }),
      );
      expect(refetchSpy).not.toHaveBeenCalled();

      unmount();
      queryClient.clear();
    }
  });

  it('updates the cloud account cache from quota refresh results without invalidating the list', async () => {
    const { QUERY_KEYS, useRefreshQuota } = await import('../../hooks/useCloudAccounts');
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
    const invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined as never);

    queryClient.setQueryData(QUERY_KEYS.cloudAccounts, [
      {
        id: 'cloud-1',
        provider: 'google',
        email: 'before@example.com',
        token: {
          access_token: 'old-token',
          refresh_token: 'refresh',
          expires_in: 3600,
          expiry_timestamp: 7200,
          token_type: 'Bearer',
        },
        created_at: 1,
        last_used: 1,
      },
    ]);

    const { result } = renderHook(() => useRefreshQuota(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync('cloud-1' as never);
    });

    const cachedAccounts = queryClient.getQueryData<Array<{ email: string }>>(
      QUERY_KEYS.cloudAccounts,
    );
    expect(setQueryDataSpy).toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: QUERY_KEYS.cloudAccounts }),
    );
    expect(cachedAccounts?.[0]?.email).toBe('cloud@example.com');
  });
});
