export type ManagedIdeTargetId = 'antigravity' | 'vscode-codex';
export type CodexRuntimeId = 'windows-local' | 'wsl-remote';

export interface CodexPendingRuntimeApply {
  runtimeId: CodexRuntimeId;
  recordId: string;
  requestedAt: number;
}

export interface ManagedIdeTargetCapabilities {
  accountStorageRead: boolean;
  quotaManagement: boolean;
  processControl: boolean;
  visibleInUi: boolean;
  experimental: boolean;
}

export interface ManagedIdeTargetDefinition {
  id: ManagedIdeTargetId;
  displayName: string;
  shortName: string;
  processDisplayName: string;
  appDataDirName: string;
  hiddenFallbackDirName: string;
  legacyAppDataDirNames?: string[];
  uriScheme?: string;
  processSearchNames: string[];
  managerProcessHints: string[];
  macAppName?: string;
  macExecutableName?: string;
  windowsInstallDirNames?: string[];
  windowsExecutableName?: string;
  linuxBinaryNames?: string[];
  capabilities: ManagedIdeTargetCapabilities;
}

export type ManagedIdeAvailabilityReason =
  | 'ready'
  | 'unsupported_platform'
  | 'ide_not_found'
  | 'extension_not_found'
  | 'codex_cli_not_found'
  | 'app_server_unavailable'
  | 'not_signed_in'
  | 'unknown_error';

export interface ManagedIdeQuotaWindow {
  usedPercent: number;
  resetsAt: number | null;
  windowDurationMins: number | null;
}

export interface ManagedIdeQuotaCreditsSnapshot {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export interface ManagedIdeQuotaSnapshot {
  limitId: string | null;
  limitName: string | null;
  planType: string | null;
  primary: ManagedIdeQuotaWindow | null;
  secondary: ManagedIdeQuotaWindow | null;
  credits: ManagedIdeQuotaCreditsSnapshot | null;
}

export interface ManagedIdeSessionSnapshot {
  state: 'ready' | 'requires_login' | 'unavailable';
  accountType: 'chatgpt' | 'apiKey' | null;
  authMode: 'chatgpt' | 'apikey' | 'chatgptAuthTokens' | null;
  email: string | null;
  planType: string | null;
  requiresOpenaiAuth: boolean;
  serviceTier: string | null;
  agentMode: string | null;
  lastUpdatedAt: number;
}

export interface ManagedIdeInstallationStatus {
  targetId: ManagedIdeTargetId;
  platformSupported: boolean;
  available: boolean;
  reason: ManagedIdeAvailabilityReason;
  idePath: string | null;
  ideVersion: string | null;
  extensionPath: string | null;
  extensionVersion: string | null;
  codexCliPath: string | null;
  extensionId: string | null;
}

export interface ManagedIdeCodexRuntimeStatus {
  id: CodexRuntimeId;
  displayName: string;
  installation: ManagedIdeInstallationStatus;
  session: ManagedIdeSessionSnapshot;
  liveAccountIdentityKey: string | null;
  quota: ManagedIdeQuotaSnapshot | null;
  quotaByLimitId: Record<string, ManagedIdeQuotaSnapshot> | null;
  authFilePath: string | null;
  stateDbPath: string | null;
  storagePath: string | null;
  authLastUpdatedAt: number | null;
  extensionStateUpdatedAt: number | null;
  lastUpdatedAt: number;
}

export interface ManagedIdeCurrentStatus {
  targetId: ManagedIdeTargetId;
  installation: ManagedIdeInstallationStatus;
  session: ManagedIdeSessionSnapshot;
  liveAccountIdentityKey: string | null;
  quota: ManagedIdeQuotaSnapshot | null;
  quotaByLimitId: Record<string, ManagedIdeQuotaSnapshot> | null;
  isProcessRunning: boolean;
  lastUpdatedAt: number;
  fromCache: boolean;
  activeRuntimeId: CodexRuntimeId | null;
  requiresRuntimeSelection: boolean;
  hasRuntimeMismatch: boolean;
  pendingRuntimeApply: CodexPendingRuntimeApply | null;
  runtimes: ManagedIdeCodexRuntimeStatus[];
}

export interface ManagedIdeRuntimeTarget {
  id: ManagedIdeTargetId;
  displayName: string;
  shortName: string;
  processDisplayName: string;
  capabilities: ManagedIdeTargetCapabilities;
  installation: ManagedIdeInstallationStatus;
}

export interface CodexAuthTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
  account_id: string;
}

export interface CodexAuthFile {
  auth_mode: string | null;
  OPENAI_API_KEY: string | null;
  tokens: CodexAuthTokens | null;
  last_refresh: string | null;
}

export interface CodexWorkspaceSummary {
  id: string;
  title: string | null;
  role: string | null;
  isDefault: boolean;
}

export interface CodexAccountSnapshot {
  session: ManagedIdeSessionSnapshot;
  quota: ManagedIdeQuotaSnapshot | null;
  quotaByLimitId: Record<string, ManagedIdeQuotaSnapshot> | null;
  lastUpdatedAt: number;
}

export interface CodexAccountRecord {
  id: string;
  email: string | null;
  label: string | null;
  accountId: string;
  authMode: string | null;
  workspace: CodexWorkspaceSummary | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  lastRefreshedAt: number | null;
  snapshot: CodexAccountSnapshot | null;
}

export interface CodexRuntimeSyncResult {
  sourceRuntimeId: CodexRuntimeId;
  targetRuntimeId: CodexRuntimeId;
  syncedAuthFile: boolean;
  syncedExtensionState: boolean;
  warnings: string[];
}

export interface CodexAccountActivationResult {
  account: CodexAccountRecord;
  appliedRuntimeId: CodexRuntimeId | null;
  didRestartIde: boolean;
  deferredUntilIdeRestart: boolean;
}

export type CodexImportRestoreStatus =
  | 'applied'
  | 'stored_only_runtime_selection_required'
  | 'stored_only_runtime_unavailable'
  | 'skipped_no_active_codex';

export interface CodexImportRestoreResult {
  restoredAccountId: string | null;
  appliedRuntimeId: CodexRuntimeId | null;
  didRestartIde: boolean;
  status: CodexImportRestoreStatus;
  warnings: string[];
}

export interface ManagedIdeAdapter {
  readonly targetId: ManagedIdeTargetId;
  getInstallationStatus(): Promise<ManagedIdeInstallationStatus>;
  getCurrentStatus(options?: { refresh?: boolean }): Promise<ManagedIdeCurrentStatus>;
  openIde(): Promise<void>;
  openLoginGuidance(): Promise<void>;
}
