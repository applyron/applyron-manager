import { useState, useMemo, useCallback } from 'react';

import { useAppConfig } from '@/hooks/useAppConfig';
import { CloudAccount } from '@/types/cloudAccount';
import { getCanonicalVisibleQuotaModels } from '@/utils/cloud-quota-models';
import { groupVisibleModelsByProvider, type AccountStats } from '@/utils/provider-grouping';

export interface UseProviderGroupingResult {
  enabled: boolean;
  getAccountStats: (account: CloudAccount) => AccountStats;
  isProviderCollapsed: (accountId: string, providerKey: string) => boolean;
  toggleProviderCollapse: (accountId: string, providerKey: string) => void;
  isAccountCollapsed: (accountId: string) => boolean;
  toggleAccountCollapse: (accountId: string) => void;
}

export function useProviderGrouping(): UseProviderGroupingResult {
  const { config } = useAppConfig();

  // Collapse state is managed locally per session for responsive toggling.
  // Provider groups default to expanded on each page load.
  const [collapsedProviders, setCollapsedProviders] = useState<Record<string, string[]>>({});
  const [collapsedAccounts, setCollapsedAccounts] = useState<string[]>([]);

  const enabled = config?.provider_groupings_enabled ?? false;
  const visibilitySettings = useMemo(
    () => config?.model_visibility ?? {},
    [config?.model_visibility],
  );

  const getAccountStats = useCallback(
    (account: CloudAccount): AccountStats => {
      const models = getCanonicalVisibleQuotaModels(account.quota?.models, visibilitySettings);
      return groupVisibleModelsByProvider(models);
    },
    [visibilitySettings],
  );

  const isProviderCollapsed = useCallback(
    (accountId: string, providerKey: string): boolean => {
      return collapsedProviders[accountId]?.includes(providerKey) ?? false;
    },
    [collapsedProviders],
  );

  const toggleProviderCollapse = useCallback((accountId: string, providerKey: string): void => {
    setCollapsedProviders((prev) => {
      const accountCollapsed = prev[accountId] ?? [];
      const isCollapsed = accountCollapsed.includes(providerKey);
      return {
        ...prev,
        [accountId]: isCollapsed
          ? accountCollapsed.filter((k) => k !== providerKey)
          : [...accountCollapsed, providerKey],
      };
    });
  }, []);

  const isAccountCollapsed = useCallback(
    (accountId: string): boolean => {
      return collapsedAccounts.includes(accountId);
    },
    [collapsedAccounts],
  );

  const toggleAccountCollapse = useCallback((accountId: string): void => {
    setCollapsedAccounts((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId],
    );
  }, []);

  return useMemo(
    () => ({
      enabled,
      getAccountStats,
      isProviderCollapsed,
      toggleProviderCollapse,
      isAccountCollapsed,
      toggleAccountCollapse,
    }),
    [
      enabled,
      getAccountStats,
      isProviderCollapsed,
      toggleProviderCollapse,
      isAccountCollapsed,
      toggleAccountCollapse,
    ],
  );
}
