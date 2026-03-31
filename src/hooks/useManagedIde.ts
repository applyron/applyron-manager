import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  activateCodexAccount,
  addCodexAccount,
  deleteCodexAccount,
  getManagedIdeCurrentStatus,
  importCurrentCodexAccount,
  importManagedIdeCurrentSession,
  listCodexAccounts,
  listManagedIdeTargets,
  openManagedIde,
  openManagedIdeLoginGuidance,
  refreshAllCodexAccounts,
  refreshCodexAccount,
  refreshManagedIdeCurrentStatus,
} from '@/actions/managedIde';
import { sortCodexAccounts } from '@/managedIde/codexAccounts';
import type { CodexAccountRecord, ManagedIdeTargetId } from '@/managedIde/types';

export const MANAGED_IDE_QUERY_KEYS = {
  targets: ['managedIde', 'targets'] as const,
  status: (targetId: ManagedIdeTargetId) => ['managedIde', 'status', targetId] as const,
  codexAccounts: ['managedIde', 'codexAccounts'] as const,
};

export function useManagedIdeTargets() {
  return useQuery({
    queryKey: MANAGED_IDE_QUERY_KEYS.targets,
    queryFn: listManagedIdeTargets,
    staleTime: 60_000,
  });
}

export function useManagedIdeStatus(
  targetId: ManagedIdeTargetId,
  options?: {
    enabled?: boolean;
    refresh?: boolean;
    refetchInterval?: number | false;
  },
) {
  return useQuery({
    queryKey: MANAGED_IDE_QUERY_KEYS.status(targetId),
    queryFn: () =>
      getManagedIdeCurrentStatus({
        targetId,
        refresh: options?.refresh,
      }),
    enabled: options?.enabled ?? true,
    staleTime: 60_000,
    refetchInterval: options?.refetchInterval,
    refetchOnWindowFocus: false,
  });
}

export function useRefreshManagedIdeStatus(targetId: ManagedIdeTargetId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => refreshManagedIdeCurrentStatus(targetId),
    onSuccess: (status) => {
      queryClient.setQueryData(MANAGED_IDE_QUERY_KEYS.status(targetId), status);
      queryClient.invalidateQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.targets });
    },
  });
}

export function useImportManagedIdeSession(targetId: ManagedIdeTargetId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => importManagedIdeCurrentSession(targetId),
    onSuccess: (status) => {
      queryClient.setQueryData(MANAGED_IDE_QUERY_KEYS.status(targetId), status);
      queryClient.invalidateQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.targets });
    },
  });
}

export function useOpenManagedIde(targetId: ManagedIdeTargetId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => openManagedIde(targetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.status(targetId) });
    },
  });
}

export function useOpenManagedIdeLoginGuidance(targetId: ManagedIdeTargetId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => openManagedIdeLoginGuidance(targetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.status(targetId) });
    },
  });
}

export function useCodexAccounts() {
  return useQuery({
    queryKey: MANAGED_IDE_QUERY_KEYS.codexAccounts,
    queryFn: listCodexAccounts,
    select: sortCodexAccounts,
    staleTime: 15_000,
  });
}

function updateCodexAccountInCache(
  previous: CodexAccountRecord[] | undefined,
  next: CodexAccountRecord,
): CodexAccountRecord[] {
  const existing = previous ?? [];
  const withoutCurrent = existing.filter((account) => account.id !== next.id);
  const normalized = next.isActive
    ? withoutCurrent.map((account) => ({ ...account, isActive: false }))
    : withoutCurrent;

  return sortCodexAccounts([...normalized, next]);
}

export function useAddCodexAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addCodexAccount,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.codexAccounts }),
        queryClient.invalidateQueries({
          queryKey: MANAGED_IDE_QUERY_KEYS.status('vscode-codex'),
        }),
        queryClient.invalidateQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.targets }),
      ]);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.codexAccounts }),
        queryClient.refetchQueries({
          queryKey: MANAGED_IDE_QUERY_KEYS.status('vscode-codex'),
        }),
      ]);
    },
  });
}

export function useImportCurrentCodexAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: importCurrentCodexAccount,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.codexAccounts }),
        queryClient.invalidateQueries({
          queryKey: MANAGED_IDE_QUERY_KEYS.status('vscode-codex'),
        }),
        queryClient.invalidateQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.targets }),
      ]);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.codexAccounts }),
        queryClient.refetchQueries({
          queryKey: MANAGED_IDE_QUERY_KEYS.status('vscode-codex'),
        }),
      ]);
    },
  });
}

export function useRefreshCodexAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: refreshCodexAccount,
    onSuccess: (account) => {
      queryClient.setQueryData<CodexAccountRecord[]>(
        MANAGED_IDE_QUERY_KEYS.codexAccounts,
        (previous) => updateCodexAccountInCache(previous, account),
      );
    },
  });
}

export function useRefreshAllCodexAccounts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: refreshAllCodexAccounts,
    onSuccess: (accounts) => {
      queryClient.setQueryData(MANAGED_IDE_QUERY_KEYS.codexAccounts, sortCodexAccounts(accounts));
      queryClient.invalidateQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.status('vscode-codex') });
    },
  });
}

export function useActivateCodexAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: activateCodexAccount,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.codexAccounts }),
        queryClient.invalidateQueries({
          queryKey: MANAGED_IDE_QUERY_KEYS.status('vscode-codex'),
        }),
        queryClient.invalidateQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.targets }),
      ]);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.codexAccounts }),
        queryClient.refetchQueries({
          queryKey: MANAGED_IDE_QUERY_KEYS.status('vscode-codex'),
        }),
      ]);
    },
  });
}

export function useDeleteCodexAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCodexAccount,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.codexAccounts }),
        queryClient.invalidateQueries({
          queryKey: MANAGED_IDE_QUERY_KEYS.status('vscode-codex'),
        }),
      ]);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: MANAGED_IDE_QUERY_KEYS.codexAccounts }),
        queryClient.refetchQueries({
          queryKey: MANAGED_IDE_QUERY_KEYS.status('vscode-codex'),
        }),
      ]);
    },
  });
}
