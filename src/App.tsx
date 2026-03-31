import React, { useEffect, useState } from 'react';
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

function PrivacyConsentGate(props: {
  isSaving: boolean;
  onDecision: (enabled: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.14),transparent_44%),linear-gradient(180deg,var(--background),var(--muted)/30)] px-6 py-10">
      <div className="bg-background/95 w-full max-w-2xl rounded-3xl border p-8 shadow-2xl backdrop-blur">
        <div className="space-y-3">
          <div className="text-xs font-semibold tracking-[0.24em] text-sky-600 uppercase">
            {t('consent.eyebrow', 'Privacy Setup')}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t('consent.title', 'Choose whether to enable anonymous error reports')}
          </h1>
          <p className="text-muted-foreground text-sm leading-6">
            {t(
              'consent.description',
              'Applyron Manager keeps anonymous error reporting disabled until you make a decision. You can change this later from Settings.',
            )}
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              void props.onDecision(true);
            }}
            disabled={props.isSaving}
            className="rounded-2xl border border-emerald-500/35 bg-emerald-500/8 p-5 text-left transition hover:border-emerald-500/60 hover:bg-emerald-500/12 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="text-foreground text-sm font-semibold">
              {t('consent.enableTitle', 'Enable anonymous error reports')}
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-5">
              {t(
                'consent.enableDescription',
                'Share crash and startup failures without personal content so we can fix production issues faster.',
              )}
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              void props.onDecision(false);
            }}
            disabled={props.isSaving}
            className="border-border bg-muted/35 hover:border-border/80 hover:bg-muted/55 rounded-2xl border p-5 text-left transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="text-foreground text-sm font-semibold">
              {t('consent.disableTitle', 'Keep error reporting off')}
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-5">
              {t(
                'consent.disableDescription',
                'The app will continue to work normally, but no anonymous crash reports will be sent.',
              )}
            </p>
          </button>
        </div>

        <div className="bg-muted/25 text-muted-foreground mt-6 flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-xs">
          <span>
            {t(
              'consent.footer',
              'You can close the window instead. The main application remains blocked until a choice is saved.',
            )}
          </span>
          {props.isSaving ? (
            <div className="text-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('consent.saving', 'Saving')}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function App() {
  const { i18n, t } = useTranslation();
  const { config, isLoading, saveConfig } = useAppConfig();
  const [isSavingConsent, setIsSavingConsent] = useState(false);
  const hasPrivacyConsent = Boolean(config?.privacy_consent_asked || window.electronTest);

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

  const handleConsentDecision = async (enabled: boolean) => {
    if (!config) {
      return;
    }

    setIsSavingConsent(true);
    try {
      await saveConfig({
        ...config,
        privacy_consent_asked: true,
        error_reporting_enabled: enabled,
      });
    } finally {
      setIsSavingConsent(false);
    }
  };

  useEffect(() => {
    const currentConfig = config;

    if (!currentConfig || !hasPrivacyConsent) {
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
  }, [config, hasPrivacyConsent, saveConfig, t]);

  if (isLoading || !config) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!hasPrivacyConsent) {
    return <PrivacyConsentGate isSaving={isSavingConsent} onDecision={handleConsentDecision} />;
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
