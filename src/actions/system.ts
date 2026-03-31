import { ipc } from '@/ipc/manager';
import type { ExternalNavigationIntent } from '@/utils/externalNavigation';

export function openLogDirectory() {
  return ipc.client.system.openLogDirectory();
}

export function openExternalUrl(input: { url: string; intent: ExternalNavigationIntent }) {
  return ipc.client.system.openExternalUrl(input);
}
