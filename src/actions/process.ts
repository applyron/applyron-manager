import { ipc } from '@/ipc/manager';
import type { ManagedIdeTargetId } from '@/managedIde/types';

export function isProcessRunning(targetId?: ManagedIdeTargetId) {
  return ipc.client.proc.isProcessRunning({ targetId });
}

export function closeManagedIde(targetId?: ManagedIdeTargetId) {
  return ipc.client.proc.closeManagedIde({ targetId });
}

export function closeAntigravity() {
  return closeManagedIde('antigravity');
}

export function startManagedIde(targetId?: ManagedIdeTargetId) {
  return ipc.client.proc.startManagedIde({ targetId });
}

export function startAntigravity() {
  return startManagedIde('antigravity');
}
