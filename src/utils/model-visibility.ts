import type { CloudAccount } from '@/types/cloudAccount';
import { isSupportedQuotaModelId } from '@/utils/cloud-quota-models';

export interface ModelVisibilityStats {
  totalCount: number;
  visibleCount: number;
  hiddenCount: number;
}

export function collectAvailableModelIds(accounts: CloudAccount[] | undefined): string[] {
  if (!accounts) {
    return [];
  }

  const modelIds = new Set<string>();

  for (const account of accounts) {
    for (const modelId of Object.keys(account.quota?.models ?? {})) {
      if (isSupportedQuotaModelId(modelId)) {
        modelIds.add(modelId);
      }
    }
  }

  return [...modelIds].sort();
}

export function summarizeModelVisibility(
  availableModelIds: string[],
  modelVisibilityMap: Record<string, boolean>,
): ModelVisibilityStats {
  const hiddenCount = availableModelIds.filter(
    (modelId) => modelVisibilityMap[modelId] === false,
  ).length;

  return {
    totalCount: availableModelIds.length,
    visibleCount: availableModelIds.length - hiddenCount,
    hiddenCount,
  };
}
