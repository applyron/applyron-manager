import type { CloudQuotaData } from '../../../types/cloudAccount';

export interface TokenData {
  email: string;
  account_id: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expiry_timestamp: number;
  project_id?: string;
  session_id?: string;
  upstream_proxy_url?: string;
  quota?: CloudQuotaData;
  model_quotas: Record<string, number>;
  model_limits: Record<string, number>;
  model_reset_times: Record<string, string>;
  model_forwarding_rules: Record<string, string>;
}

export type SchedulingMode = 'cache-first' | 'balance' | 'performance-first';

export interface GetNextTokenOptions {
  sessionKey?: string;
  excludeAccountIds?: string[];
  model?: string;
}

export interface CapacityState {
  reason: string;
  retryAfterSec: number;
}

export type TokenEntry = [string, TokenData];

export function normalizeModelId(modelId: string | null | undefined): string | undefined {
  if (typeof modelId !== 'string') {
    return undefined;
  }

  const normalized = modelId.replace(/^models\//i, '').trim();
  return normalized !== '' ? normalized : undefined;
}
