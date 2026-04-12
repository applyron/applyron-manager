import { v4 as uuidv4 } from 'uuid';
import { CloudAccountRepo } from '../../ipc/database/cloudHandler';
import { GoogleAPIService } from '../../services/GoogleAPIService';
import { CloudAccount } from '../../types/cloudAccount';
import { logger } from '../../utils/logger';

import fs from 'fs';
import { updateTrayMenu } from '../../ipc/tray/handler';
import {
  ensureGlobalOriginalFromCurrentStorage,
  generateDeviceProfile,
  getStorageDirectoryPath,
  isIdentityProfileApplyEnabled,
  loadGlobalOriginalProfile,
  readCurrentDeviceProfile,
  saveGlobalOriginalProfile,
} from '../../ipc/device/handler';
import { getAntigravityDbPaths } from '../../utils/paths';
import { runWithSwitchGuard } from '../../ipc/switchGuard';
import { executeSwitchFlow } from '../../ipc/switchFlow';
import type { DeviceProfile, DeviceProfilesSnapshot } from '../../types/account';
import { isPackagedE2EEnvironment } from '../../utils/runtimeMode';
import { openExternalWithPolicy } from '../../utils/externalNavigation';
import { openPathOrThrow } from '../../utils/openPath';
import { AuthServer } from './authServer';
import { getErrorCode, getErrorMessage } from '../../utils/errorHandling';
import { normalizeProjectId } from '../../utils/projectId';

const GOOGLE_AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const inflightGoogleAccountAdds = new Map<string, Promise<CloudAccount>>();
const recentlyHandledGoogleAuthCodes = new Map<string, number>();

export interface DeleteCloudAccountsBatchResult {
  deletedIds: string[];
  failed: Array<{
    accountId: string;
    message: string;
  }>;
}

// Helper to update tray
function notifyTrayUpdate(account: CloudAccount) {
  try {
    // Fetch language setting. Default to 'en' if not set.

    const lang = CloudAccountRepo.getSetting<string>('language', 'en');
    updateTrayMenu(account, lang);
  } catch (e) {
    logger.warn('Failed to update tray', e);
  }
}

function normalizeGoogleAuthCode(authCode: string): string {
  return authCode.trim();
}

function pruneHandledGoogleAuthCodes(now = Date.now()): void {
  for (const [code, handledAt] of recentlyHandledGoogleAuthCodes.entries()) {
    if (now - handledAt > GOOGLE_AUTH_CODE_TTL_MS) {
      recentlyHandledGoogleAuthCodes.delete(code);
    }
  }
}

function createGoogleAuthCodeReuseError(): Error {
  return new Error(
    'This Google authorization code was already used. Please start a new login flow and try again.',
  );
}

function hasValidQuotaModels(account: Pick<CloudAccount, 'quota'>): boolean {
  return Object.keys(account.quota?.models ?? {}).length > 0;
}

async function resolveAccountQuotaFetchOptions(
  account: CloudAccount,
): Promise<Parameters<typeof GoogleAPIService.fetchQuota>[1]> {
  const projectId = normalizeProjectId(account.token.project_id);
  if (projectId) {
    return {
      projectId,
      subscriptionTier: account.quota?.subscription_tier,
    };
  }

  const context = await GoogleAPIService.fetchProjectContext(account.token.access_token);
  const resolvedProjectId = normalizeProjectId(context.projectId);
  if (resolvedProjectId && resolvedProjectId !== account.token.project_id) {
    account.token.project_id = resolvedProjectId;
    await CloudAccountRepo.updateToken(account.id, account.token);
  }

  return {
    projectId: resolvedProjectId,
    subscriptionTier: context.subscriptionTier ?? account.quota?.subscription_tier,
  };
}

async function fetchLatestQuotaSnapshot(account: CloudAccount) {
  const quota = await GoogleAPIService.fetchQuota(
    account.token.access_token,
    await resolveAccountQuotaFetchOptions(account),
  );
  if (hasValidQuotaModels({ quota })) {
    return quota;
  }

  logger.warn(
    `Quota refresh for ${account.email} returned no valid models; preserving the last known snapshot.`,
  );
  return null;
}

async function applyQuotaRefreshSuccess(account: CloudAccount, quota: CloudAccount['quota']) {
  if (quota) {
    account.quota = quota;
    await CloudAccountRepo.updateQuota(account.id, quota);
  }
  await CloudAccountRepo.updateLastUsed(account.id);
  account.last_used = Math.floor(Date.now() / 1000);
  notifyTrayUpdate(account);
  return account;
}

export async function addGoogleAccount(authCode: string): Promise<CloudAccount> {
  const normalizedAuthCode = normalizeGoogleAuthCode(authCode);
  if (!normalizedAuthCode) {
    throw new Error('Authorization code is required.');
  }

  pruneHandledGoogleAuthCodes();

  const inflightRequest = inflightGoogleAccountAdds.get(normalizedAuthCode);
  if (inflightRequest) {
    logger.warn('Deduplicating duplicate Google account add request for the same auth code');
    return inflightRequest;
  }

  if (recentlyHandledGoogleAuthCodes.has(normalizedAuthCode)) {
    logger.warn('Rejected duplicate Google auth code after it was already handled');
    throw createGoogleAuthCodeReuseError();
  }

  const requestPromise = (async () => {
    recentlyHandledGoogleAuthCodes.set(normalizedAuthCode, Date.now());

    try {
      // 1. Exchange code for tokens
      const redirectUri = AuthServer.getRedirectUriForExchange();
      if (!redirectUri) {
        throw new Error('Google auth session is not ready. Please start a new login flow.');
      }

      const tokenResp = await GoogleAPIService.exchangeCode(normalizedAuthCode, redirectUri);

      // 2. Get User Info
      const userInfo = await GoogleAPIService.getUserInfo(tokenResp.access_token);

      // 3. Construct CloudAccount Object
      const now = Math.floor(Date.now() / 1000);
      const account: CloudAccount = {
        id: uuidv4(),
        provider: 'google',
        email: userInfo.email,
        name: userInfo.name || userInfo.email,
        avatar_url: userInfo.picture,
        token: {
          access_token: tokenResp.access_token,
          refresh_token: tokenResp.refresh_token || '', // prompt=consent guarantees this, but we fallback safely
          expires_in: tokenResp.expires_in,
          expiry_timestamp: now + tokenResp.expires_in,
          token_type: tokenResp.token_type,
          email: userInfo.email,
        },
        created_at: now,
        last_used: now,
      };

      if (!account.token.refresh_token) {
        logger.warn(
          `No refresh token received for ${account.email}. Account will expire in 1 hour.`,
        );
      }

      // 4. Save to DB
      await CloudAccountRepo.addAccount(account);

      // 5. Initial Quota Check (Async, best effort)
      try {
        const quota = await fetchLatestQuotaSnapshot(account);
        if (quota) {
          account.quota = quota;
          await CloudAccountRepo.updateQuota(account.id, quota);
          notifyTrayUpdate(account);
        }
      } catch (e) {
        logger.warn('Failed to fetch initial quota', e);
      }

      return account;
    } catch (error) {
      logger.error('Failed to add Google account', error);
      throw error;
    } finally {
      inflightGoogleAccountAdds.delete(normalizedAuthCode);
    }
  })();

  inflightGoogleAccountAdds.set(normalizedAuthCode, requestPromise);

  try {
    return await requestPromise;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes('authorization code was already used')
    ) {
      throw error;
    }
    throw error;
  }
}

export async function listCloudAccounts(): Promise<CloudAccount[]> {
  return CloudAccountRepo.getAccounts();
}

export async function deleteCloudAccount(accountId: string): Promise<void> {
  await CloudAccountRepo.removeAccount(accountId);
}

export async function deleteCloudAccountsBatch(
  accountIds: string[],
): Promise<DeleteCloudAccountsBatchResult> {
  const uniqueIds = Array.from(
    new Set(accountIds.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
  const results = await Promise.allSettled(
    uniqueIds.map((accountId) => deleteCloudAccount(accountId)),
  );

  const summary: DeleteCloudAccountsBatchResult = {
    deletedIds: [],
    failed: [],
  };

  results.forEach((result, index) => {
    const accountId = uniqueIds[index];
    if (!accountId) {
      return;
    }

    if (result.status === 'fulfilled') {
      summary.deletedIds.push(accountId);
      return;
    }

    summary.failed.push({
      accountId,
      message: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });

  return summary;
}

export async function refreshAccountQuota(accountId: string): Promise<CloudAccount> {
  const account = await CloudAccountRepo.getAccount(accountId);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  // Check if token needs refresh
  let now = Math.floor(Date.now() / 1000);
  if (account.token.expiry_timestamp < now + 300) {
    // 5 minutes buffer
    logger.info(`Token for ${account.email} near expiry, refreshing...`);
    try {
      const newTokenData = await GoogleAPIService.refreshAccessToken(account.token.refresh_token);

      // Update token in memory object
      account.token.access_token = newTokenData.access_token;
      account.token.expires_in = newTokenData.expires_in;
      account.token.expiry_timestamp = now + newTokenData.expires_in;

      // Save to DB
      await CloudAccountRepo.updateToken(account.id, account.token);
    } catch (e) {
      logger.error(`Failed to refresh token during time-check for ${account.email}`, e);
    }
  }

  try {
    const quota = await fetchLatestQuotaSnapshot(account);
    return applyQuotaRefreshSuccess(account, quota ?? account.quota);
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    if (message === 'UNAUTHORIZED') {
      logger.warn(`Got 401 Unauthorized for ${account.email}, forcing token refresh...`);
      try {
        // Force Refresh
        const newTokenData = await GoogleAPIService.refreshAccessToken(account.token.refresh_token);
        now = Math.floor(Date.now() / 1000);

        account.token.access_token = newTokenData.access_token;
        account.token.expires_in = newTokenData.expires_in;
        account.token.expiry_timestamp = now + newTokenData.expires_in;

        await CloudAccountRepo.updateToken(account.id, account.token);

        // Retry Quota
        const quota = await fetchLatestQuotaSnapshot(account);
        return applyQuotaRefreshSuccess(account, quota ?? account.quota);
      } catch (refreshError) {
        logger.error(
          `Failed to force refresh token or retry quota for ${account.email}`,
          refreshError,
        );
        throw refreshError;
      }
    } else if (message === 'FORBIDDEN') {
      logger.warn(
        `Got 403 Forbidden for ${account.email}, marking as rate limited (if implemented) or just ignoring.`,
      );
      // Return existing account to avoid crash
      return account;
    }

    logger.error(`Failed to refresh quota for ${account.email}`, error);
    throw error;
  }
}

export async function switchCloudAccount(accountId: string): Promise<void> {
  await runWithSwitchGuard('cloud-account-switch', async () => {
    try {
      const account = await CloudAccountRepo.getAccount(accountId);
      if (!account) {
        throw new Error(`Account not found: ${accountId}`);
      }

      logger.info(`Switching to cloud account: ${account.email} (${account.id})`);

      ensureGlobalOriginalFromCurrentStorage();
      if (!account.device_profile) {
        const generated = generateDeviceProfile();
        CloudAccountRepo.setDeviceBinding(account.id, generated, 'auto_generated');
        saveGlobalOriginalProfile(generated);
        account.device_profile = generated;
      }

      // 1. Prepare token refresh promise (start it in parallel with process exit)
      const tokenRefreshPromise = (async () => {
        const now = Math.floor(Date.now() / 1000);
        if (account.token.expiry_timestamp < now + 1200) {
          // Increased buffer to 20m
          logger.info(`Token for ${account.email} near expiry, refreshing in parallel...`);
          try {
            const newTokenData = await GoogleAPIService.refreshAccessToken(
              account.token.refresh_token,
            );
            account.token.access_token = newTokenData.access_token;
            account.token.expires_in = newTokenData.expires_in;
            account.token.expiry_timestamp = now + newTokenData.expires_in;
            await CloudAccountRepo.updateToken(account.id, account.token);
            logger.info(`Token refreshed for ${account.email}`);
          } catch (e) {
            logger.warn('Failed to refresh token in parallel, will try to use existing', e);
          }
        }
      })();

      await executeSwitchFlow({
        scope: 'cloud',
        targetProfile: account.device_profile || null,
        applyFingerprint: isIdentityProfileApplyEnabled(),
        processExitTimeoutMs: 10000,
        performSwitch: async () => {
          // Wait for token refresh to complete before injection if it was started
          await tokenRefreshPromise;

          // 3. Backup Database (Optimized to avoid race conditions)
          const dbPaths = getAntigravityDbPaths();
          for (const dbPath of dbPaths) {
            try {
              const backupPath = `${dbPath}.backup`;
              await fs.promises.copyFile(dbPath, backupPath);
              logger.info(`Backed up database to ${backupPath}`);
              break; // Success, stop trying other paths
            } catch (error: unknown) {
              // If file not found, just try the next path
              if (getErrorCode(error) === 'ENOENT') {
                continue;
              }
              logger.error(`Failed to backup database at ${dbPath}`, error);
            }
          }

          // 4. Inject Token
          await CloudAccountRepo.injectCloudToken(account);

          // 5. Update usage and active status
          CloudAccountRepo.updateLastUsed(account.id);
          CloudAccountRepo.setActive(account.id);

          logger.info(`Successfully switched to cloud account: ${account.email}`);
          notifyTrayUpdate(account);
        },
      });
    } catch (error) {
      logger.error('Failed to switch cloud account', error);
      throw error;
    }
  });
}

export async function getCloudIdentityProfiles(accountId: string): Promise<DeviceProfilesSnapshot> {
  const account = await CloudAccountRepo.getAccount(accountId);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  let currentStorage: DeviceProfile | undefined;
  try {
    currentStorage = readCurrentDeviceProfile();
  } catch (error) {
    logger.warn('Failed to read current storage device profile', error);
  }

  return {
    currentStorage,
    boundProfile: account.device_profile,
    history: account.device_history || [],
    baseline: loadGlobalOriginalProfile() || undefined,
  };
}

export async function previewGenerateCloudIdentityProfile(): Promise<DeviceProfile> {
  return generateDeviceProfile();
}

export async function bindCloudIdentityProfile(
  accountId: string,
  mode: 'capture' | 'generate',
): Promise<DeviceProfile> {
  const account = await CloudAccountRepo.getAccount(accountId);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  let profile: DeviceProfile;
  if (mode === 'capture') {
    profile = readCurrentDeviceProfile();
  } else {
    profile = generateDeviceProfile();
  }

  ensureGlobalOriginalFromCurrentStorage();
  saveGlobalOriginalProfile(profile);
  CloudAccountRepo.setDeviceBinding(account.id, profile, mode);

  return profile;
}

export async function bindCloudIdentityProfileWithPayload(
  accountId: string,
  profile: DeviceProfile,
): Promise<DeviceProfile> {
  const account = await CloudAccountRepo.getAccount(accountId);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  ensureGlobalOriginalFromCurrentStorage();
  saveGlobalOriginalProfile(profile);
  CloudAccountRepo.setDeviceBinding(account.id, profile, 'generated');

  return profile;
}

export async function restoreCloudIdentityProfileRevision(
  accountId: string,
  versionId: string,
): Promise<DeviceProfile> {
  const baseline = loadGlobalOriginalProfile();
  return CloudAccountRepo.restoreDeviceVersion(accountId, versionId, baseline);
}

export async function restoreCloudBaselineProfile(accountId: string): Promise<DeviceProfile> {
  const baseline = loadGlobalOriginalProfile();
  if (!baseline) {
    throw new Error('Global original profile not found');
  }
  return CloudAccountRepo.restoreDeviceVersion(accountId, 'baseline', baseline);
}

export async function deleteCloudIdentityProfileRevision(
  accountId: string,
  versionId: string,
): Promise<void> {
  CloudAccountRepo.deleteDeviceVersion(accountId, versionId);
}

export async function openCloudIdentityStorageFolder(): Promise<void> {
  const directory = getStorageDirectoryPath();
  await openPathOrThrow(directory, 'identity storage folder');
}

export function getAutoSwitchEnabled(): boolean {
  return CloudAccountRepo.getSetting<boolean>('auto_switch_enabled', false);
}

export async function setAutoSwitchEnabled(enabled: boolean): Promise<void> {
  CloudAccountRepo.setSetting('auto_switch_enabled', enabled);

  if (!enabled) {
    logger.info('Auto-switch disabled; quota monitor remains active.');
    return;
  }

  if (isPackagedE2EEnvironment()) {
    logger.info('Auto-switch enabled during E2E package run; skipping quota monitor start.');
    return;
  }

  const { cloudMonitorService } = await import('../../services/CloudMonitorService');
  logger.info('Auto-switch enabled; ensuring quota monitor is running and polling now.');
  cloudMonitorService.start();
  cloudMonitorService
    .poll()
    .catch((err: unknown) => logger.error('Failed to poll after enabling auto-switch', err));
}

export async function forcePollCloudMonitor(): Promise<void> {
  const { cloudMonitorService } = await import('../../services/CloudMonitorService');
  await cloudMonitorService.poll();
}

export async function startAuthFlow(): Promise<void> {
  const { redirectUri } = await AuthServer.startOrReuse();
  const url = GoogleAPIService.getAuthUrl(redirectUri);

  logger.info(`Starting auth flow, opening URL: ${url}`);
  try {
    await openExternalWithPolicy({ intent: 'google_auth', url });
  } catch (error) {
    AuthServer.stop({
      nextState: 'error',
      message: error instanceof Error ? error.message : 'Failed to open Google auth flow.',
    });
    throw error;
  }
}
