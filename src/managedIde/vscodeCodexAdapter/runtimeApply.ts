import fs from 'fs';
import { ConfigManager } from '../../ipc/config/manager';
import { isManagedIdeProcessRunning, startManagedIde } from '../../ipc/process/handler';
import { logger } from '../../utils/logger';
import { CodexAccountStore } from '../codexAccountStore';
import { readCodexAuthFile, removeCodexAuthFile, writeCodexAuthFile } from '../codexAuth';
import { CODEX_DEFERRED_RUNTIME_APPLY_POLL_MS } from './constants';
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
  getCompanionCodexRuntimes,
  getPrimaryCodexRuntime,
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
    currentPendingRuntimeApply?.recordId === pendingRuntimeApply?.recordId &&
    currentPendingRuntimeApply?.requestedAt === pendingRuntimeApply?.requestedAt
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

type RuntimeApplyTargetSnapshot = {
  runtime: CodexRuntimeEnvironment;
  previousAuthFile: CodexAuthFile | null;
  rollbackAuthFile: CodexAuthFile | null;
  previousStateRawValue: string | null;
  stateDbPath: string | null;
};

function getRuntimeApplyTargets(
  selection: CodexResolvedRuntimeSelection,
): CodexRuntimeEnvironment[] {
  const primaryRuntime = getPrimaryCodexRuntime(selection);
  if (!primaryRuntime || !primaryRuntime.authFilePath) {
    return [];
  }

  return [
    primaryRuntime,
    ...getCompanionCodexRuntimes(selection, primaryRuntime).filter((runtime) =>
      Boolean(runtime.authFilePath),
    ),
  ];
}

function captureRuntimeApplySnapshot(
  runtime: CodexRuntimeEnvironment,
  options?: { includeStateSnapshot?: boolean; rollbackAuthFile?: CodexAuthFile | null },
): RuntimeApplyTargetSnapshot | null {
  if (!runtime.authFilePath) {
    return null;
  }

  const stateDbPath =
    runtime.stateDbPath && fs.existsSync(runtime.stateDbPath) ? runtime.stateDbPath : null;

  return {
    runtime,
    previousAuthFile: readCodexAuthFile(runtime.authFilePath),
    rollbackAuthFile: options?.rollbackAuthFile ?? null,
    previousStateRawValue:
      options?.includeStateSnapshot === true && stateDbPath
        ? readCodexGlobalStateSnapshot(stateDbPath).rawValue
        : null,
    stateDbPath,
  };
}

function restoreRuntimeGlobalStateSnapshot(target: RuntimeApplyTargetSnapshot): void {
  if (!target.stateDbPath || !target.previousStateRawValue) {
    return;
  }

  const restoreResult = writeCodexGlobalStateSnapshot(
    target.stateDbPath,
    target.previousStateRawValue,
  );
  if (!restoreResult.ok && restoreResult.reason !== 'missing') {
    logger.warn(
      `Failed to restore VS Code Codex global state after runtime apply rollback for ${target.runtime.id}`,
    );
  }
}

function rollbackRuntimeApply(targets: RuntimeApplyTargetSnapshot[]): void {
  for (const target of [...targets].reverse()) {
    try {
      restoreRuntimeAuthFile(
        target.runtime,
        target.rollbackAuthFile ?? target.previousAuthFile,
      );
    } catch (error) {
      logger.warn(
        `Failed to restore the previous Codex auth file for ${target.runtime.id} during rollback`,
        error,
      );
    }

    try {
      restoreRuntimeGlobalStateSnapshot(target);
    } catch (error) {
      logger.warn(
        `Failed to restore the previous VS Code Codex state snapshot for ${target.runtime.id} during rollback`,
        error,
      );
    }
  }
}

function applyAuthToRuntimeTargets(input: {
  runtimes: CodexRuntimeEnvironment[];
  authFile: CodexAuthFile;
  clearState: boolean;
  rollbackAuthFile?: CodexAuthFile | null;
}): boolean {
  const appliedTargets: RuntimeApplyTargetSnapshot[] = [];
  try {
    for (const runtime of input.runtimes) {
      const targetSnapshot = captureRuntimeApplySnapshot(runtime, {
        includeStateSnapshot: input.clearState,
        rollbackAuthFile: input.rollbackAuthFile ?? null,
      });
      if (!targetSnapshot || !runtime.authFilePath) {
        continue;
      }

      writeCodexAuthFile(input.authFile, runtime.authFilePath);
      appliedTargets.push(targetSnapshot);

      if (!input.clearState) {
        continue;
      }

      if (isWindowsWslRemoteRuntime(runtime)) {
        resetWslRemoteVsCodeProcesses(runtime);
      }

      const clearStateResult = clearCodexGlobalStateSnapshot(targetSnapshot.stateDbPath);
      if (!clearStateResult.ok && clearStateResult.reason !== 'missing') {
        rollbackRuntimeApply(appliedTargets);
        return false;
      }
    }

    return appliedTargets.length > 0;
  } catch (error) {
    logger.warn('Failed to apply a deferred Codex runtime change', error);
    rollbackRuntimeApply(appliedTargets);
    return false;
  }
}

export async function finalizeDeferredRuntimeApply(input: {
  state: DeferredRuntimeApplyStateBag;
  status?: ManagedIdeCurrentStatus | null;
}): Promise<CodexAccountRecord | null> {
  const deferredRuntimeApply = getDeferredRuntimeApply(input.state);
  if (!deferredRuntimeApply) {
    return null;
  }

  const account = await CodexAccountStore.getAccount(deferredRuntimeApply.recordId);
  const authFile = await CodexAccountStore.readAuthFile(deferredRuntimeApply.recordId);
  if (!account || !authFile?.tokens?.account_id) {
    logger.warn(
      'Dropping deferred Codex runtime apply because the target account or auth file is no longer available',
    );
    await persistDeferredRuntimeApply(input.state, null);
    stopDeferredRuntimeApplyWatcher(input.state);
    return null;
  }

  const persistedAccount = await persistActivatedAccount({
    account,
    authFile,
    status: input.status ?? null,
  });
  await markAccountHydrationLive(account.id);
  await persistDeferredRuntimeApply(input.state, null);
  stopDeferredRuntimeApplyWatcher(input.state);
  return persistedAccount;
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

  input.state.deferredRuntimeApplyInFlight = true;
  try {
    const selection = input.resolveRuntimeSelection();
    const applyTargets = getRuntimeApplyTargets(selection);
    if (applyTargets.length === 0) {
      input.ensureDeferredRuntimeApplyWatcher();
      return false;
    }

    const account = await CodexAccountStore.getAccount(deferredRuntimeApply.recordId);
    const authFile = await CodexAccountStore.readAuthFile(deferredRuntimeApply.recordId);
    if (!account || !authFile?.tokens?.account_id) {
      logger.warn(
        'Dropping deferred Codex runtime apply because the target account or auth file is no longer available',
      );
      await persistDeferredRuntimeApply(input.state, null);
      stopDeferredRuntimeApplyWatcher(input.state);
      return false;
    }

    const isProcessRunning = input.options?.assumeIdeStopped
      ? false
      : await isManagedIdeProcessRunning('vscode-codex');
    const activeAccount =
      !isProcessRunning ? await CodexAccountStore.getActiveAccount().catch(() => null) : null;
    const rollbackAuthFile =
      !isProcessRunning &&
      activeAccount &&
      activeAccount.id !== deferredRuntimeApply.recordId
        ? await CodexAccountStore.readAuthFile(activeAccount.id).catch(() => null)
        : null;
    const didApply = applyAuthToRuntimeTargets({
      runtimes: applyTargets,
      authFile,
      clearState: !isProcessRunning,
      rollbackAuthFile,
    });
    if (!didApply) {
      input.ensureDeferredRuntimeApplyWatcher();
      return false;
    }

    if (isProcessRunning) {
      input.ensureDeferredRuntimeApplyWatcher();
      return false;
    }

    await finalizeDeferredRuntimeApply({
      state: input.state,
      status: null,
    });
    return true;
  } finally {
    input.state.deferredRuntimeApplyInFlight = false;
  }
}

export function getActiveRuntimeOrThrow(
  selection = createRuntimeSelection(),
): CodexRuntimeEnvironment {
  const runtime = getPrimaryCodexRuntime(selection);
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
  const runtime = getPrimaryCodexRuntime(selection);
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

export async function applyAccountToRuntime(input: {
  state: DeferredRuntimeApplyStateBag;
  id: string;
  selection: CodexResolvedRuntimeSelection;
  ensureDeferredRuntimeApplyWatcher: () => void;
  flushDeferredRuntimeApplyIfPossible: (options?: { assumeIdeStopped?: boolean }) => Promise<boolean>;
}): Promise<CodexLiveApplyResult> {
  const primaryRuntime = getPrimaryCodexRuntime(input.selection);
  const runtimeId =
    getRuntimeById(input.selection, input.selection.activeRuntimeId)?.installation.available
      ? (input.selection.activeRuntimeId as CodexRuntimeId)
      : primaryRuntime?.id ?? null;
  if (!primaryRuntime || !runtimeId) {
    throw new Error('CODEX_IDE_UNAVAILABLE');
  }

  const pendingRuntimeApply = {
    runtimeId,
    recordId: input.id,
    requestedAt: Date.now(),
  };
  const wasRunning = await isManagedIdeProcessRunning('vscode-codex');

  await persistDeferredRuntimeApply(input.state, pendingRuntimeApply);
  const didApplyImmediately = await input.flushDeferredRuntimeApplyIfPossible(
    wasRunning ? undefined : { assumeIdeStopped: true },
  );

  if (wasRunning) {
    input.ensureDeferredRuntimeApplyWatcher();
    return {
      runtimeId,
      didRestartIde: false,
      deferredUntilIdeRestart: true,
    };
  }

  if (!didApplyImmediately) {
    throw new Error('CODEX_ACCOUNT_ACTIVATION_DID_NOT_CONVERGE');
  }

  await startManagedIde('vscode-codex', false);
  return {
    runtimeId,
    didRestartIde: true,
    deferredUntilIdeRestart: false,
  };
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

    const selection = input.resolveRuntimeSelection();
    getActiveRuntimeOrThrow(selection);

    const applyResult = await applyAccountToRuntime({
      state: input.state,
      id: input.id,
      selection,
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

    const selection = input.resolveRuntimeSelection();
    const applyResult = await applyAccountToRuntime({
      state: input.state,
      id: input.id,
      selection,
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
  const sourceRuntime = getRuntimeById(selection, 'windows-local');
  const targetRuntime = getRuntimeById(selection, 'wsl-remote');
  if (
    !sourceRuntime?.installation.available ||
    !targetRuntime?.installation.available
  ) {
    throw new Error('CODEX_RUNTIME_SYNC_UNAVAILABLE');
  }

  const source = {
    runtime: sourceRuntime,
    authFile: sourceRuntime.authFilePath ? readCodexAuthFile(sourceRuntime.authFilePath) : null,
    hints: readCodexGlobalStateSnapshot(
      sourceRuntime.stateDbPath && fs.existsSync(sourceRuntime.stateDbPath)
        ? sourceRuntime.stateDbPath
        : null,
    ),
  };
  const target = {
    runtime: targetRuntime,
    authFile: targetRuntime.authFilePath ? readCodexAuthFile(targetRuntime.authFilePath) : null,
    hints: readCodexGlobalStateSnapshot(
      targetRuntime.stateDbPath && fs.existsSync(targetRuntime.stateDbPath)
        ? targetRuntime.stateDbPath
        : null,
    ),
  };

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
