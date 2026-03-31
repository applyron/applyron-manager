import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { syncWithLocalTheme } from './actions/theme';
import { setAppLanguage, updateAppLanguage } from './actions/language';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/components/ui/use-toast';
import { LOCAL_STORAGE_KEYS } from '@/constants';
import { useAppConfig } from '@/hooks/useAppConfig';
import { ipc } from '@/ipc/manager';
import { getLocalizedErrorMessage } from '@/utils/errorMessages';
import {
  bindAppShortcuts,
  dispatchAppShortcutEvent,
  APP_SHORTCUT_EVENTS,
} from '@/utils/appShortcuts';
import './localization/i18n';
import { router } from './utils/routes';

export function App() {
  const { i18n, t } = useTranslation();
  const { config, isLoading, saveConfig } = useAppConfig();

  useEffect(() => {
    syncWithLocalTheme();
  }, []);

  useEffect(() => {
    let active = true;

    const storedLanguage = localStorage.getItem(LOCAL_STORAGE_KEYS.LANGUAGE);
    if (!storedLanguage) {
      if (!config) {
        return () => {
          active = false;
        };
      }

      if (active) {
        setAppLanguage(config.language || 'tr', i18n);
      }
    } else {
      updateAppLanguage(i18n);
      if (window.electron?.changeLanguage) {
        window.electron.changeLanguage(i18n.language);
      }
    }

    return () => {
      active = false;
    };
  }, [config, i18n]);

  useEffect(() => {
    const currentConfig = config;

    if (!currentConfig) {
      return;
    }

    const cleanup = bindAppShortcuts(window, {
      getPathname: () => router.state.location.pathname,
      getManagedIdeTarget: () => currentConfig.managed_ide_target,
      navigate: (to) => {
        void router.navigate({ to });
      },
      reload: () => {
        window.location.reload();
      },
      toggleProxy: async () => {
        const currentStatus = await ipc.client.gateway
          .status()
          .catch(() => ({ running: currentConfig.proxy.enabled }));
        const nextEnabled = !currentStatus.running;

        try {
          if (currentStatus.running) {
            await ipc.client.gateway.stop();
          } else {
            await ipc.client.gateway.start({ port: currentConfig.proxy.port });
          }

          dispatchAppShortcutEvent(APP_SHORTCUT_EVENTS.proxyStatusChanged, {
            enabled: nextEnabled,
            errorMessage: null,
          });

          try {
            await saveConfig({
              ...currentConfig,
              proxy: {
                ...currentConfig.proxy,
                enabled: nextEnabled,
              },
            });
          } catch {
            // useAppConfig already emits a localized save failure toast.
          }

          toast({
            title: nextEnabled ? t('proxy.toast.started') : t('proxy.toast.stopped'),
          });
        } catch (error) {
          console.error(error);
          const description = getLocalizedErrorMessage(error, t, {
            fallbackKey: 'proxy.errors.toggleFailed',
          });
          dispatchAppShortcutEvent(APP_SHORTCUT_EVENTS.proxyStatusChanged, {
            enabled: currentStatus.running,
            errorMessage: description,
          });
          toast({
            title: t('proxy.toast.toggleFailed'),
            description,
            variant: 'destructive',
          });
        }
      },
      refreshGeminiAccounts: () => {
        dispatchAppShortcutEvent(APP_SHORTCUT_EVENTS.refreshGeminiAccounts);
      },
      refreshCodexAccounts: () => {
        dispatchAppShortcutEvent(APP_SHORTCUT_EVENTS.refreshCodexAccounts);
      },
    });

    return cleanup;
  }, [config, saveConfig, t]);

  if (isLoading || !config) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  return <RouterProvider router={router} />;
}

const queryClient = new QueryClient();

const rootElement = document.getElementById('app');

if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider storageKey={LOCAL_STORAGE_KEYS.THEME} defaultTheme="system">
          <App />
          <Toaster />
        </ThemeProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
