import type { AppUpdateStatus } from '@/types/dashboard';
import type { TrayTexts } from './i18n';

function formatUpdateInfoLabel(updateStatus: AppUpdateStatus, texts: TrayTexts): string {
  const versionSuffix = updateStatus.latestVersion ? ` (${updateStatus.latestVersion})` : '';

  switch (updateStatus.status) {
    case 'checking':
      return `${texts.update_status}: ${texts.checking_updates}`;
    case 'update_available':
      return `${texts.update_status}: ${texts.downloading_update}${versionSuffix}`;
    case 'ready_to_install':
      return `${texts.update_status}: ${texts.update_ready}${versionSuffix}`;
    case 'unsupported':
      return `${texts.update_status}: Unsupported`;
    case 'error':
      return `${texts.update_status}: ${texts.update_error}`;
    default:
      return texts.update_status;
  }
}

function truncateUpdateMessage(message: string | null): string | null {
  if (!message) {
    return null;
  }

  const normalized = message.trim();
  if (!normalized) {
    return null;
  }

  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77)}...`;
}

export function buildUpdateMenuItems(
  updateStatus: AppUpdateStatus | null,
  texts: TrayTexts,
  onRestartAndInstall: () => void,
): Electron.MenuItemConstructorOptions[] {
  if (!updateStatus || updateStatus.status === 'idle' || updateStatus.status === 'up_to_date') {
    return [];
  }

  const items: Electron.MenuItemConstructorOptions[] = [
    { type: 'separator' },
    {
      label: formatUpdateInfoLabel(updateStatus, texts),
      enabled: false,
    },
  ];

  if (updateStatus.status === 'error' || updateStatus.status === 'unsupported') {
    const errorMessage = truncateUpdateMessage(updateStatus.message);
    if (errorMessage) {
      items.push({
        label: errorMessage,
        enabled: false,
      });
    }
  }

  if (updateStatus.status === 'ready_to_install') {
    items.push({
      label: texts.restart_and_install,
      click: onRestartAndInstall,
    });
  }

  return items;
}
