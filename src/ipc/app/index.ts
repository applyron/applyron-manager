import {
  appVersion,
  checkForUpdatesManual,
  currentPlatfom,
  getDashboardAnnouncements,
  getServiceHealthSummary,
  getUpdateStatus,
  installDownloadedUpdate,
} from './handlers';
import { os } from '@orpc/server';

export const app = os.router({
  currentPlatfom,
  appVersion,
  getDashboardAnnouncements,
  getServiceHealthSummary,
  getUpdateStatus,
  checkForUpdatesManual,
  installDownloadedUpdate,
});
