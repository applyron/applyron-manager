import { ipc } from '@/ipc/manager';
import type {
  CodexAccountRecord,
  CodexRuntimeSyncResult,
  ManagedIdeCurrentStatus,
  ManagedIdeRuntimeTarget,
  ManagedIdeTargetId,
} from '@/managedIde/types';

export function listManagedIdeTargets(): Promise<ManagedIdeRuntimeTarget[]> {
  return ipc.client.managedIde.listTargets();
}

export function getManagedIdeCurrentStatus(options?: {
  targetId?: ManagedIdeTargetId;
  refresh?: boolean;
}): Promise<ManagedIdeCurrentStatus> {
  return ipc.client.managedIde.getCurrentStatus(options ?? null);
}

export function refreshManagedIdeCurrentStatus(
  targetId?: ManagedIdeTargetId,
): Promise<ManagedIdeCurrentStatus> {
  return ipc.client.managedIde.refreshCurrentStatus(targetId ? { targetId } : null);
}

export function importManagedIdeCurrentSession(
  targetId?: ManagedIdeTargetId,
): Promise<ManagedIdeCurrentStatus> {
  return ipc.client.managedIde.importCurrentSession(targetId ? { targetId } : null);
}

export function openManagedIde(targetId?: ManagedIdeTargetId): Promise<void> {
  return ipc.client.managedIde.openIde(targetId ? { targetId } : null);
}

export function openManagedIdeLoginGuidance(targetId?: ManagedIdeTargetId): Promise<void> {
  return ipc.client.managedIde.openLoginGuidance(targetId ? { targetId } : null);
}

export function listCodexAccounts(): Promise<CodexAccountRecord[]> {
  return ipc.client.managedIde.listCodexAccounts();
}

export function addCodexAccount(): Promise<CodexAccountRecord[]> {
  return ipc.client.managedIde.addCodexAccount();
}

export function importCurrentCodexAccount(): Promise<CodexAccountRecord> {
  return ipc.client.managedIde.importCurrentCodexAccount();
}

export function refreshCodexAccount(id: string): Promise<CodexAccountRecord> {
  return ipc.client.managedIde.refreshCodexAccount({ id });
}

export function refreshAllCodexAccounts(): Promise<CodexAccountRecord[]> {
  return ipc.client.managedIde.refreshAllCodexAccounts();
}

export function activateCodexAccount(id: string): Promise<CodexAccountRecord> {
  return ipc.client.managedIde.activateCodexAccount({ id });
}

export function deleteCodexAccount(id: string): Promise<void> {
  return ipc.client.managedIde.deleteCodexAccount({ id });
}

export function syncCodexRuntimeState(): Promise<CodexRuntimeSyncResult> {
  return ipc.client.managedIde.syncCodexRuntimeState();
}
