import { z } from 'zod';
import { AccountSchema, AccountBackupDataSchema } from './account';
import { CloudAccountSchema } from './cloudAccount';
import {
  CodexAccountRecordSchema,
  CodexAuthFileSchema,
  CodexAccountSnapshotSchema,
} from '../managedIde/schemas';
import { ServiceHealthItemSchema } from './dashboard';

export const ConnectivityStatusSchema = z.enum(['online', 'offline']);
export type ConnectivityStatus = z.infer<typeof ConnectivityStatusSchema>;

export const ActivityEventCategorySchema = z.enum([
  'cloud',
  'codex',
  'proxy',
  'update',
  'operations',
]);
export type ActivityEventCategory = z.infer<typeof ActivityEventCategorySchema>;

export const ActivityEventOutcomeSchema = z.enum(['success', 'failure', 'info']);
export type ActivityEventOutcome = z.infer<typeof ActivityEventOutcomeSchema>;

export const ActivityEventSchema = z.object({
  id: z.string(),
  occurredAt: z.number(),
  category: ActivityEventCategorySchema,
  action: z.string(),
  target: z.string().nullable(),
  outcome: ActivityEventOutcomeSchema,
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export const ActivityEventListResultSchema = z.object({
  events: z.array(ActivityEventSchema),
  nextOffset: z.number().nullable(),
  total: z.number(),
});
export type ActivityEventListResult = z.infer<typeof ActivityEventListResultSchema>;

export const ProxyMetricsSnapshotSchema = z.object({
  totalRequests: z.number(),
  successResponses: z.number(),
  errorResponses: z.number(),
  capacityRejects: z.number(),
  rateLimitEvents: z.number(),
  streamRequests: z.number(),
  avgLatencyMs: z.number(),
  lastRequestAt: z.number().nullable(),
  lastError: z.string().nullable(),
  modelBreakdown: z.record(z.string(), z.number()),
});
export type ProxyMetricsSnapshot = z.infer<typeof ProxyMetricsSnapshotSchema>;

export const ProxyCapacitySnapshotSchema = z.object({
  reason: z.string().nullable(),
  retryAfterSec: z.number().nullable(),
});
export type ProxyCapacitySnapshot = z.infer<typeof ProxyCapacitySnapshotSchema>;

export const ProxyRateLimitSnapshotSchema = z.object({
  cooldownCount: z.number(),
  upstreamLockCount: z.number(),
  reasonSummary: z.record(z.string(), z.number()),
  nextRetryAt: z.number().nullable(),
  nextRetrySec: z.number().nullable(),
});
export type ProxyRateLimitSnapshot = z.infer<typeof ProxyRateLimitSnapshotSchema>;

export const ProxyParitySnapshotSchema = z.object({
  enabled: z.boolean(),
  shadowEnabled: z.boolean(),
  noGoBlocked: z.boolean(),
  shadowComparisonCount: z.number(),
  shadowMismatchCount: z.number(),
  parityRequestCount: z.number(),
  parityErrorCount: z.number(),
});
export type ProxyParitySnapshot = z.infer<typeof ProxyParitySnapshotSchema>;

export const ProxyDiagnosticsSnapshotSchema = z.object({
  status: z.object({
    running: z.boolean(),
    port: z.number(),
    base_url: z.string(),
    active_accounts: z.number(),
  }),
  serviceHealth: ServiceHealthItemSchema,
  metrics: ProxyMetricsSnapshotSchema,
  capacity: ProxyCapacitySnapshotSchema,
  rateLimits: ProxyRateLimitSnapshotSchema,
  parity: ProxyParitySnapshotSchema,
});
export type ProxyDiagnosticsSnapshot = z.infer<typeof ProxyDiagnosticsSnapshotSchema>;

export const PortableExportKdfSchema = z.object({
  algorithm: z.literal('PBKDF2-SHA256'),
  iterations: z.number(),
  keyLength: z.number(),
});
export type PortableExportKdf = z.infer<typeof PortableExportKdfSchema>;

export const ApplyronPortableLegacyAccountSchema = z.object({
  account: AccountSchema,
  backup: AccountBackupDataSchema,
});
export type ApplyronPortableLegacyAccount = z.infer<typeof ApplyronPortableLegacyAccountSchema>;

export const ApplyronPortableCodexAccountSchema = z.object({
  record: CodexAccountRecordSchema,
  snapshot: CodexAccountSnapshotSchema.nullable(),
  authFile: CodexAuthFileSchema.nullable(),
});
export type ApplyronPortableCodexAccount = z.infer<typeof ApplyronPortableCodexAccountSchema>;

export const ApplyronPortableExportPayloadSchema = z.object({
  version: z.literal('ApplyronPortableExportV1'),
  exportedAt: z.number(),
  appVersion: z.string(),
  legacy: z.array(ApplyronPortableLegacyAccountSchema),
  cloud: z.array(CloudAccountSchema),
  codex: z.array(ApplyronPortableCodexAccountSchema),
});
export type ApplyronPortableExportPayload = z.infer<typeof ApplyronPortableExportPayloadSchema>;

export const ApplyronPortableExportEnvelopeSchema = z.object({
  version: z.literal('ApplyronPortableExportV1'),
  exportedAt: z.number(),
  appVersion: z.string(),
  kdf: PortableExportKdfSchema,
  salt: z.string(),
  iv: z.string(),
  ciphertext: z.string(),
  tag: z.string(),
});
export type ApplyronPortableExportEnvelope = z.infer<typeof ApplyronPortableExportEnvelopeSchema>;

export const ImportPreviewSummarySchema = z.object({
  previewId: z.string(),
  filePath: z.string(),
  fileName: z.string(),
  version: z.string(),
  exportedAt: z.number(),
  appVersion: z.string(),
  counts: z.object({
    legacy: z.number(),
    cloud: z.number(),
    codex: z.number(),
  }),
  dedupe: z.object({
    legacyMatches: z.number(),
    cloudMatches: z.number(),
    codexMatches: z.number(),
  }),
  applyPlan: z.object({
    legacyCreate: z.number(),
    legacyUpdate: z.number(),
    cloudCreate: z.number(),
    cloudUpdate: z.number(),
    codexCreate: z.number(),
    codexUpdate: z.number(),
  }),
});
export type ImportPreviewSummary = z.infer<typeof ImportPreviewSummarySchema>;

export const ImportApplyResultSchema = z.object({
  imported: z.object({
    legacyCreated: z.number(),
    legacyUpdated: z.number(),
    cloudCreated: z.number(),
    cloudUpdated: z.number(),
    codexCreated: z.number(),
    codexUpdated: z.number(),
  }),
});
export type ImportApplyResult = z.infer<typeof ImportApplyResultSchema>;

export const FilePickerResultSchema = z.object({
  canceled: z.boolean(),
  filePath: z.string().nullable(),
});
export type FilePickerResult = z.infer<typeof FilePickerResultSchema>;
