import { ipc } from '@/ipc/manager';
import type {
  AppUpdateStatus,
  DashboardAnnouncement,
  ServiceHealthSummary,
} from '@/types/dashboard';
import type { ProxyDiagnosticsSnapshot as GatewayDiagnosticsSnapshot } from '@/types/operations';

export function getPlatform() {
  return ipc.client.app.currentPlatfom();
}

export function getAppVersion() {
  return ipc.client.app.appVersion();
}

export function getUpdateStatus(): Promise<AppUpdateStatus> {
  return ipc.client.app.getUpdateStatus();
}

export function getDashboardAnnouncements(): Promise<DashboardAnnouncement[]> {
  return ipc.client.app.getDashboardAnnouncements();
}

export function getServiceHealthSummary(): Promise<ServiceHealthSummary> {
  return ipc.client.app.getServiceHealthSummary();
}

export function checkForUpdatesManual(): Promise<AppUpdateStatus> {
  return ipc.client.app.checkForUpdatesManual();
}

export function installDownloadedUpdate(): Promise<AppUpdateStatus> {
  return ipc.client.app.installDownloadedUpdate();
}

export function getProxyDiagnostics(): Promise<GatewayDiagnosticsSnapshot> {
  return ipc.client.gateway.getDiagnostics();
}
