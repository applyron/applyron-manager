import { os } from '@orpc/server';
import { APP_DISPLAY_VERSION } from '../../config/appMetadata';
import {
  AppUpdateStatusSchema,
  DashboardAnnouncementFeedSchema,
  DashboardAnnouncementSchema,
  ServiceHealthSummarySchema,
} from '@/types/dashboard';
import { AppUpdateService } from '@/services/AppUpdateService';
import { resolveAnnouncementsFeedUrl } from '@/config/managerBrand';
import { ServiceHealthRegistry } from '@/services/ServiceHealthRegistry';
import { logger } from '@/utils/logger';
import { ActivityLogService } from '@/services/ActivityLogService';

export const currentPlatfom = os.handler(() => {
  return process.platform;
});

export const appVersion = os.handler(() => {
  return APP_DISPLAY_VERSION;
});

export const getUpdateStatus = os.output(AppUpdateStatusSchema).handler(() => {
  return AppUpdateService.getStatus();
});

export async function fetchDashboardAnnouncements() {
  const feedUrl = resolveAnnouncementsFeedUrl();
  const response = await fetch(feedUrl);
  if (response.status === 404) {
    logger.info(
      `Announcements feed was not found at ${feedUrl}; returning an empty dashboard feed.`,
    );
    return [];
  }

  if (!response.ok) {
    throw new Error(`Announcements feed returned ${response.status}`);
  }

  const payload = DashboardAnnouncementFeedSchema.parse(await response.json());
  return payload.announcements;
}

export const getDashboardAnnouncements = os
  .output(DashboardAnnouncementSchema.array())
  .handler(fetchDashboardAnnouncements);

export const getServiceHealthSummary = os.output(ServiceHealthSummarySchema).handler(() => {
  return ServiceHealthRegistry.getSummary();
});

export const checkForUpdatesManual = os.output(AppUpdateStatusSchema).handler(async () => {
  const status = await AppUpdateService.checkForUpdatesManual();
  ActivityLogService.record({
    category: 'update',
    action: 'check',
    target: 'app',
    outcome: status.status === 'error' ? 'failure' : 'success',
    message: status.message ?? `Manual update check finished with status ${status.status}.`,
    metadata: {
      status: status.status,
      latestVersion: status.latestVersion,
    },
  });
  return status;
});

export const installDownloadedUpdate = os.output(AppUpdateStatusSchema).handler(() => {
  const status = AppUpdateService.installDownloadedUpdate();
  ActivityLogService.record({
    category: 'update',
    action: 'install',
    target: 'app',
    outcome: status.status === 'ready_to_install' ? 'success' : 'failure',
    message: status.message ?? `Update install requested with status ${status.status}.`,
    metadata: {
      status: status.status,
      latestVersion: status.latestVersion,
    },
  });
  return status;
});
