import { getUpdateStatus } from '@/actions/app';
import type { AppUpdateStatus } from '@/types/dashboard';
import { useQuery } from '@tanstack/react-query';

export const APP_UPDATE_STATUS_QUERY_KEY = ['app', 'update-status'] as const;
const APP_UPDATE_STATUS_STALE_TIME_MS = 5_000;
const APP_UPDATE_STATUS_OWNER_REFETCH_MS = 15_000;

export function useAppUpdateStatus(options: { owner?: boolean } = {}) {
  const { owner = false } = options;

  return useQuery<AppUpdateStatus>({
    queryKey: APP_UPDATE_STATUS_QUERY_KEY,
    queryFn: getUpdateStatus,
    staleTime: APP_UPDATE_STATUS_STALE_TIME_MS,
    refetchInterval: owner ? APP_UPDATE_STATUS_OWNER_REFETCH_MS : false,
    refetchOnMount: owner,
    enabled: owner,
  });
}
