import fs from 'fs';
import { CodexAccountStore } from './codexAccountStore';
import { logger } from '../utils/logger';
import {
  addAccount,
  ensureCurrentDefaultSessionStored,
  getPreferredCodexEmail,
  listAccounts,
  refreshAccount,
  refreshAllAccounts,
  syncCurrentSessionIntoPool,
  toCodexAccountStoreError,
  importCurrentSession as importCurrentSessionIntoPool,
} from './vscodeCodexAdapter/accountPool';
import {
  createCurrentStatusFromRuntimes,
  createUnavailableRuntimeStatus,
  buildRuntimeStatusFromAuthFile,
  getMergedInstallationStatus,
  getRuntimeMismatch,
  readCachedStatus,
  writeCachedStatus,
} from './vscodeCodexAdapter/status';
import { readCodexGlobalStateSnapshot } from './vscodeCodexAdapter/globalStateDb';
import { createRuntimeSelection } from './vscodeCodexAdapter/runtimeEnvironment';
import {
  activateAccount as activateStoredAccount,
  ensureDeferredRuntimeApplyWatcher,
  finalizeDeferredRuntimeApply,
  flushDeferredRuntimeApplyIfPossible,
  getActiveRuntimeOrThrow,
  getDeferredRuntimeApply,
  openIde as openManagedIde,
  resolveProcessRunningState,
  restoreImportedAccount as restoreStoredAccount,
  syncRuntimeState as syncSelectedRuntimeState,
} from './vscodeCodexAdapter/runtimeApply';
import { runWithCodexSwitchLock } from './codexSwitchLock';
import type {
  CodexAccountActivationResult,
  CodexAccountRecord,
  CodexAuthFile,
  CodexImportRestoreResult,
  CodexRuntimeSyncResult,
  ManagedIdeAdapter,
  ManagedIdeCurrentStatus,
  ManagedIdeInstallationStatus,
} from './types';
import type {
  CodexGlobalStateSnapshot,
  CodexRuntimeEnvironment,
  DeferredRuntimeApplyStateBag,
} from './vscodeCodexAdapter/types';
import { readCodexAuthFile } from './codexAuth';

export class VscodeCodexAdapter implements ManagedIdeAdapter {
  readonly targetId = 'vscode-codex' as const;
  private runtimeApplyState: DeferredRuntimeApplyStateBag = {
    deferredRuntimeApply: null,
    deferredRuntimeApplyTimer: null,
    deferredRuntimeApplyInFlight: false,
  };

  private getDeferredRuntimeApply() {
    return getDeferredRuntimeApply(this.runtimeApplyState);
  }

  private async flushDeferredRuntimeApplyIfPossible(options?: {
    assumeIdeStopped?: boolean;
  }): Promise<boolean> {
    return runWithCodexSwitchLock(() =>
      flushDeferredRuntimeApplyIfPossible({
        state: this.runtimeApplyState,
        options,
        ensureDeferredRuntimeApplyWatcher: () => this.ensureDeferredRuntimeApplyWatcher(),
        resolveRuntimeSelection: () => this.resolveRuntimeSelection(),
      }),
    );
  }

  private ensureDeferredRuntimeApplyWatcher(): void {
    ensureDeferredRuntimeApplyWatcher({
      state: this.runtimeApplyState,
      flushDeferredRuntimeApplyIfPossible: (options) =>
        this.flushDeferredRuntimeApplyIfPossible(options),
    });
  }

  private resolveRuntimeSelection() {
    return createRuntimeSelection();
  }

  private hasDeferredRuntimeRecycleCompleted(input: {
    deferredRuntimeApply: NonNullable<DeferredRuntimeApplyStateBag['deferredRuntimeApply']>;
    runtimeResults: Array<{
      runtime: CodexRuntimeEnvironment;
      status: ManagedIdeCurrentStatus['runtimes'][number];
    }>;
    isProcessRunning: boolean;
  }): boolean {
    if (!input.isProcessRunning) {
      return true;
    }

    return input.runtimeResults.some(
      (result) =>
        result.runtime.installation.available &&
        typeof result.status.extensionStateUpdatedAt === 'number' &&
        result.status.extensionStateUpdatedAt > input.deferredRuntimeApply.requestedAt,
    );
  }

  private async buildRuntimeStatusFromAuthFile(
    runtime: CodexRuntimeEnvironment,
    authFile: CodexAuthFile | null,
    hints?: CodexGlobalStateSnapshot,
  ) {
    return buildRuntimeStatusFromAuthFile({
      runtime,
      authFile,
      hints,
      getPreferredCodexEmail,
    });
  }

  async getInstallationStatus(): Promise<ManagedIdeInstallationStatus> {
    const selection = this.resolveRuntimeSelection();
    return getMergedInstallationStatus(
      selection.runtimes.map((runtime) =>
        createUnavailableRuntimeStatus(runtime, runtime.installation.reason),
      ),
      selection.activeRuntimeId,
    );
  }

  async getCurrentStatus(options?: { refresh?: boolean }): Promise<ManagedIdeCurrentStatus> {
    const selection = this.resolveRuntimeSelection();
    const cached = readCachedStatus();
    let deferredRuntimeApply = this.getDeferredRuntimeApply();
    let isProcessRunning = await resolveProcessRunningState(options, cached?.isProcessRunning);
    if (deferredRuntimeApply && options?.refresh !== true) {
      isProcessRunning = await resolveProcessRunningState({ refresh: true });
    }
    if (deferredRuntimeApply) {
      await this.flushDeferredRuntimeApplyIfPossible(
        isProcessRunning ? undefined : { assumeIdeStopped: true },
      );
      deferredRuntimeApply = this.getDeferredRuntimeApply();
      if (deferredRuntimeApply) {
        this.ensureDeferredRuntimeApplyWatcher();
      }
    } else if (!isProcessRunning) {
      await this.flushDeferredRuntimeApplyIfPossible({ assumeIdeStopped: true });
    }

    const shouldProbeLive =
      options?.refresh === true ||
      !cached ||
      cached.session.state !== 'ready' ||
      (cached.session.state === 'ready' && cached.liveAccountIdentityKey === null) ||
      cached.activeRuntimeId !== selection.activeRuntimeId ||
      cached.requiresRuntimeSelection !== selection.requiresRuntimeSelection ||
      cached.runtimes.length !== selection.runtimes.length;

    if (!shouldProbeLive && cached) {
      return {
        ...cached,
        isProcessRunning,
        pendingRuntimeApply: deferredRuntimeApply,
        fromCache: true,
      };
    }

    const runtimeResults = await Promise.all(
      selection.runtimes.map(async (runtime) => {
        const authFile = runtime.authFilePath ? readCodexAuthFile(runtime.authFilePath) : null;
        const hints = readCodexGlobalStateSnapshot(
          runtime.stateDbPath && fs.existsSync(runtime.stateDbPath) ? runtime.stateDbPath : null,
        );
        const status = await this.buildRuntimeStatusFromAuthFile(runtime, authFile, hints);
        return { runtime, authFile, hints, status };
      }),
    );

    let status = createCurrentStatusFromRuntimes({
      runtimes: runtimeResults.map((result) => result.status),
      activeRuntimeId: selection.activeRuntimeId,
      requiresRuntimeSelection: selection.requiresRuntimeSelection,
      hasRuntimeMismatch: getRuntimeMismatch(runtimeResults),
      pendingRuntimeApply: deferredRuntimeApply,
      isProcessRunning,
      fromCache: false,
    });

    if (
      deferredRuntimeApply &&
      this.hasDeferredRuntimeRecycleCompleted({
        deferredRuntimeApply,
        runtimeResults,
        isProcessRunning,
      })
    ) {
      await finalizeDeferredRuntimeApply({
        state: this.runtimeApplyState,
        status,
      });
      deferredRuntimeApply = this.getDeferredRuntimeApply();
      status = {
        ...status,
        pendingRuntimeApply: deferredRuntimeApply,
      };
    }

    if (deferredRuntimeApply) {
      if (cached) {
        return {
          ...cached,
          installation: status.installation,
          isProcessRunning,
          activeRuntimeId: status.activeRuntimeId,
          requiresRuntimeSelection: status.requiresRuntimeSelection,
          hasRuntimeMismatch: status.hasRuntimeMismatch,
          pendingRuntimeApply: deferredRuntimeApply,
          runtimes: status.runtimes,
          fromCache: true,
        };
      }

      return {
        ...status,
        liveAccountIdentityKey: null,
        pendingRuntimeApply: deferredRuntimeApply,
      };
    }

    if (status.session.state === 'ready') {
      writeCachedStatus(status);
      const activeRuntimeResult = runtimeResults.find(
        (result) => result.runtime.id === status.activeRuntimeId,
      );
      if (activeRuntimeResult?.authFile?.tokens?.account_id) {
        await syncCurrentSessionIntoPool(status, activeRuntimeResult.authFile);
      }
      return status;
    }

    const liveAuthRuntimeResult = runtimeResults.find(
      (result) =>
        result.runtime.id === status.activeRuntimeId && result.authFile?.tokens?.account_id,
    );
    if (liveAuthRuntimeResult?.authFile?.tokens?.account_id) {
      try {
        await ensureCurrentDefaultSessionStored(liveAuthRuntimeResult.authFile, {
          makeActive: true,
        });
      } catch (error) {
        logger.warn(
          'Failed to align the active Codex pool account with the current auth file while live status was unavailable',
          error,
        );
      }
    }

    if (cached) {
      const activeRuntimeResult = runtimeResults.find(
        (result) => result.runtime.id === cached.activeRuntimeId,
      );
      if (cached.session.state === 'ready' && activeRuntimeResult?.authFile?.tokens?.account_id) {
        await ensureCurrentDefaultSessionStored(activeRuntimeResult.authFile, {
          preferredStatus: cached,
          makeActive: true,
        });
      }

      return {
        ...cached,
        installation: status.installation,
        isProcessRunning,
        activeRuntimeId: status.activeRuntimeId,
        requiresRuntimeSelection: status.requiresRuntimeSelection,
        hasRuntimeMismatch: status.hasRuntimeMismatch,
        pendingRuntimeApply: deferredRuntimeApply,
        runtimes: status.runtimes,
        fromCache: true,
      };
    }

    return status;
  }

  async listAccounts(): Promise<CodexAccountRecord[]> {
    return listAccounts();
  }

  async importCurrentSession(): Promise<CodexAccountRecord> {
    const runtime = getActiveRuntimeOrThrow(this.resolveRuntimeSelection());
    const authFile = runtime.authFilePath ? readCodexAuthFile(runtime.authFilePath) : null;
    if (!authFile?.tokens?.account_id) {
      throw new Error('CODEX_CURRENT_SESSION_NOT_AVAILABLE');
    }

    const status = await this.getCurrentStatus({ refresh: true });
    return importCurrentSessionIntoPool({
      runtime,
      authFile,
      status,
    });
  }

  async addAccount(): Promise<CodexAccountRecord[]> {
    const runtime = getActiveRuntimeOrThrow(this.resolveRuntimeSelection());
    const currentAuthFile = runtime.authFilePath ? readCodexAuthFile(runtime.authFilePath) : null;
    try {
      const currentStatus = await this.getCurrentStatus({ refresh: true });
      if (currentStatus.session.state !== 'ready') {
        await ensureCurrentDefaultSessionStored(currentAuthFile, {
          preferredStatus: currentStatus,
          makeActive: true,
        });
      }
    } catch (error) {
      logger.warn(
        'Failed to sync the current VS Code Codex session before adding a new account',
        error,
      );
      await ensureCurrentDefaultSessionStored(currentAuthFile, {
        preferredStatus: readCachedStatus(),
        makeActive: true,
      }).catch((fallbackError) => {
        logger.warn(
          'Failed to persist the current default Codex session from fallback data before adding a new account',
          fallbackError,
        );
      });
    }

    return addAccount({ runtime });
  }

  async refreshAccount(
    id: string,
    options?: { suppressExpectedSecurityLogs?: boolean },
  ): Promise<CodexAccountRecord> {
    const runtime = getActiveRuntimeOrThrow(this.resolveRuntimeSelection());
    return refreshAccount({ id, runtime, options });
  }

  async refreshAllAccounts(): Promise<CodexAccountRecord[]> {
    const runtime = getActiveRuntimeOrThrow(this.resolveRuntimeSelection());
    return refreshAllAccounts(runtime);
  }

  async activateAccount(id: string): Promise<CodexAccountActivationResult> {
    return runWithCodexSwitchLock(() =>
      activateStoredAccount({
        state: this.runtimeApplyState,
        id,
        resolveRuntimeSelection: () => this.resolveRuntimeSelection(),
        flushDeferredRuntimeApplyIfPossible: (options) =>
          this.flushDeferredRuntimeApplyIfPossible(options),
        ensureDeferredRuntimeApplyWatcher: () => this.ensureDeferredRuntimeApplyWatcher(),
        getCurrentStatus: (options) => this.getCurrentStatus(options),
      }),
    );
  }

  async tryAutoSwitchAccount(id: string, expectedActiveAccountId: string): Promise<boolean> {
    return runWithCodexSwitchLock(async () => {
      if (this.getDeferredRuntimeApply()) {
        logger.info(
          'Skipping Codex auto-switch because a deferred runtime apply is already pending.',
        );
        return false;
      }

      const activeAccount = await CodexAccountStore.getActiveAccount();
      if (activeAccount?.id !== expectedActiveAccountId) {
        logger.info(
          'Skipping Codex auto-switch because the active pooled account changed before activation.',
        );
        return false;
      }

      await activateStoredAccount({
        state: this.runtimeApplyState,
        id,
        resolveRuntimeSelection: () => this.resolveRuntimeSelection(),
        flushDeferredRuntimeApplyIfPossible: (options) =>
          this.flushDeferredRuntimeApplyIfPossible(options),
        ensureDeferredRuntimeApplyWatcher: () => this.ensureDeferredRuntimeApplyWatcher(),
        getCurrentStatus: (options) => this.getCurrentStatus(options),
      });
      return true;
    });
  }

  async restoreImportedAccount(id: string | null): Promise<CodexImportRestoreResult> {
    return runWithCodexSwitchLock(() =>
      restoreStoredAccount({
        state: this.runtimeApplyState,
        id,
        resolveRuntimeSelection: () => this.resolveRuntimeSelection(),
        flushDeferredRuntimeApplyIfPossible: (options) =>
          this.flushDeferredRuntimeApplyIfPossible(options),
        ensureDeferredRuntimeApplyWatcher: () => this.ensureDeferredRuntimeApplyWatcher(),
      }),
    );
  }

  async deleteAccount(id: string): Promise<void> {
    try {
      await CodexAccountStore.removeAccount(id);
    } catch (error) {
      throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_POOL_UNAVAILABLE');
    }
  }

  async syncRuntimeState(): Promise<CodexRuntimeSyncResult> {
    return syncSelectedRuntimeState(this.resolveRuntimeSelection());
  }

  async openIde(): Promise<void> {
    await openManagedIde({
      flushDeferredRuntimeApplyIfPossible: (options) =>
        this.flushDeferredRuntimeApplyIfPossible(options),
    });
  }

  async openLoginGuidance(): Promise<void> {
    await this.openIde();
  }
}
