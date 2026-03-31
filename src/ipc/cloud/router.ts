import { z } from 'zod';
import { os } from '@orpc/server';
import {
  addGoogleAccount,
  bindCloudIdentityProfile,
  bindCloudIdentityProfileWithPayload,
  deleteCloudIdentityProfileRevision,
  listCloudAccounts,
  deleteCloudAccount,
  deleteCloudAccountsBatch,
  getCloudIdentityProfiles,
  openCloudIdentityStorageFolder,
  previewGenerateCloudIdentityProfile,
  refreshAccountQuota,
  restoreCloudIdentityProfileRevision,
  restoreCloudBaselineProfile,
  switchCloudAccount,
  getAutoSwitchEnabled,
  setAutoSwitchEnabled,
  forcePollCloudMonitor,
  startAuthFlow,
} from './handler';
import { CloudAccountSchema } from '../../types/cloudAccount';
import { DeviceProfileSchema, DeviceProfilesSnapshotSchema } from '../../types/account';
import { CloudAccountRepo } from '../database/cloudHandler';
import { logger } from '../../utils/logger';
import { getSwitchMetricsSnapshot } from '../switchMetrics';
import { getSwitchGuardSnapshot } from '../switchGuard';
import { getDeviceHardeningSnapshot } from '../device/handler';
import { getErrorMessage } from '../../utils/errorHandling';
import { ActivityLogService } from '../../services/ActivityLogService';

const switchOwnerSchema = z.enum(['local-account-switch', 'cloud-account-switch']);
const switchMetricBucketSchema = z.object({
  switchSuccess: z.number(),
  switchFailure: z.number(),
  rollbackAttempt: z.number(),
  rollbackSuccess: z.number(),
  rollbackFailure: z.number(),
  failureReasons: z.record(z.string(), z.number()),
  lastFailure: z
    .object({
      reason: z.string(),
      message: z.string(),
      occurredAt: z.number(),
    })
    .nullable(),
});
const switchMetricsSnapshotSchema = z.object({
  local: switchMetricBucketSchema,
  cloud: switchMetricBucketSchema,
});
const switchGuardSnapshotSchema = z.object({
  activeOwner: switchOwnerSchema.nullable(),
  pendingOwners: z.array(switchOwnerSchema),
  pendingCount: z.number(),
});
const switchStatusSnapshotSchema = z.object({
  metrics: switchMetricsSnapshotSchema,
  guard: switchGuardSnapshotSchema,
  hardening: z.object({
    consecutiveApplyFailures: z.number(),
    safeModeActive: z.boolean(),
    safeModeUntil: z.number().nullable(),
    lastFailureReason: z.string().nullable(),
    lastFailureStage: z.string().nullable(),
    lastFailureAt: z.number().nullable(),
  }),
});
const deleteCloudAccountsBatchResultSchema = z.object({
  deletedIds: z.array(z.string()),
  failed: z.array(
    z.object({
      accountId: z.string(),
      message: z.string(),
    }),
  ),
});

export const cloudRouter = os.router({
  addGoogleAccount: os
    .input(z.object({ authCode: z.string() }))
    .output(CloudAccountSchema)
    .handler(async ({ input }) => {
      try {
        const account = await addGoogleAccount(input.authCode);
        ActivityLogService.record({
          category: 'cloud',
          action: 'add',
          target: account.email,
          outcome: 'success',
          message: 'Cloud account added.',
          metadata: { accountId: account.id, provider: account.provider },
        });
        return account;
      } catch (error) {
        ActivityLogService.record({
          category: 'cloud',
          action: 'add',
          target: 'google',
          outcome: 'failure',
          message: getErrorMessage(error),
        });
        throw error;
      }
    }),

  listCloudAccounts: os.output(z.array(CloudAccountSchema)).handler(async () => {
    return listCloudAccounts();
  }),

  deleteCloudAccount: os
    .input(z.object({ accountId: z.string() }))
    .output(z.void())
    .handler(async ({ input }) => {
      try {
        await deleteCloudAccount(input.accountId);
        ActivityLogService.record({
          category: 'cloud',
          action: 'delete',
          target: input.accountId,
          outcome: 'success',
          message: 'Cloud account deleted.',
        });
      } catch (error) {
        ActivityLogService.record({
          category: 'cloud',
          action: 'delete',
          target: input.accountId,
          outcome: 'failure',
          message: getErrorMessage(error),
        });
        throw error;
      }
    }),

  deleteCloudAccountsBatch: os
    .input(z.object({ accountIds: z.array(z.string()) }))
    .output(deleteCloudAccountsBatchResultSchema)
    .handler(async ({ input }) => {
      const result = await deleteCloudAccountsBatch(input.accountIds);
      ActivityLogService.record({
        category: 'cloud',
        action: 'delete-batch',
        target: `${input.accountIds.length} accounts`,
        outcome: result.failed.length > 0 ? 'failure' : 'success',
        message:
          result.failed.length > 0
            ? `${result.deletedIds.length} deleted / ${result.failed.length} failed.`
            : `${result.deletedIds.length} cloud accounts deleted.`,
        metadata: {
          deletedIds: result.deletedIds,
          failed: result.failed,
        },
      });
      return result;
    }),

  refreshAccountQuota: os
    .input(z.object({ accountId: z.string() }))
    .output(CloudAccountSchema)
    .handler(async ({ input }) => {
      try {
        const account = await refreshAccountQuota(input.accountId);
        ActivityLogService.record({
          category: 'cloud',
          action: 'refresh',
          target: account.email,
          outcome: 'success',
          message: 'Cloud quota refreshed.',
          metadata: { accountId: account.id },
        });
        return account;
      } catch (error) {
        ActivityLogService.record({
          category: 'cloud',
          action: 'refresh',
          target: input.accountId,
          outcome: 'failure',
          message: getErrorMessage(error),
        });
        throw error;
      }
    }),

  switchCloudAccount: os
    .input(z.object({ accountId: z.string() }))
    .output(z.void())
    .handler(async ({ input }) => {
      try {
        await switchCloudAccount(input.accountId);
        ActivityLogService.record({
          category: 'cloud',
          action: 'switch',
          target: input.accountId,
          outcome: 'success',
          message: 'Cloud account switch completed.',
        });
      } catch (error) {
        ActivityLogService.record({
          category: 'cloud',
          action: 'switch',
          target: input.accountId,
          outcome: 'failure',
          message: getErrorMessage(error),
        });
        throw error;
      }
    }),

  getAutoSwitchEnabled: os.output(z.boolean()).handler(async () => {
    return getAutoSwitchEnabled();
  }),

  setAutoSwitchEnabled: os
    .input(z.object({ enabled: z.boolean() }))
    .output(z.void())
    .handler(async ({ input }) => {
      await setAutoSwitchEnabled(input.enabled);
    }),

  forcePollCloudMonitor: os.output(z.void()).handler(async () => {
    await forcePollCloudMonitor();
  }),

  startAuthFlow: os.output(z.void()).handler(async () => {
    await startAuthFlow();
  }),

  syncLocalAccount: os.output(CloudAccountSchema.nullable()).handler(async () => {
    try {
      const result = await CloudAccountRepo.syncFromIDE();
      if (result) {
        ActivityLogService.record({
          category: 'cloud',
          action: 'sync-local',
          target: result.email,
          outcome: 'success',
          message: 'Cloud account synced from IDE.',
          metadata: { accountId: result.id },
        });
      }

      return result;
    } catch (error: unknown) {
      logger.error('[ORPC] syncLocalAccount error:', getErrorMessage(error), error);
      ActivityLogService.record({
        category: 'cloud',
        action: 'sync-local',
        target: 'ide',
        outcome: 'failure',
        message: getErrorMessage(error),
      });
      throw error;
    }
  }),

  getSwitchStatus: os.output(switchStatusSnapshotSchema).handler(async () => {
    return {
      metrics: getSwitchMetricsSnapshot(),
      guard: getSwitchGuardSnapshot(),
      hardening: getDeviceHardeningSnapshot(),
    };
  }),

  getIdentityProfiles: os
    .input(z.object({ accountId: z.string() }))
    .output(DeviceProfilesSnapshotSchema)
    .handler(async ({ input }) => {
      return getCloudIdentityProfiles(input.accountId);
    }),

  previewIdentityProfile: os.output(DeviceProfileSchema).handler(async () => {
    return previewGenerateCloudIdentityProfile();
  }),

  bindIdentityProfile: os
    .input(z.object({ accountId: z.string(), mode: z.enum(['capture', 'generate']) }))
    .output(DeviceProfileSchema)
    .handler(async ({ input }) => {
      return bindCloudIdentityProfile(input.accountId, input.mode);
    }),

  bindIdentityProfileWithPayload: os
    .input(z.object({ accountId: z.string(), profile: DeviceProfileSchema }))
    .output(DeviceProfileSchema)
    .handler(async ({ input }) => {
      return bindCloudIdentityProfileWithPayload(input.accountId, input.profile);
    }),

  restoreIdentityProfileRevision: os
    .input(z.object({ accountId: z.string(), versionId: z.string() }))
    .output(DeviceProfileSchema)
    .handler(async ({ input }) => {
      return restoreCloudIdentityProfileRevision(input.accountId, input.versionId);
    }),

  restoreBaselineProfile: os
    .input(z.object({ accountId: z.string() }))
    .output(DeviceProfileSchema)
    .handler(async ({ input }) => {
      return restoreCloudBaselineProfile(input.accountId);
    }),

  deleteIdentityProfileRevision: os
    .input(z.object({ accountId: z.string(), versionId: z.string() }))
    .output(z.void())
    .handler(async ({ input }) => {
      await deleteCloudIdentityProfileRevision(input.accountId, input.versionId);
    }),

  openIdentityStorageFolder: os.output(z.void()).handler(async () => {
    await openCloudIdentityStorageFolder();
  }),
});
