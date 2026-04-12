import { isCloudStorageUnavailableError } from '../../ipc/database/cloudHandler';
import { logger } from '../../utils/logger';
import { openExternalWithPolicy } from '../../utils/externalNavigation';
import { CodexAccountStore } from '../codexAccountStore';
import {
  getCodexPlanTypeHint,
} from '../codexAuth';
import { getCodexIdentityKey, isCodexPersonalWorkspace, isCodexTeamPlan } from '../codexIdentity';
import { ensureFreshCodexLoginUrl } from '../codexLoginUrl';
import {
  buildRuntimeStatusFromAuthFile,
  createCodexClient,
  createCurrentStatusFromRuntimes,
  normalizeManagedIdeAuthMode,
  waitForAuthFile,
  withTemporaryCodexHome,
} from './status';
import {
  getCodexDuplicateIdentityDetail,
  getPreferredCodexEmail,
  getPreferredPersistedWorkspace,
  getResolvedCodexWorkspace,
  hasCodexWorkspaceChanged,
} from './accountIdentity';
import type { CodexRuntimeEnvironment } from './types';
import type {
  CodexAccountRecord,
  CodexAccountSnapshot,
  CodexAuthFile,
  ManagedIdeCurrentStatus,
} from '../types';

export {
  getCodexDuplicateIdentityDetail,
  getPreferredCodexEmail,
  getPreferredPersistedWorkspace,
  getResolvedCodexWorkspace,
  hasCodexWorkspaceChanged,
} from './accountIdentity';

export function shouldRecoverFromCodexStoreError(error: unknown): boolean {
  if (isCloudStorageUnavailableError(error)) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('codex_accounts') ||
    error.message.includes('better-sqlite3') ||
    error.message.includes('keytar')
  );
}

export function toCodexAccountStoreError(
  error: unknown,
  code:
    | 'CODEX_ACCOUNT_STORE_UNAVAILABLE'
    | 'CODEX_ACCOUNT_SAVE_FAILED'
    | 'CODEX_ACCOUNT_POOL_UNAVAILABLE',
): Error {
  if (
    error instanceof Error &&
    (error.message.startsWith('CODEX_') ||
      error.message.startsWith('ERR_') ||
      error.message === 'ACTIVE_CODEX_ACCOUNT_DELETE_BLOCKED')
  ) {
    return error;
  }

  return new Error(code);
}

export function shouldSkipBackgroundAccountRefresh(account: CodexAccountRecord): boolean {
  return account.snapshot?.session.state === 'requires_login';
}

export function shouldQuarantineAccountForRelogin(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.startsWith('ERR_DATA_MIGRATION_FAILED') ||
      error.message === 'CODEX_AUTH_FILE_NOT_FOUND')
  );
}

export function createReloginRequiredSnapshot(account: CodexAccountRecord): CodexAccountSnapshot {
  const lastUpdatedAt = Date.now();
  const previousSession = account.snapshot?.session;

  return {
    session: {
      state: 'requires_login',
      accountType: previousSession?.accountType ?? null,
      authMode: normalizeManagedIdeAuthMode(account.authMode) ?? previousSession?.authMode ?? null,
      email: account.email ?? previousSession?.email ?? null,
      planType: previousSession?.planType ?? null,
      requiresOpenaiAuth: true,
      serviceTier: previousSession?.serviceTier ?? null,
      agentMode: previousSession?.agentMode ?? null,
      lastUpdatedAt,
    },
    quota: null,
    quotaByLimitId: null,
    lastUpdatedAt,
  };
}

export function toStoredSnapshot(status: ManagedIdeCurrentStatus): CodexAccountSnapshot {
  return {
    session: status.session,
    quota: status.quota,
    quotaByLimitId: status.quotaByLimitId,
    lastUpdatedAt: status.lastUpdatedAt,
  };
}

export function createStoredSnapshotFromAuthFile(
  authFile: CodexAuthFile,
  status?: ManagedIdeCurrentStatus | null,
): CodexAccountSnapshot {
  if (status?.session.state === 'ready') {
    return toStoredSnapshot(status);
  }

  const lastUpdatedAt = Date.now();

  return {
    session: {
      state: 'ready',
      accountType: 'chatgpt',
      authMode: normalizeManagedIdeAuthMode(authFile.auth_mode) ?? 'chatgpt',
      email: getPreferredCodexEmail(authFile, status?.session.email),
      planType: status?.session.planType ?? getCodexPlanTypeHint(authFile) ?? null,
      requiresOpenaiAuth: true,
      serviceTier: status?.session.serviceTier ?? null,
      agentMode: status?.session.agentMode ?? null,
      lastUpdatedAt,
    },
    quota: status?.quota ?? null,
    quotaByLimitId: status?.quotaByLimitId ?? null,
    lastUpdatedAt,
  };
}

export async function syncCurrentSessionIntoPool(
  status: ManagedIdeCurrentStatus,
  authFile: CodexAuthFile,
): Promise<void> {
  if (status.session.state !== 'ready' || !authFile.tokens?.account_id) {
    return;
  }

  try {
    await CodexAccountStore.upsertAccount({
      email: getPreferredCodexEmail(authFile, status.session.email),
      accountId: authFile.tokens.account_id,
      authMode: status.session.authMode ?? authFile.auth_mode,
      hydrationState: 'live',
      workspace: getPreferredPersistedWorkspace({
        derivedWorkspace: getResolvedCodexWorkspace(
          authFile,
          status.session.planType,
          status.session.email,
        ),
      }),
      authFile,
      snapshot: toStoredSnapshot(status),
      makeActive: true,
    });
  } catch (error) {
    if (shouldRecoverFromCodexStoreError(error)) {
      logger.warn(
        'Codex account storage is unavailable during live session sync; continuing with live status only',
        error,
      );
      return;
    }

    throw error;
  }
}

export async function ensureCurrentDefaultSessionStored(
  authFile: CodexAuthFile | null,
  options?: {
    preferredStatus?: ManagedIdeCurrentStatus | null;
    makeActive?: boolean;
  },
): Promise<void> {
  if (!authFile?.tokens?.account_id) {
    return;
  }

  const preferredStatus = options?.preferredStatus ?? null;
  const planTypeHint = preferredStatus?.session.planType ?? getCodexPlanTypeHint(authFile);
  const snapshot = createStoredSnapshotFromAuthFile(authFile, preferredStatus);

  try {
    await CodexAccountStore.upsertAccount({
      email: getPreferredCodexEmail(authFile, preferredStatus?.session.email),
      accountId: authFile.tokens.account_id,
      authMode: preferredStatus?.session.authMode ?? authFile.auth_mode,
      hydrationState: 'live',
      workspace: getPreferredPersistedWorkspace({
        derivedWorkspace: getResolvedCodexWorkspace(
          authFile,
          planTypeHint,
          preferredStatus?.session.email,
        ),
      }),
      authFile,
      snapshot,
      makeActive: options?.makeActive ?? true,
    });
  } catch (error) {
    if (shouldRecoverFromCodexStoreError(error)) {
      logger.warn(
        'Codex account storage is unavailable while ensuring the current default session is present in the pool',
        error,
      );
      return;
    }

    throw error;
  }
}

export async function listAccounts(): Promise<CodexAccountRecord[]> {
  try {
    const accounts = await CodexAccountStore.listAccounts();
    return await Promise.all(
      accounts.map(async (account) => {
        const planType = account.snapshot?.session.planType ?? null;
        if (
          !isCodexTeamPlan(planType) ||
          (account.workspace &&
            !isCodexPersonalWorkspace(account.workspace) &&
            account.workspace.title)
        ) {
          return account;
        }

        try {
          const authFile = await CodexAccountStore.readAuthFile(account.id, {
            suppressExpectedSecurityLogs: true,
          });
          if (!authFile?.tokens?.account_id) {
            return account;
          }

          const workspace = getPreferredPersistedWorkspace({
            derivedWorkspace: getResolvedCodexWorkspace(authFile, planType, account.email),
            existingWorkspace: account.workspace,
          });
          if (!hasCodexWorkspaceChanged(account.workspace, workspace)) {
            return account;
          }

          try {
            return await CodexAccountStore.upsertAccount({
              existingId: account.id,
              email: getPreferredCodexEmail(authFile, account.email),
              label: account.label,
              accountId: authFile.tokens.account_id,
              authMode: account.authMode ?? authFile.auth_mode,
              workspace,
              authFile,
              snapshot: account.snapshot,
              makeActive: account.isActive,
            });
          } catch (error) {
            logger.warn('Failed to persist reconciled Codex workspace metadata', error);
            return {
              ...account,
              email: getPreferredCodexEmail(authFile, account.email),
              authMode: account.authMode ?? authFile.auth_mode,
              workspace,
            };
          }
        } catch (error) {
          logger.warn('Failed to reconcile stored Codex workspace metadata', error);
          return account;
        }
      }),
    );
  } catch (error) {
    if (shouldRecoverFromCodexStoreError(error)) {
      logger.warn(
        'Codex account storage is unavailable while listing accounts; returning an empty pool',
        error,
      );
      return [];
    }
    throw error;
  }
}

export async function importCurrentSession(input: {
  runtime: CodexRuntimeEnvironment;
  authFile: CodexAuthFile;
  status: ManagedIdeCurrentStatus;
}): Promise<CodexAccountRecord> {
  const accountId = input.authFile.tokens?.account_id;
  if (!accountId) {
    throw new Error('CODEX_CURRENT_SESSION_NOT_AVAILABLE');
  }

  try {
    return await CodexAccountStore.upsertAccount({
      email: getPreferredCodexEmail(input.authFile, input.status.session.email),
      accountId,
      authMode: input.status.session.authMode ?? input.authFile.auth_mode,
      hydrationState: 'live',
      workspace: getPreferredPersistedWorkspace({
        derivedWorkspace: getResolvedCodexWorkspace(
          input.authFile,
          input.status.session.planType,
          input.status.session.email,
        ),
      }),
      authFile: input.authFile,
      snapshot: toStoredSnapshot(input.status),
      makeActive: true,
    });
  } catch (error) {
    if (shouldRecoverFromCodexStoreError(error)) {
      throw new Error('CODEX_ACCOUNT_STORE_UNAVAILABLE');
    }

    throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_SAVE_FAILED');
  }
}

export async function addAccount(input: {
  runtime: CodexRuntimeEnvironment;
}): Promise<CodexAccountRecord[]> {
  return withTemporaryCodexHome(input.runtime, 'applyron-codex-login-', async (codexHome) => {
    const client = createCodexClient(input.runtime, codexHome.runtimePath);

    try {
      await client.loginWithChatGpt({
        openUrl: async (url) => {
          await openExternalWithPolicy({
            intent: 'codex_login',
            url: ensureFreshCodexLoginUrl(url, {
              forceAccountSelection: true,
            }),
          });
        },
        timeoutMs: 180_000,
      });
    } finally {
      await client.dispose();
    }

    const authFile = await waitForAuthFile(codexHome.hostPath);
    if (!authFile?.tokens?.account_id) {
      throw new Error('CODEX_AUTH_FILE_NOT_FOUND');
    }

    const status = createCurrentStatusFromRuntimes({
      runtimes: [
        await buildRuntimeStatusFromAuthFile({
          runtime: input.runtime,
          authFile,
          getPreferredCodexEmail,
        }),
      ],
      activeRuntimeId: input.runtime.id,
      requiresRuntimeSelection: false,
      hasRuntimeMismatch: false,
      pendingRuntimeApply: null,
      isProcessRunning: false,
      fromCache: false,
    });
    const workspace = getPreferredPersistedWorkspace({
      derivedWorkspace: getResolvedCodexWorkspace(
        authFile,
        status.session.planType,
        status.session.email,
      ),
    });
    const existingAccount = await CodexAccountStore.getByIdentityKey(
      getCodexIdentityKey({
        accountId: authFile.tokens.account_id,
        workspace,
      }),
    );
    if (existingAccount) {
      throw new Error(
        `CODEX_ACCOUNT_ALREADY_EXISTS|${getCodexDuplicateIdentityDetail(
          authFile,
          status.session.email,
          status.session.planType,
          workspace,
        )}`,
      );
    }

    try {
      const account = await CodexAccountStore.upsertAccount({
        email: getPreferredCodexEmail(authFile, status.session.email),
        accountId: authFile.tokens.account_id,
        authMode: status.session.authMode ?? authFile.auth_mode,
        workspace,
        authFile,
        snapshot: toStoredSnapshot(status),
        makeActive: false,
      });
      return [account];
    } catch (error) {
      if (shouldRecoverFromCodexStoreError(error)) {
        throw new Error('CODEX_ACCOUNT_STORE_UNAVAILABLE');
      }

      throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_SAVE_FAILED');
    }
  });
}

export async function refreshAccount(input: {
  id: string;
  runtime: CodexRuntimeEnvironment;
  options?: { suppressExpectedSecurityLogs?: boolean };
}): Promise<CodexAccountRecord> {
  try {
    const account = await CodexAccountStore.getAccount(input.id);
    if (!account) {
      throw new Error('CODEX_ACCOUNT_NOT_FOUND');
    }

    const authFile = await CodexAccountStore.readAuthFile(input.id, {
      suppressExpectedSecurityLogs: input.options?.suppressExpectedSecurityLogs,
    });
    if (!authFile?.tokens?.account_id) {
      throw new Error('CODEX_AUTH_FILE_NOT_FOUND');
    }

    const status = createCurrentStatusFromRuntimes({
      runtimes: [
        await buildRuntimeStatusFromAuthFile({
          runtime: input.runtime,
          authFile,
          getPreferredCodexEmail,
        }),
      ],
      activeRuntimeId: input.runtime.id,
      requiresRuntimeSelection: false,
      hasRuntimeMismatch: false,
      pendingRuntimeApply: null,
      isProcessRunning: false,
      fromCache: false,
    });
    await CodexAccountStore.upsertAccount({
      existingId: account.id,
      email: getPreferredCodexEmail(authFile, status.session.email),
      label: account.label,
      accountId: authFile.tokens.account_id,
      authMode: status.session.authMode ?? authFile.auth_mode,
      workspace: getPreferredPersistedWorkspace({
        derivedWorkspace: getResolvedCodexWorkspace(
          authFile,
          status.session.planType,
          status.session.email,
        ),
        existingWorkspace: account.workspace,
      }),
      authFile,
      snapshot: toStoredSnapshot(status),
      makeActive: account.isActive,
    });

    const refreshed = await CodexAccountStore.getAccount(account.id);
    if (!refreshed) {
      throw new Error('CODEX_ACCOUNT_NOT_FOUND');
    }

    return refreshed;
  } catch (error) {
    throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_POOL_UNAVAILABLE');
  }
}

export async function refreshAllAccounts(runtime: CodexRuntimeEnvironment): Promise<CodexAccountRecord[]> {
  let accounts: CodexAccountRecord[];
  try {
    accounts = await CodexAccountStore.listAccounts();
  } catch (error) {
    throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_POOL_UNAVAILABLE');
  }

  for (const account of accounts) {
    if (shouldSkipBackgroundAccountRefresh(account)) {
      logger.debug(
        `Skipping background refresh for Codex account ${account.id} because it already requires re-login`,
      );
      continue;
    }

    try {
      await refreshAccount({
        id: account.id,
        runtime,
        options: {
          suppressExpectedSecurityLogs: true,
        },
      });
    } catch (error) {
      if (shouldQuarantineAccountForRelogin(error)) {
        try {
          await CodexAccountStore.updateSnapshot(
            account.id,
            createReloginRequiredSnapshot(account),
          );
          logger.warn(
            `Codex account ${account.id} requires re-login; background refresh is suspended until the account is refreshed manually or re-imported`,
            error,
          );
        } catch (snapshotError) {
          logger.warn(
            `Failed to mark Codex account ${account.id} as requiring re-login after refresh failure`,
            snapshotError,
          );
        }
        continue;
      }

      logger.warn(`Failed to refresh Codex account ${account.id}`, error);
    }
  }

  try {
    return await CodexAccountStore.listAccounts();
  } catch (error) {
    throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_POOL_UNAVAILABLE');
  }
}

export async function markAccountHydrationLive(id: string): Promise<void> {
  try {
    await CodexAccountStore.setHydrationState(id, 'live');
  } catch (error) {
    logger.warn(`Failed to mark Codex account ${id} as live after runtime apply`, error);
  }
}
