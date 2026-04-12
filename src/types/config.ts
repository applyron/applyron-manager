import { z } from 'zod';

export const UpstreamProxyConfigSchema = z.object({
  enabled: z.boolean(),
  url: z.string(),
});

export const LEGACY_DEFAULT_PROJECT_ID = 'silver-orbit-5m7qc';
export type GridLayout = '2-col' | 'list';
export type LegacyGridLayout = GridLayout | 'auto' | '3-col';

export function normalizeGridLayout(layout?: string | null): GridLayout {
  return layout === 'list' ? 'list' : '2-col';
}

const GridLayoutSchema = z.preprocess(
  (value) => {
    if (typeof value === 'string') {
      return normalizeGridLayout(value);
    }

    return value;
  },
  z.enum(['2-col', 'list']).default('2-col'),
);

export const ProxyConfigSchema = z.object({
  enabled: z.boolean(),
  port: z.number(),
  api_key: z.string(),
  auto_start: z.boolean(),
  backend_canary_enabled: z.boolean().default(true),
  parity_enabled: z.boolean().default(false),
  parity_shadow_enabled: z.boolean().default(false),
  parity_kill_switch: z.boolean().default(false),
  parity_no_go_mismatch_rate: z.number().default(0.15),
  parity_no_go_error_rate: z.number().default(0.4),
  scheduling_mode: z.enum(['cache-first', 'balance', 'performance-first']).default('balance'),
  max_wait_seconds: z.number().default(60),
  preferred_account_id: z.string().default(''),
  default_project_id: z.string().default(LEGACY_DEFAULT_PROJECT_ID),
  circuit_breaker_enabled: z.boolean().default(true),
  circuit_breaker_backoff_steps: z.array(z.number()).default([60, 300, 1800, 7200]),
  custom_mapping: z.record(z.string(), z.string()).default({}),
  anthropic_mapping: z.record(z.string(), z.string()), // Mapping table
  request_timeout: z.number().default(120), // Timeout in seconds
  upstream_proxy: UpstreamProxyConfigSchema,
});

const CodexPendingRuntimeApplySchema = z
  .object({
    runtimeId: z.enum(['windows-local', 'wsl-remote']),
    recordId: z.string().min(1).optional(),
  })
  .transform((value) =>
    value.recordId
      ? {
          runtimeId: value.runtimeId,
          recordId: value.recordId,
        }
      : null,
  )
  .nullable()
  .default(null);

export const AppConfigSchema = z.object({
  language: z.string(),
  theme: z.string(),
  managed_ide_target: z.enum(['antigravity', 'vscode-codex']).default('antigravity'),
  codex_runtime_override: z.enum(['windows-local', 'wsl-remote']).nullable().default(null),
  codex_pending_runtime_apply: CodexPendingRuntimeApplySchema,
  auto_startup: z.boolean(),
  default_export_path: z.string().nullable().optional(), // Export path
  model_visibility: z.record(z.string(), z.boolean()).default({}), // Model visibility preferences
  provider_groupings_enabled: z.boolean().default(false), // Enable provider groupings UI
  grid_layout: GridLayoutSchema, // Account card grid layout
  codex_auto_switch_enabled: z.boolean().default(false),
  proxy: ProxyConfigSchema,
});

export type UpstreamProxyConfig = z.infer<typeof UpstreamProxyConfigSchema>;
export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const DEFAULT_APP_CONFIG: AppConfig = {
  language: 'tr',
  theme: 'system',
  managed_ide_target: 'antigravity',
  codex_runtime_override: null,
  codex_pending_runtime_apply: null,
  auto_startup: false,
  default_export_path: null,
  model_visibility: {}, // Model visibility preferences
  provider_groupings_enabled: false, // Enable provider groupings UI
  grid_layout: '2-col' as const, // Account card grid layout
  codex_auto_switch_enabled: false,
  proxy: {
    enabled: false,
    port: 8045,
    api_key: '', // Generated dynamically if default needed
    auto_start: false,
    backend_canary_enabled: true,
    parity_enabled: false,
    parity_shadow_enabled: false,
    parity_kill_switch: false,
    parity_no_go_mismatch_rate: 0.15,
    parity_no_go_error_rate: 0.4,
    scheduling_mode: 'balance',
    max_wait_seconds: 60,
    preferred_account_id: '',
    default_project_id: LEGACY_DEFAULT_PROJECT_ID,
    circuit_breaker_enabled: true,
    circuit_breaker_backoff_steps: [60, 300, 1800, 7200],
    custom_mapping: {},
    anthropic_mapping: {},
    request_timeout: 120,
    upstream_proxy: {
      enabled: false,
      url: '',
    },
  },
};
