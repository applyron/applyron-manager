import { z } from 'zod';

export const ManagedIdeAvailabilityReasonSchema = z.enum([
  'ready',
  'unsupported_platform',
  'ide_not_found',
  'extension_not_found',
  'codex_cli_not_found',
  'app_server_unavailable',
  'not_signed_in',
  'unknown_error',
]);

export const CodexRuntimeIdSchema = z.enum(['windows-local', 'wsl-remote']);

export const ManagedIdeQuotaWindowSchema = z.object({
  usedPercent: z.number(),
  resetsAt: z.number().nullable(),
  windowDurationMins: z.number().nullable(),
});

export const ManagedIdeQuotaCreditsSnapshotSchema = z.object({
  hasCredits: z.boolean(),
  unlimited: z.boolean(),
  balance: z.string().nullable(),
});

export const ManagedIdeQuotaSnapshotSchema = z.object({
  limitId: z.string().nullable(),
  limitName: z.string().nullable(),
  planType: z.string().nullable(),
  primary: ManagedIdeQuotaWindowSchema.nullable(),
  secondary: ManagedIdeQuotaWindowSchema.nullable(),
  credits: ManagedIdeQuotaCreditsSnapshotSchema.nullable(),
});

export const ManagedIdeSessionSnapshotSchema = z.object({
  state: z.enum(['ready', 'requires_login', 'unavailable']),
  accountType: z.enum(['chatgpt', 'apiKey']).nullable(),
  authMode: z.enum(['chatgpt', 'apikey', 'chatgptAuthTokens']).nullable(),
  email: z.string().nullable(),
  planType: z.string().nullable(),
  requiresOpenaiAuth: z.boolean(),
  serviceTier: z.string().nullable(),
  agentMode: z.string().nullable(),
  lastUpdatedAt: z.number(),
});

export const ManagedIdeInstallationStatusSchema = z.object({
  targetId: z.enum(['antigravity', 'vscode-codex']),
  platformSupported: z.boolean(),
  available: z.boolean(),
  reason: ManagedIdeAvailabilityReasonSchema,
  idePath: z.string().nullable(),
  ideVersion: z.string().nullable(),
  extensionPath: z.string().nullable(),
  extensionVersion: z.string().nullable(),
  codexCliPath: z.string().nullable(),
  extensionId: z.string().nullable(),
});

export const ManagedIdeCodexRuntimeStatusSchema = z.object({
  id: CodexRuntimeIdSchema,
  displayName: z.string(),
  installation: ManagedIdeInstallationStatusSchema,
  session: ManagedIdeSessionSnapshotSchema,
  quota: ManagedIdeQuotaSnapshotSchema.nullable(),
  quotaByLimitId: z.record(z.string(), ManagedIdeQuotaSnapshotSchema).nullable(),
  authFilePath: z.string().nullable(),
  stateDbPath: z.string().nullable(),
  storagePath: z.string().nullable(),
  authLastUpdatedAt: z.number().nullable(),
  extensionStateUpdatedAt: z.number().nullable(),
  lastUpdatedAt: z.number(),
});

export const CodexPendingRuntimeApplySchema = z.object({
  runtimeId: CodexRuntimeIdSchema,
  recordId: z.string(),
});

export const ManagedIdeCurrentStatusSchema = z.object({
  targetId: z.enum(['antigravity', 'vscode-codex']),
  installation: ManagedIdeInstallationStatusSchema,
  session: ManagedIdeSessionSnapshotSchema,
  quota: ManagedIdeQuotaSnapshotSchema.nullable(),
  quotaByLimitId: z.record(z.string(), ManagedIdeQuotaSnapshotSchema).nullable(),
  isProcessRunning: z.boolean(),
  lastUpdatedAt: z.number(),
  fromCache: z.boolean(),
  activeRuntimeId: CodexRuntimeIdSchema.nullable(),
  requiresRuntimeSelection: z.boolean(),
  hasRuntimeMismatch: z.boolean(),
  pendingRuntimeApply: CodexPendingRuntimeApplySchema.nullable().default(null),
  runtimes: z.array(ManagedIdeCodexRuntimeStatusSchema),
});

export const ManagedIdeRuntimeTargetSchema = z.object({
  id: z.enum(['antigravity', 'vscode-codex']),
  displayName: z.string(),
  shortName: z.string(),
  processDisplayName: z.string(),
  capabilities: z.object({
    accountStorageRead: z.boolean(),
    quotaManagement: z.boolean(),
    processControl: z.boolean(),
    visibleInUi: z.boolean(),
    experimental: z.boolean(),
  }),
  installation: ManagedIdeInstallationStatusSchema,
});

export const CodexAuthTokensSchema = z.object({
  id_token: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  account_id: z.string(),
});

export const CodexAuthFileSchema = z.object({
  auth_mode: z.string().nullable(),
  OPENAI_API_KEY: z.string().nullable(),
  tokens: CodexAuthTokensSchema.nullable(),
  last_refresh: z.string().nullable(),
});

export const CodexWorkspaceSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  role: z.string().nullable(),
  isDefault: z.boolean(),
});

export const CodexAccountSnapshotSchema = z.object({
  session: ManagedIdeSessionSnapshotSchema,
  quota: ManagedIdeQuotaSnapshotSchema.nullable(),
  quotaByLimitId: z.record(z.string(), ManagedIdeQuotaSnapshotSchema).nullable(),
  lastUpdatedAt: z.number(),
});

export const CodexAccountRecordSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  label: z.string().nullable(),
  accountId: z.string(),
  authMode: z.string().nullable(),
  workspace: CodexWorkspaceSummarySchema.nullable().optional().default(null),
  isActive: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastRefreshedAt: z.number().nullable(),
  snapshot: CodexAccountSnapshotSchema.nullable(),
});

export const CodexRuntimeSyncResultSchema = z.object({
  sourceRuntimeId: CodexRuntimeIdSchema,
  targetRuntimeId: CodexRuntimeIdSchema,
  syncedAuthFile: z.boolean(),
  syncedExtensionState: z.boolean(),
  warnings: z.array(z.string()),
});

export const CodexAccountActivationResultSchema = z.object({
  account: CodexAccountRecordSchema,
  appliedRuntimeId: CodexRuntimeIdSchema.nullable(),
  didRestartIde: z.boolean(),
  deferredUntilIdeRestart: z.boolean(),
});

export const CodexImportRestoreStatusSchema = z.enum([
  'applied',
  'stored_only_runtime_selection_required',
  'stored_only_runtime_unavailable',
  'skipped_no_active_codex',
]);

export const CodexImportRestoreResultSchema = z.object({
  restoredAccountId: z.string().nullable(),
  appliedRuntimeId: CodexRuntimeIdSchema.nullable(),
  didRestartIde: z.boolean(),
  status: CodexImportRestoreStatusSchema,
  warnings: z.array(z.string()),
});
