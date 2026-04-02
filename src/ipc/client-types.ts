import type { AppConfig } from '../types/config';
import type {
  Account,
  AccountBackupData,
  AccountInfo,
  DeviceProfile,
  DeviceProfilesSnapshot,
} from '../types/account';
import type { CloudAccount } from '../types/cloudAccount';
import type {
  AppUpdateStatus,
  DashboardAnnouncement,
  ServiceHealthSummary,
} from '../types/dashboard';
import type {
  CodexAccountRecord,
  ManagedIdeCurrentStatus,
  ManagedIdeRuntimeTarget,
  ManagedIdeTargetId,
} from '../managedIde/types';
import type { ExternalNavigationIntent } from '../utils/externalNavigation';
import type { DeleteCloudAccountsBatchResult } from './cloud/handler';
import type {
  ActivityEventCategory,
  ActivityEventListResult,
  FilePickerResult,
  ImportApplyResult,
  ImportPreviewSummary,
  ProxyDiagnosticsSnapshot,
} from '../types/operations';

export interface SwitchMetricBucketSnapshot {
  switchSuccess: number;
  switchFailure: number;
  rollbackAttempt: number;
  rollbackSuccess: number;
  rollbackFailure: number;
  failureReasons: Record<string, number>;
  lastFailure: {
    reason: string;
    message: string;
    occurredAt: number;
  } | null;
}

export interface SwitchStatusSnapshot {
  metrics: {
    local: SwitchMetricBucketSnapshot;
    cloud: SwitchMetricBucketSnapshot;
  };
  guard: {
    activeOwner: 'local-account-switch' | 'cloud-account-switch' | null;
    pendingOwners: Array<'local-account-switch' | 'cloud-account-switch'>;
    pendingCount: number;
  };
  hardening: {
    consecutiveApplyFailures: number;
    safeModeActive: boolean;
    safeModeUntil: number | null;
    lastFailureReason: string | null;
    lastFailureStage: string | null;
    lastFailureAt: number | null;
  };
}

export interface GatewayStatus {
  running: boolean;
  port: number;
  base_url: string;
  active_accounts: number;
}

export interface IPCClient {
  window: {
    minimizeWindow(): Promise<void>;
    maximizeWindow(): Promise<void>;
    closeWindow(): Promise<void>;
  };
  database: {
    backupAccount(account: Account): Promise<AccountBackupData>;
    restoreAccount(backup: AccountBackupData): Promise<void>;
    getCurrentAccountInfo(): Promise<AccountInfo>;
  };
  theme: {
    getCurrentThemeMode(): Promise<'light' | 'dark' | 'system'>;
    setThemeMode(mode: 'light' | 'dark' | 'system'): Promise<'light' | 'dark' | 'system'>;
    toggleThemeMode(): Promise<boolean>;
  };
  app: {
    currentPlatfom(): Promise<NodeJS.Platform>;
    appVersion(): Promise<string>;
    getUpdateStatus(): Promise<AppUpdateStatus>;
    getDashboardAnnouncements(): Promise<DashboardAnnouncement[]>;
    getServiceHealthSummary(): Promise<ServiceHealthSummary>;
    checkForUpdatesManual(): Promise<AppUpdateStatus>;
    installDownloadedUpdate(): Promise<AppUpdateStatus>;
  };
  proc: {
    isProcessRunning(input?: { targetId?: ManagedIdeTargetId } | null): Promise<boolean>;
    closeManagedIde(input?: { targetId?: ManagedIdeTargetId } | null): Promise<void>;
    startManagedIde(input?: { targetId?: ManagedIdeTargetId } | null): Promise<void>;
    closeAntigravity(): Promise<void>;
    startAntigravity(): Promise<void>;
  };
  account: {
    listAccounts(): Promise<Account[]>;
    addAccountSnapshot(): Promise<Account>;
    switchAccount(input: { accountId: string }): Promise<void>;
    deleteAccount(input: { accountId: string }): Promise<void>;
    previewGenerateIdentityProfile(): Promise<DeviceProfile>;
    getIdentityProfiles(input: { accountId: string }): Promise<DeviceProfilesSnapshot>;
    bindIdentityProfile(input: {
      accountId: string;
      mode: 'capture' | 'generate';
    }): Promise<DeviceProfile>;
    bindIdentityProfileWithPayload(input: {
      accountId: string;
      profile: DeviceProfile;
    }): Promise<DeviceProfile>;
    applyBoundIdentityProfile(input: { accountId: string }): Promise<DeviceProfile>;
    restoreIdentityProfileRevision(input: {
      accountId: string;
      versionId: string;
    }): Promise<DeviceProfile>;
    deleteIdentityProfileRevision(input: { accountId: string; versionId: string }): Promise<void>;
    restoreBaselineProfile(input: { accountId: string }): Promise<DeviceProfile>;
    openIdentityStorageFolder(): Promise<void>;
  };
  cloud: {
    addGoogleAccount(input: { authCode: string }): Promise<CloudAccount>;
    listCloudAccounts(): Promise<CloudAccount[]>;
    deleteCloudAccount(input: { accountId: string }): Promise<void>;
    deleteCloudAccountsBatch(input: {
      accountIds: string[];
    }): Promise<DeleteCloudAccountsBatchResult>;
    refreshAccountQuota(input: { accountId: string }): Promise<CloudAccount>;
    switchCloudAccount(input: { accountId: string }): Promise<void>;
    getAutoSwitchEnabled(): Promise<boolean>;
    setAutoSwitchEnabled(input: { enabled: boolean }): Promise<void>;
    forcePollCloudMonitor(): Promise<void>;
    syncLocalAccount(): Promise<CloudAccount | null>;
    startAuthFlow(): Promise<void>;
    getSwitchStatus(): Promise<SwitchStatusSnapshot>;
    getIdentityProfiles(input: { accountId: string }): Promise<DeviceProfilesSnapshot>;
    previewIdentityProfile(): Promise<DeviceProfile>;
    bindIdentityProfile(input: {
      accountId: string;
      mode: 'capture' | 'generate';
    }): Promise<DeviceProfile>;
    bindIdentityProfileWithPayload(input: {
      accountId: string;
      profile: DeviceProfile;
    }): Promise<DeviceProfile>;
    restoreIdentityProfileRevision(input: {
      accountId: string;
      versionId: string;
    }): Promise<DeviceProfile>;
    restoreBaselineProfile(input: { accountId: string }): Promise<DeviceProfile>;
    deleteIdentityProfileRevision(input: { accountId: string; versionId: string }): Promise<void>;
    openIdentityStorageFolder(): Promise<void>;
  };
  config: {
    load(): Promise<AppConfig>;
    save(config: AppConfig): Promise<void>;
  };
  gateway: {
    start(input: { port: number }): Promise<{ success: boolean }>;
    stop(): Promise<{ success: boolean }>;
    status(): Promise<GatewayStatus>;
    getDiagnostics(): Promise<ProxyDiagnosticsSnapshot>;
    generateKey(): Promise<{ api_key: string }>;
  };
  operations: {
    pickExportBundlePath(
      input?: { defaultDirectory?: string | null } | null,
    ): Promise<FilePickerResult>;
    pickImportBundleFile(
      input?: { defaultDirectory?: string | null } | null,
    ): Promise<FilePickerResult>;
    listActivityEvents(
      input?: {
        limit?: number;
        offset?: number;
        categories?: ActivityEventCategory[];
      } | null,
    ): Promise<ActivityEventListResult>;
    exportBundle(input: { filePath: string; password: string }): Promise<{
      filePath: string;
      counts: {
        legacy: number;
        cloud: number;
        codex: number;
      };
    }>;
    importBundle(
      input:
        | {
            mode: 'preview';
            filePath: string;
            password: string;
          }
        | {
            mode: 'apply';
            previewId: string;
          },
    ): Promise<ImportPreviewSummary | ImportApplyResult>;
  };
  managedIde: {
    listTargets(): Promise<ManagedIdeRuntimeTarget[]>;
    getCurrentStatus(
      input?: { targetId?: ManagedIdeTargetId; refresh?: boolean } | null,
    ): Promise<ManagedIdeCurrentStatus>;
    refreshCurrentStatus(
      input?: { targetId?: ManagedIdeTargetId } | null,
    ): Promise<ManagedIdeCurrentStatus>;
    importCurrentSession(
      input?: { targetId?: ManagedIdeTargetId } | null,
    ): Promise<ManagedIdeCurrentStatus>;
    openIde(input?: { targetId?: ManagedIdeTargetId } | null): Promise<void>;
    openLoginGuidance(input?: { targetId?: ManagedIdeTargetId } | null): Promise<void>;
    listCodexAccounts(): Promise<CodexAccountRecord[]>;
    addCodexAccount(): Promise<CodexAccountRecord[]>;
    importCurrentCodexAccount(): Promise<CodexAccountRecord>;
    refreshCodexAccount(input: { id: string }): Promise<CodexAccountRecord>;
    refreshAllCodexAccounts(): Promise<CodexAccountRecord[]>;
    activateCodexAccount(input: { id: string }): Promise<CodexAccountRecord>;
    deleteCodexAccount(input: { id: string }): Promise<void>;
  };
  system: {
    openLogDirectory(): Promise<void>;
    openExternalUrl(input: { url: string; intent: ExternalNavigationIntent }): Promise<void>;
    get_local_ips(): Promise<Array<{ address: string; name: string; isRecommended: boolean }>>;
    getManagedIdeTargets(): Promise<
      Array<{
        id: string;
        displayName: string;
        shortName: string;
        processDisplayName: string;
        capabilities: {
          accountStorageRead: boolean;
          quotaManagement: boolean;
          processControl: boolean;
          visibleInUi: boolean;
          experimental: boolean;
        };
      }>
    >;
  };
}
