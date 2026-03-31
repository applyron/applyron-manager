import { ConfigManager } from '../ipc/config/manager';
import { getManagedIdeTarget, getVisibleManagedIdeTargets } from './registry';
import type {
  CodexAccountRecord,
  ManagedIdeCurrentStatus,
  ManagedIdeInstallationStatus,
  ManagedIdeRuntimeTarget,
  ManagedIdeTargetId,
} from './types';
import { isManagedIdeProcessRunning } from '../ipc/process/handler';
import { getManagedIdeExecutablePath } from '../utils/paths';
import { VscodeCodexAdapter } from './vscodeCodexAdapter';

const vscodeCodexAdapter = new VscodeCodexAdapter();

function createAntigravityInstallationStatus(): ManagedIdeInstallationStatus {
  const idePath = getManagedIdeExecutablePath('antigravity') || null;
  return {
    targetId: 'antigravity',
    platformSupported: true,
    available: true,
    reason: idePath ? 'ready' : 'ide_not_found',
    idePath,
    ideVersion: null,
    extensionPath: null,
    extensionVersion: null,
    codexCliPath: null,
    extensionId: null,
  };
}

async function createAntigravityStatus(): Promise<ManagedIdeCurrentStatus> {
  const lastUpdatedAt = Date.now();
  return {
    targetId: 'antigravity',
    installation: createAntigravityInstallationStatus(),
    session: {
      state: 'unavailable',
      accountType: null,
      authMode: null,
      email: null,
      planType: null,
      requiresOpenaiAuth: false,
      serviceTier: null,
      agentMode: null,
      lastUpdatedAt,
    },
    quota: null,
    quotaByLimitId: null,
    isProcessRunning: await isManagedIdeProcessRunning('antigravity'),
    lastUpdatedAt,
    fromCache: false,
  };
}

export class ManagedIdeService {
  static getCurrentTargetId(): ManagedIdeTargetId {
    return ConfigManager.loadConfig().managed_ide_target;
  }

  static async listTargets(): Promise<ManagedIdeRuntimeTarget[]> {
    const targets = getVisibleManagedIdeTargets().filter((target) => {
      if (target.id === 'vscode-codex' && process.platform !== 'win32') {
        return false;
      }
      return true;
    });

    return Promise.all(
      targets.map(async (target) => ({
        id: target.id,
        displayName: target.displayName,
        shortName: target.shortName,
        processDisplayName: target.processDisplayName,
        capabilities: target.capabilities,
        installation:
          target.id === 'vscode-codex'
            ? await vscodeCodexAdapter.getInstallationStatus()
            : createAntigravityInstallationStatus(),
      })),
    );
  }

  static async getCurrentStatus(options?: {
    refresh?: boolean;
    targetId?: ManagedIdeTargetId;
  }): Promise<ManagedIdeCurrentStatus> {
    const targetId = options?.targetId ?? this.getCurrentTargetId();
    if (targetId === 'vscode-codex') {
      return vscodeCodexAdapter.getCurrentStatus({ refresh: options?.refresh });
    }

    return createAntigravityStatus();
  }

  static async refreshCurrentStatus(
    targetId?: ManagedIdeTargetId,
  ): Promise<ManagedIdeCurrentStatus> {
    return this.getCurrentStatus({ refresh: true, targetId });
  }

  static async importCurrentSession(
    targetId?: ManagedIdeTargetId,
  ): Promise<ManagedIdeCurrentStatus> {
    const resolvedTargetId = targetId ?? this.getCurrentTargetId();
    if (resolvedTargetId === 'vscode-codex') {
      await vscodeCodexAdapter.importCurrentSession();
      return this.getCurrentStatus({ refresh: true, targetId: resolvedTargetId });
    }

    return this.getCurrentStatus({ refresh: true, targetId: resolvedTargetId });
  }

  static async listCodexAccounts(): Promise<CodexAccountRecord[]> {
    return vscodeCodexAdapter.listAccounts();
  }

  static async addCodexAccount(): Promise<CodexAccountRecord> {
    return vscodeCodexAdapter.addAccount();
  }

  static async importCurrentCodexAccount(): Promise<CodexAccountRecord> {
    return vscodeCodexAdapter.importCurrentSession();
  }

  static async refreshCodexAccount(accountId: string): Promise<CodexAccountRecord> {
    return vscodeCodexAdapter.refreshAccount(accountId);
  }

  static async refreshAllCodexAccounts(): Promise<CodexAccountRecord[]> {
    return vscodeCodexAdapter.refreshAllAccounts();
  }

  static async activateCodexAccount(accountId: string): Promise<CodexAccountRecord> {
    const account = await vscodeCodexAdapter.activateAccount(accountId);
    const config = ConfigManager.loadConfig();
    if (config.managed_ide_target !== 'vscode-codex') {
      await ConfigManager.saveConfig({
        ...config,
        managed_ide_target: 'vscode-codex',
      });
    }
    return account;
  }

  static async deleteCodexAccount(accountId: string): Promise<void> {
    await vscodeCodexAdapter.deleteAccount(accountId);
  }

  static async openIde(targetId?: ManagedIdeTargetId): Promise<void> {
    const resolvedTargetId = targetId ?? this.getCurrentTargetId();
    if (resolvedTargetId === 'vscode-codex') {
      await vscodeCodexAdapter.openIde();
      return;
    }

    throw new Error(
      `${getManagedIdeTarget(resolvedTargetId).displayName} IDE open is managed elsewhere.`,
    );
  }

  static async openLoginGuidance(targetId?: ManagedIdeTargetId): Promise<void> {
    const resolvedTargetId = targetId ?? this.getCurrentTargetId();
    if (resolvedTargetId === 'vscode-codex') {
      await vscodeCodexAdapter.openLoginGuidance();
      return;
    }

    throw new Error(
      `${getManagedIdeTarget(resolvedTargetId).displayName} login guidance is not available.`,
    );
  }
}
