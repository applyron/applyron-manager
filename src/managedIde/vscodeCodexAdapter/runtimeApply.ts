import fs from 'fs';
import { ConfigManager } from '../../ipc/config/manager';
import {
  closeManagedIde,
  isManagedIdeProcessRunning,
  startManagedIde,
} from '../../ipc/process/handler';
import { logger } from '../../utils/logger';
import { CodexAccountStore } from '../codexAccountStore';
import { readCodexAuthFile, removeCodexAuthFile, writeCodexAuthFile } from '../codexAuth';
import { CODEX_ACCOUNT_APPLY_VERIFY_POLL_MS, CODEX_ACCOUNT_APPLY_VERIFY_TIMEOUT_MS, CODEX_DEFERRED_RUNTIME_APPLY_POLL_MS } from './constants';
import { clearCodexGlobalStateSnapshot, readCodexGlobalStateSnapshot, writeCodexGlobalStateSnapshot } from './globalStateDb';
import {
  markAccountHydrationLive,
  toCodexAccountStoreError,
  toStoredSnapshot,
} from './accountPool';
import {
  getPreferredCodexEmail,
  getPreferredPersistedWorkspace,
  getResolvedCodexWorkspace,
} from './accountIdentity';
import {
  createRuntimeSelection,
  getRuntimeById,
  isWindowsWslRemoteRuntime,
  resetWslRemoteVsCodeProcesses,
} from './runtimeEnvironment';
import type { DeferredRuntimeApplyStateBag, CodexRuntimeEnvironment, CodexResolvedRuntimeSelection, CodexLiveApplyResult } from './types';
import type {
  CodexAccountActivationResult,
  CodexAccountRecord,
  CodexAuthFile,
  CodexImportRestoreResult,
  CodexRuntimeId,
  CodexRuntimeSyncResult,
  ManagedIdeCurrentStatus,
} from '../types';

export function getDeferredRuntimeApply(
  state: DeferredRuntimeApplyStateBag,
): DeferredRuntimeApplyStateBag['deferredRuntimeApply'] {
  if (state.deferredRuntimeApply) {
    return state.deferredRuntimeApply;
  }
  const deferredRuntimeApply = ConfigManager.getCachedConfigOrLoad().codex_pending_runtime_apply;
  if (!deferredRuntimeApply?.runtimeId || !deferredRuntimeApply.recordId) {
    return null;
  }
  state.deferredRuntimeApply = deferredRuntimeApply;
  return deferredRuntimeApply;
}

export async function persistDeferredRuntimeApply(
  state: DeferredRuntimeApplyStateBag,
  pendingRuntimeApply: DeferredRuntimeApplyStateBag['deferredRuntimeApply'],
): Promise<void> {
  state.deferredRuntimeApply = pendingRuntimeApply;
  const config = ConfigManager.getCachedConfigOrLoad();
  const currentPendingRuntimeApply = config.codex_pending_runtime_apply;
  if (
    currentPendingRuntimeApply?.runtimeId === pendingRuntimeApply?.runtimeId &&
    currentPendingRuntimeApply?.recordId === pendingRuntimeApply?.recordId
  ) {
    return;
  }
  try {
    await ConfigManager.saveConfig({
      ...config,
      codex_pending_runtime_apply: pendingRuntimeApply,
    });
  } catch (error) {
    logger.warn('Failed to persist deferred Codex runtime apply state', error);
  }
}

export function stopDeferredRuntimeApplyWatcher(state: DeferredRuntimeApplyStateBag): void {
  if (!state.deferredRuntimeApplyTimer) {
    return;
  }
  clearTimeout(state.deferredRuntimeApplyTimer);
  state.deferredRuntimeApplyTimer = null;
}

export function ensureDeferredRuntimeApplyWatcher(input: {
  state: DeferredRuntimeApplyStateBag;
  flushDeferredRuntimeApplyIfPossible: (options?: { assumeIdeStopped?: boolean }) => Promise<boolean>;
}): void {
  if (input.state.deferredRuntimeApplyTimer || !getDeferredRuntimeApply(input.state)) {
    return;
  }
  input.state.deferredRuntimeApplyTimer = setTimeout(() => {
    input.state.deferredRuntimeApplyTimer = null;
    void input.flushDeferredRuntimeApplyIfPossible();
  }, CODEX_DEFERRED_RUNTIME_APPLY_POLL_MS);
  input.state.deferredRuntimeApplyTimer.unref?.();
}

export function resolveProcessRunningState(
  options?: { refresh?: boolean },
  cachedProcessState?: boolean,
): Promise<boolean> | boolean {
  if (options?.refresh === true) {
    return isManagedIdeProcessRunning('vscode-codex');
  }
  return cachedProcessState ?? false;
}

export async function flushDeferredRuntimeApplyIfPossible(input: {
  state: DeferredRuntimeApplyStateBag;
  options?: { assumeIdeStopped?: boolean };
  ensureDeferredRuntimeApplyWatcher: () => void;
  resolveRuntimeSelection: () => CodexResolvedRuntimeSelection;
}): Promise<boolean> {
  const deferredRuntimeApply = getDeferredRuntimeApply(input.state);
  if (!deferredRuntimeApply) {
    stopDeferredRuntimeApplyWatcher(input.state);
    return false;
  }

  if (input.state.deferredRuntimeApplyInFlight) {
    return false;
  }

  if (!input.options?.assumeIdeStopped) {
    const isProcessRunning = await isManagedIdeProcessRunning('vscode-codex');
    if (isProcessRunning) {
      input.ensureDeferredRuntimeApplyWatcher();
      return false;
    }
  }

  input.state.deferredRuntimeApplyInFlight = true;
  try {
    const selection = input.resolveRuntimeSelection();
    const runtime = getRuntimeById(selection, deferredRuntimeApply.runtimeId);
    if (!runtime) {
      input.ensureDeferredRuntimeApplyWatcher();
      return false;
    }

    const account = await CodexAccountStore.getAccount(deferredRuntimeApply.recordId);
    const authFile = await CodexAccountStore.readAuthFile(deferredRuntimeApply.recordId);
    if (!account || !authFile?.tokens?.account_id || !runtime.authFilePath) {
      logger.warn(
        'Dropping deferred Codex runtime apply because the target account or auth file is no longer available',
      );
      await persistDeferredRuntimeApply(input.state, null);
      stopDeferredRuntimeApplyWatcher(input.state);
      return false;
    }

    const stateDbPath =
      runtime.stateDbPath && fs.existsSync(runtime.stateDbPath) ? runtime.stateDbPath : null;
    const previousAuthFile = readCodexAuthFile(runtime.authFilePath);
    if (isWindowsWslRemoteRuntime(runtime)) {
      resetWslRemoteVsCodeProcesses(runtime);
    }

    try {
      writeCodexAuthFile(authFile, runtime.authFilePath);

      const clearStateResult = clearCodexGlobalStateSnapshot(stateDbPath);
      if (!clearStateResult.ok && clearStateResult.reason !== 'missing') {
        input.ensureDeferredRuntimeApplyWatcher();
        return false;
      }

      await CodexAccountStore.upsertAccount({
        existingId: account.id,
        email: getPreferredCodexEmail(authFile, account.email),
        label: account.label,
        accountId: authFile.tokens.account_id,
        authMode: account.authMode ?? authFile.auth_mode,
        hydrationState: 'live',
        workspace: getPreferredPersistedWorkspace({
          derivedWorkspace: getResolvedCodexWorkspace(
            authFile,
            account.snapshot?.session.planType ?? null,
            account.email,
          ),
          existingWorkspace: account.workspace,
        }),
        authFile,
        snapshot: account.snapshot,
        makeActive: true,
      });

      await persistDeferredRuntimeApply(input.state, null);
      stopDeferredRuntimeApplyWatcher(input.state);
      return true;
    } catch (error) {
      logger.warn('Failed to flush deferred Codex runtime apply state', error);
      try {
        restoreRuntimeAuthFile(runtime, previousAuthFile);
      } catch (restoreError) {
        logger.warn(
          'Failed to restore the previous Codex auth file after deferred activation flush failure',
          restoreError,
        );
      }
      input.ensureDeferredRuntimeApplyWatcher();
      return false;
    }
  } finally {
    input.state.deferredRuntimeApplyInFlight = false;
  }
}

export function getActiveRuntimeOrThrow(
  selection = createRuntimeSelection(),
): CodexRuntimeEnvironment {
  if (selection.requiresRuntimeSelection || !selection.activeRuntimeId) {
    throw new Error('CODEX_RUNTIME_SELECTION_REQUIRED');
  }

  const runtime = getRuntimeById(selection, selection.activeRuntimeId);
  if (
    !runtime ||
    !runtime.installation.available ||
    !runtime.codexCliExecutionPath ||
    !runtime.authFilePath
  ) {
    throw new Error('CODEX_IDE_UNAVAILABLE');
  }

  return runtime;
}

export function getImportRestoreTarget(selection = createRuntimeSelection()): {
  runtime: CodexRuntimeEnvironment | null;
  status: CodexImportRestoreResult['status'] | null;
} {
  if (selection.requiresRuntimeSelection || !selection.activeRuntimeId) {
    return {
      runtime: null,
      status: 'stored_only_runtime_selection_required',
    };
  }

  const runtime = getRuntimeById(selection, selection.activeRuntimeId);
  if (!runtime || !runtime.installation.available || !runtime.authFilePath) {
    return {
      runtime: null,
      status: 'stored_only_runtime_unavailable',
    };
  }

  return {
    runtime,
    status: null,
  };
}

function restoreRuntimeAuthFile(
  runtime: CodexRuntimeEnvironment,
  previousAuthFile: CodexAuthFile | null,
): void {
  if (!runtime.authFilePath) {
    return;
  }

  if (previousAuthFile) {
    writeCodexAuthFile(previousAuthFile, runtime.authFilePath);
    return;
  }

  removeCodexAuthFile(runtime.authFilePath);
}

async function waitForRuntimeAccountConvergence(input: {
  runtime: CodexRuntimeEnvironment;
  authFile: CodexAuthFile;
  timeoutMs?: number;
}): Promise<boolean> {
  const expectedAccountId = input.authFile.tokens?.account_id ?? null;
  if (!expectedAccountId || !input.runtime.authFilePath) {
    return false;
  }

  const timeoutMs = input.timeoutMs ?? CODEX_ACCOUNT_APPLY_VERIFY_TIMEOUT_MS;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const runtimeAuthFile = readCodexAuthFile(input.runtime.authFilePath);
    if (runtimeAuthFile?.tokens?.account_id === expectedAccountId) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, CODEX_ACCOUNT_APPLY_VERIFY_POLL_MS));
  }

  return false;
}

async function restartIdeForAccountApply(
  runtime: CodexRuntimeEnvironment,
  options?: { includeProcessTree?: boolean },
): Promise<void> {
  const wasRunning = await isManagedIdeProcessRunning('vscode-codex');
  if (wasRunning) {
    await closeManagedIde('vscode-codex', {
      includeProcessTree: options?.includeProcessTree ?? false,
    });
  }

  if (isWindowsWslRemoteRuntime(runtime)) {
    resetWslRemoteVsCodeProcesses(runtime);
  }

  clearCodexGlobalStateSnapshot(
    runtime.stateDbPath && fs.existsSync(runtime.stateDbPath) ? runtime.stateDbPath : null,
  );
  await startManagedIde('vscode-codex', false);
}

export async function applyAccountToRuntime(input: {
  state: DeferredRuntimeApplyStateBag;
  id: string;
  authFile: CodexAuthFile;
  runtime: CodexRuntimeEnvironment;
  forceFullRestart: boolean;
  ensureDeferredRuntimeApplyWatcher: () => void;
  flushDeferredRuntimeApplyIfPossible: (options?: { assumeIdeStopped?: boolean }) => Promise<boolean>;
}): Promise<CodexLiveApplyResult> {
  const requiresWslRemoteReset = isWindowsWslRemoteRuntime(input.runtime);
  const stateDbPath =
    input.runtime.stateDbPath && fs.existsSync(input.runtime.stateDbPath)
      ? input.runtime.stateDbPath
      : null;
  let previousAuthFile: CodexAuthFile | null = null;

  try {
    const wasRunning = await isManagedIdeProcessRunning('vscode-codex');
    let didRestartIde = false;

    if (wasRunning) {
      await persistDeferredRuntimeApply(input.state, {
        runtimeId: input.runtime.id,
        recordId: input.id,
      });
      input.ensureDeferredRuntimeApplyWatcher();

      return {
        runtimeId: input.runtime.id,
        didRestartIde: false,
        deferredUntilIdeRestart: true,
      };
    }

    await persistDeferredRuntimeApply(input.state, null);
    previousAuthFile = input.runtime.authFilePath
      ? readCodexAuthFile(input.runtime.authFilePath)
      : null;
    writeCodexAuthFile(input.authFile, input.runtime.authFilePath as string);

    if (requiresWslRemoteReset) {
      resetWslRemoteVsCodeProcesses(input.runtime);
    }
    const clearStateResult = clearCodexGlobalStateSnapshot(stateDbPath);
    if (!clearStateResult.ok && clearStateResult.reason === 'error') {
      logger.warn('Failed to clear VS Code global state before applying a Codex account');
    }
    await startManagedIde('vscode-codex', false);
    didRestartIde = true;

    const didConverge = await waitForRuntimeAccountConvergence({
      runtime: input.runtime,
      authFile: input.authFile,
    });
    if (!didConverge) {
      logger.warn(
        'Codex account activation did not converge after the initial VS Code apply; retrying with a stronger restart',
      );
      await restartIdeForAccountApply(input.runtime, {
        includeProcessTree: input.forceFullRestart,
      });
      didRestartIde = true;

      const recovered = await waitForRuntimeAccountConvergence({
        runtime: input.runtime,
        authFile: input.authFile,
      });
      if (!recovered) {
        throw new Error('CODEX_ACCOUNT_ACTIVATION_DID_NOT_CONVERGE');
      }
    }

    return {
      runtimeId: input.runtime.id,
      didRestartIde,
      deferredUntilIdeRestart: false,
    };
  } catch (error) {
    try {
      restoreRuntimeAuthFile(input.runtime, previousAuthFile);
    } catch (restoreError) {
      logger.warn(
        'Failed to restore the previous Codex auth file after activation failure',
        restoreError,
      );
    }
    throw error;
  }
}

async function persistActivatedAccount(input: {
  account: CodexAccountRecord;
  authFile: CodexAuthFile;
  status?: ManagedIdeCurrentStatus | null;
}): Promise<CodexAccountRecord> {
  return CodexAccountStore.upsertAccount({
    existingId: input.account.id,
    email: getPreferredCodexEmail(
      input.authFile,
      input.status?.session.email ?? input.account.email,
    ),
    label: input.account.label,
    accountId: input.authFile.tokens?.account_id ?? input.account.accountId,
    authMode: input.status?.session.authMode ?? input.account.authMode ?? input.authFile.auth_mode,
    hydrationState: 'live',
    workspace: getPreferredPersistedWorkspace({
      derivedWorkspace: getResolvedCodexWorkspace(
        input.authFile,
        input.status?.session.planType ?? input.account.snapshot?.session.planType ?? null,
        input.status?.session.email ?? input.account.email,
      ),
      existingWorkspace: input.account.workspace,
    }),
    authFile: input.authFile,
    snapshot: input.status ? toStoredSnapshot(input.status) : input.account.snapshot,
    makeActive: true,
  });
}

export async function activateAccount(input: {
  state: DeferredRuntimeApplyStateBag;
  id: string;
  resolveRuntimeSelection: () => CodexResolvedRuntimeSelection;
  flushDeferredRuntimeApplyIfPossible: (options?: { assumeIdeStopped?: boolean }) => Promise<boolean>;
  ensureDeferredRuntimeApplyWatcher: () => void;
  getCurrentStatus: (options?: { refresh?: boolean }) => Promise<ManagedIdeCurrentStatus>;
}): Promise<CodexAccountActivationResult> {
  try {
    const account = await CodexAccountStore.getAccount(input.id);
    if (!account) {
      throw new Error('CODEX_ACCOUNT_NOT_FOUND');
    }

    const authFile = await CodexAccountStore.readAuthFile(input.id);
    if (!authFile?.tokens?.account_id) {
      throw new Error('CODEX_AUTH_FILE_NOT_FOUND');
    }

    const runtime = getActiveRuntimeOrThrow(input.resolveRuntimeSelection());
    const hydrationState = await CodexAccountStore.getHydrationState(input.id);
    const requiresImportRestore = hydrationState === 'needs_import_restore';

    const applyResult = await applyAccountToRuntime({
      state: input.state,
      id: input.id,
      authFile,
      runtime,
      forceFullRestart: requiresImportRestore,
      ensureDeferredRuntimeApplyWatcher: input.ensureDeferredRuntimeApplyWatcher,
      flushDeferredRuntimeApplyIfPossible: input.flushDeferredRuntimeApplyIfPossible,
    });
    let persistedAccount = account;

    if (!applyResult.deferredUntilIdeRestart) {
      let refreshedStatus: ManagedIdeCurrentStatus | null = null;
      try {
        refreshedStatus = await input.getCurrentStatus({ refresh: true });
      } catch (error) {
        logger.warn('Failed to refresh active Codex account after activation', error);
      }

      persistedAccount = await persistActivatedAccount({
        account,
        authFile,
        status: refreshedStatus,
      });
      await markAccountHydrationLive(input.id);
    }

    return {
      account: persistedAccount,
      appliedRuntimeId: applyResult.runtimeId,
      didRestartIde: applyResult.didRestartIde,
      deferredUntilIdeRestart: applyResult.deferredUntilIdeRestart,
    };
  } catch (error) {
    throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_POOL_UNAVAILABLE');
  }
}

export async function restoreImportedAccount(input: {
  state: DeferredRuntimeApplyStateBag;
  id: string | null;
  resolveRuntimeSelection: () => CodexResolvedRuntimeSelection;
  flushDeferredRuntimeApplyIfPossible: (options?: { assumeIdeStopped?: boolean }) => Promise<boolean>;
  ensureDeferredRuntimeApplyWatcher: () => void;
}): Promise<CodexImportRestoreResult> {
  if (!input.id) {
    return {
      restoredAccountId: null,
      appliedRuntimeId: null,
      didRestartIde: false,
      status: 'skipped_no_active_codex',
      warnings: [],
    };
  }

  try {
    if (!(await CodexAccountStore.getAccount(input.id))) {
      throw new Error('CODEX_ACCOUNT_NOT_FOUND');
    }

    const authFile = await CodexAccountStore.readAuthFile(input.id);
    if (!authFile?.tokens?.account_id) {
      throw new Error('CODEX_AUTH_FILE_NOT_FOUND');
    }

    const target = getImportRestoreTarget(input.resolveRuntimeSelection());
    if (!target.runtime || target.status) {
      await CodexAccountStore.setActive(input.id);
      return {
        restoredAccountId: input.id,
        appliedRuntimeId: null,
        didRestartIde: false,
        status: target.status ?? 'stored_only_runtime_unavailable',
        warnings: [],
      };
    }

    const applyResult = await applyAccountToRuntime({
      state: input.state,
      id: input.id,
      authFile,
      runtime: target.runtime,
      forceFullRestart: true,
      ensureDeferredRuntimeApplyWatcher: input.ensureDeferredRuntimeApplyWatcher,
      flushDeferredRuntimeApplyIfPossible: input.flushDeferredRuntimeApplyIfPossible,
    });
    if (!applyResult.deferredUntilIdeRestart) {
      await markAccountHydrationLive(input.id);
    }

    return {
      restoredAccountId: input.id,
      appliedRuntimeId: applyResult.runtimeId,
      didRestartIde: applyResult.didRestartIde,
      status: 'applied',
      warnings: [],
    };
  } catch (error) {
    throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_POOL_UNAVAILABLE');
  }
}

export async function syncRuntimeState(
  selection = createRuntimeSelection(),
): Promise<CodexRuntimeSyncResult> {
  if (selection.requiresRuntimeSelection || selection.runtimes.length < 2) {
    throw new Error('CODEX_RUNTIME_SELECTION_REQUIRED');
  }

  const runtimePairs = selection.runtimes
    .filter((runtime) => runtime.installation.available)
    .map((runtime) => ({
      runtime,
      authFile: runtime.authFilePath ? readCodexAuthFile(runtime.authFilePath) : null,
      hints: readCodexGlobalStateSnapshot(
        runtime.stateDbPath && fs.existsSync(runtime.stateDbPath) ? runtime.stateDbPath : null,
      ),
    }));

  if (runtimePairs.length < 2) {
    throw new Error('CODEX_RUNTIME_SYNC_UNAVAILABLE');
  }

  const getRefreshTimestamp = (authFile: CodexAuthFile | null): number | null => {
    const value = authFile?.last_refresh ? Date.parse(authFile.last_refresh) : Number.NaN;
    return Number.isFinite(value) ? value : null;
  };

  const [firstRuntime, secondRuntime] = runtimePairs;
  const firstAuthRefresh = getRefreshTimestamp(firstRuntime.authFile);
  const secondAuthRefresh = getRefreshTimestamp(secondRuntime.authFile);

  let source = firstRuntime;
  let target = secondRuntime;

  if (
    typeof firstAuthRefresh === 'number' &&
    typeof secondAuthRefresh === 'number' &&
    secondAuthRefresh > firstAuthRefresh
  ) {
    source = secondRuntime;
    target = firstRuntime;
  } else if (
    firstAuthRefresh === secondAuthRefresh ||
    firstAuthRefresh === null ||
    secondAuthRefresh === null
  ) {
    const firstStateUpdatedAt = firstRuntime.hints.updatedAt ?? 0;
    const secondStateUpdatedAt = secondRuntime.hints.updatedAt ?? 0;
    if (secondStateUpdatedAt > firstStateUpdatedAt) {
      source = secondRuntime;
      target = firstRuntime;
    } else if (
      secondStateUpdatedAt === firstStateUpdatedAt &&
      selection.activeRuntimeId === secondRuntime.runtime.id
    ) {
      source = secondRuntime;
      target = firstRuntime;
    }
  }

  const warnings: string[] = [];
  let syncedAuthFile = false;
  let syncedExtensionState = false;

  if (source.authFile && target.runtime.authFilePath) {
    try {
      writeCodexAuthFile(source.authFile, target.runtime.authFilePath);
      syncedAuthFile = true;
    } catch (error) {
      logger.warn('Failed to sync Codex auth file across runtimes', error);
      warnings.push('CODEX_RUNTIME_SYNC_AUTH_FAILED');
    }
  } else {
    warnings.push('CODEX_RUNTIME_SYNC_AUTH_SKIPPED');
  }

  if (source.hints.rawValue && target.runtime.stateDbPath) {
    const extensionStateResult = writeCodexGlobalStateSnapshot(
      target.runtime.stateDbPath,
      source.hints.rawValue,
    );
    syncedExtensionState = extensionStateResult.ok;
    if (!extensionStateResult.ok) {
      warnings.push(
        isWindowsWslRemoteRuntime(target.runtime) ||
          extensionStateResult.reason === 'missing' ||
          extensionStateResult.reason === 'locked'
          ? 'CODEX_RUNTIME_SYNC_STATE_SKIPPED'
          : 'CODEX_RUNTIME_SYNC_STATE_FAILED',
      );
    }
  } else {
    warnings.push('CODEX_RUNTIME_SYNC_STATE_SKIPPED');
  }

  return {
    sourceRuntimeId: source.runtime.id,
    targetRuntimeId: target.runtime.id,
    syncedAuthFile,
    syncedExtensionState,
    warnings,
  };
}

export async function openIde(input: {
  flushDeferredRuntimeApplyIfPossible: (options?: { assumeIdeStopped?: boolean }) => Promise<boolean>;
}): Promise<void> {
  await input.flushDeferredRuntimeApplyIfPossible({ assumeIdeStopped: true });
  await startManagedIde('vscode-codex', false);
}
