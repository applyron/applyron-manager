import { useCallback, useEffect, useRef } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toast } from '@/components/ui/use-toast';
import { ipc } from '@/ipc/manager';
import i18n from '@/localization/i18n';
import { AppConfig } from '@/types/config';
import { getLocalizedErrorMessage } from '@/utils/errorMessages';

const SAVE_DEBOUNCE_MS = 400;

export function useAppConfig() {
  const queryClient = useQueryClient();
  const translateError = i18n.t.bind(i18n) as Parameters<typeof getLocalizedErrorMessage>[1];

  const {
    data: config,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['appConfig'],
    queryFn: async () => {
      return ipc.client.config.load();
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const updateConfig = useMutation({
    mutationFn: async (newConfig: AppConfig) => {
      await ipc.client.config.save(newConfig);
      return newConfig;
    },
  });

  const latestConfigRef = useRef<AppConfig | null>(null);
  const lastStableConfigRef = useRef<AppConfig | null>(null);
  const pendingResolversRef = useRef<
    Array<{ resolve: () => void; reject: (error: Error) => void }>
  >([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (config) {
      lastStableConfigRef.current = config;
    }
  }, [config]);

  const flushPendingSave = useCallback(async () => {
    const pendingBatch = pendingResolversRef.current.splice(0);
    const nextConfig = latestConfigRef.current;
    if (!nextConfig) {
      for (const item of pendingBatch) {
        item.resolve();
      }
      return;
    }

    try {
      const savedConfig = await updateConfig.mutateAsync(nextConfig);
      queryClient.setQueryData(['appConfig'], savedConfig);
      lastStableConfigRef.current = savedConfig;
      toast({
        title: i18n.t('settings.notifications.saved.title'),
        description: i18n.t('settings.notifications.saved.description'),
      });
      for (const item of pendingBatch) {
        item.resolve();
      }
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error(i18n.t('settings.notifications.saveError.fallback'));
      const fallback = lastStableConfigRef.current;
      if (fallback) {
        queryClient.setQueryData(['appConfig'], fallback);
      } else {
        queryClient.invalidateQueries({ queryKey: ['appConfig'] });
      }
      toast({
        title: i18n.t('settings.notifications.saveError.title'),
        description: getLocalizedErrorMessage(error, translateError, {
          fallbackKey: 'settings.notifications.saveError.fallback',
        }),
        variant: 'destructive',
      });
      for (const item of pendingBatch) {
        item.reject(error);
      }
    }
  }, [queryClient, translateError, updateConfig]);

  const saveConfig = useCallback(
    (newConfig: AppConfig) => {
      latestConfigRef.current = newConfig;
      queryClient.setQueryData(['appConfig'], newConfig);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      return new Promise<void>((resolve, reject) => {
        pendingResolversRef.current.push({ resolve, reject });
        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null;
          flushPendingSave();
        }, SAVE_DEBOUNCE_MS);
      });
    },
    [flushPendingSave, queryClient],
  );

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!debounceTimerRef.current) {
        return;
      }
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      void flushPendingSave();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      handleBeforeUnload();
    };
  }, [flushPendingSave]);

  return {
    config,
    isLoading,
    error,
    saveConfig,
    isSaving: updateConfig.isPending,
  };
}
