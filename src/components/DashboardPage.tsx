import {
  checkForUpdatesManual,
  getDashboardAnnouncements,
  getServiceHealthSummary,
  installDownloadedUpdate,
} from '@/actions/app';
import { openExternalUrl } from '@/actions/system';
import { ActiveAccountsSection } from '@/components/dashboard/ActiveAccountsSection';
import { DashboardHeroCard } from '@/components/dashboard/DashboardHeroCard';
import {
  buildClassicAccountSummary,
  buildCodexAccountSummary,
  getAnnouncementLevelLabel,
  getUpdateStatusMeta,
} from '@/components/dashboard/helpers';
import type { LocalizedAnnouncementItem } from '@/components/dashboard/types';
import { useToast } from '@/components/ui/use-toast';
import { useAppConfig } from '@/hooks/useAppConfig';
import { APP_UPDATE_STATUS_QUERY_KEY, useAppUpdateStatus } from '@/hooks/useAppUpdateStatus';
import { useCloudAccounts } from '@/hooks/useCloudAccounts';
import { useCodexAccounts, useManagedIdeStatus } from '@/hooks/useManagedIde';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Sparkles, SquareTerminal, WifiOff } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppUpdateStatus, ServiceHealthSummary } from '@/types/dashboard';
import { getLocalizedErrorMessage } from '@/utils/errorMessages';
import { normalizeAppLanguage } from '@/utils/language';
import { useConnectivityStatus } from '@/hooks/useConnectivityStatus';
import {
  getCanonicalVisibleQuotaModels,
  summarizeCanonicalQuotaModels,
} from '@/utils/cloud-quota-models';
import { resolveLiveCodexAccount } from '@/managedIde/codexAccounts';
import { Button } from '@/components/ui/button';
import { Link } from '@tanstack/react-router';

const SERVICE_HEALTH_QUERY_KEY = ['app', 'service-health'] as const;
const ANNOUNCEMENTS_QUERY_KEY = ['dashboard', 'announcements'] as const;
const surfacedOperationalAlertIds = new Set<string>();

type OperationalAlert = {
  id: string;
  severity: 'critical' | 'warning';
  title: string;
  description: string;
  ctaTo: '/accounts' | '/proxy' | '/settings';
  ctaLabel: string;
};

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { config } = useAppConfig();
  const connectivityStatus = useConnectivityStatus();
  const locale = normalizeAppLanguage(i18n.language, 'en');
  const isOffline = connectivityStatus === 'offline';

  const updateStatusQuery = useAppUpdateStatus();

  const serviceHealthQuery = useQuery({
    queryKey: SERVICE_HEALTH_QUERY_KEY,
    queryFn: getServiceHealthSummary,
    staleTime: 5_000,
    refetchInterval: 15_000,
  });

  const announcementsQuery = useQuery({
    queryKey: ANNOUNCEMENTS_QUERY_KEY,
    queryFn: getDashboardAnnouncements,
    staleTime: 300_000,
    refetchInterval: 900_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const cloudAccountsQuery = useCloudAccounts();
  const codexAccountsQuery = useCodexAccounts();
  const codexStatusQuery = useManagedIdeStatus('vscode-codex', {
    enabled: true,
    refresh: false,
    refetchInterval: false,
  });

  const manualCheckMutation = useMutation({
    mutationFn: checkForUpdatesManual,
    onSuccess: (status) => {
      queryClient.setQueryData(APP_UPDATE_STATUS_QUERY_KEY, status);
    },
    onError: (error) => {
      toast({
        title: t('dashboard.update.title'),
        description: getLocalizedErrorMessage(error, t),
        variant: 'destructive',
      });
    },
  });

  const installUpdateMutation = useMutation({
    mutationFn: installDownloadedUpdate,
    onSuccess: (status) => {
      queryClient.setQueryData(APP_UPDATE_STATUS_QUERY_KEY, status);
    },
    onError: (error) => {
      toast({
        title: t('dashboard.update.title'),
        description: getLocalizedErrorMessage(error, t),
        variant: 'destructive',
      });
    },
  });

  const updateStatus: AppUpdateStatus =
    updateStatusQuery.data ??
    (updateStatusQuery.isError
      ? {
          status: 'error',
          currentVersion: '—',
          latestVersion: null,
          lastCheckedAt: null,
          message: getLocalizedErrorMessage(updateStatusQuery.error, t),
        }
      : {
          status: 'idle',
          currentVersion: '—',
          latestVersion: null,
          lastCheckedAt: null,
          message: null,
        });

  const serviceHealthSummary: ServiceHealthSummary = serviceHealthQuery.data ?? {
    services: [],
    hasErrors: false,
    updatedAt: null,
  };

  const localizedServiceHealthItems = useMemo(
    () =>
      serviceHealthSummary.services.map((item) => ({
        ...item,
        labelText: t(`dashboard.health.services.${item.id}`, { defaultValue: item.label }),
        stateText: t(`dashboard.health.states.${item.state}`),
      })),
    [serviceHealthSummary.services, t],
  );

  const announcementItems = useMemo<LocalizedAnnouncementItem[]>(() => {
    const language = locale === 'tr' ? 'tr' : 'en';
    return (announcementsQuery.data ?? []).map((item) => ({
      ...item,
      titleText: item.title[language],
      bodyText: item.body[language],
      levelLabel: getAnnouncementLevelLabel(item.level, t),
    }));
  }, [announcementsQuery.data, locale, t]);

  const activeClassicAccount = useMemo(() => {
    const visibilitySettings = config?.model_visibility ?? {};
    const selectedAccount = (cloudAccountsQuery.data ?? []).find((account) => account.is_active);
    return selectedAccount
      ? buildClassicAccountSummary(selectedAccount, visibilitySettings, t)
      : null;
  }, [cloudAccountsQuery.data, config?.model_visibility, t]);

  const activeCodexAccount = useMemo(() => {
    const selectedAccount = resolveLiveCodexAccount(
      codexAccountsQuery.data ?? [],
      codexStatusQuery.data?.liveAccountIdentityKey,
    );
    return selectedAccount ? buildCodexAccountSummary(selectedAccount, t) : null;
  }, [codexAccountsQuery.data, codexStatusQuery.data?.liveAccountIdentityKey, t]);

  const announcementTickerKey = useMemo(
    () => announcementItems.map((item) => `${item.id}:${item.publishedAt}`).join('|'),
    [announcementItems],
  );

  const activeClassicError =
    cloudAccountsQuery.isError && !activeClassicAccount
      ? getLocalizedErrorMessage(cloudAccountsQuery.error, t)
      : null;
  const activeCodexError =
    codexAccountsQuery.isError && !activeCodexAccount
      ? getLocalizedErrorMessage(codexAccountsQuery.error, t)
      : null;
  const isReadyToInstall = updateStatus.status === 'ready_to_install';
  const isUpdateDownloading = updateStatus.status === 'update_available';
  const isCheckingUpdates = updateStatus.status === 'checking' || manualCheckMutation.isPending;
  const updateStatusMeta = getUpdateStatusMeta(updateStatus.status, t);
  const updateButtonLabel = isReadyToInstall
    ? t('dashboard.update.restartButton')
    : isUpdateDownloading
      ? t('dashboard.update.downloadingTitle')
      : t('dashboard.update.checkButton');
  const isUpdateActionPending =
    isCheckingUpdates || isUpdateDownloading || installUpdateMutation.isPending;

  const handleAnnouncementClick = async (url: string) => {
    try {
      await openExternalUrl({ url, intent: 'announcement' });
    } catch (error) {
      toast({
        title: t('dashboard.announcements.title'),
        description: getLocalizedErrorMessage(error, t),
        variant: 'destructive',
      });
    }
  };

  const handleUpdateAction = () => {
    if (isOffline) {
      toast({
        title: t('dashboard.update.title'),
        description: t('error.offline'),
        variant: 'destructive',
      });
      return;
    }

    if (isReadyToInstall) {
      installUpdateMutation.mutate();
      return;
    }

    manualCheckMutation.mutate();
  };

  const operationalAlerts = useMemo<OperationalAlert[]>(() => {
    const alerts: OperationalAlert[] = [];
    const visibilitySettings = config?.model_visibility ?? {};
    const cloudReferenceEpochSeconds =
      cloudAccountsQuery.dataUpdatedAt > 0 ? cloudAccountsQuery.dataUpdatedAt / 1000 : null;

    if (isOffline) {
      alerts.push({
        id: 'offline',
        severity: 'critical',
        title: t('dashboard.operationalAlerts.items.offline.title'),
        description: t('dashboard.operationalAlerts.items.offline.description'),
        ctaTo: '/settings',
        ctaLabel: t('dashboard.operationalAlerts.cta.settings'),
      });
    }

    for (const item of localizedServiceHealthItems) {
      if (item.state !== 'error' && item.state !== 'degraded') {
        continue;
      }

      alerts.push({
        id: `service:${item.id}:${item.state}`,
        severity: item.state === 'error' ? 'critical' : 'warning',
        title: t('dashboard.operationalAlerts.items.service.title', {
          service: item.labelText,
        }),
        description: t('dashboard.operationalAlerts.items.service.description', {
          service: item.labelText,
          state: item.stateText,
          message: item.message || t('dashboard.operationalAlerts.items.service.noMessage'),
        }),
        ctaTo: '/proxy',
        ctaLabel: t('dashboard.operationalAlerts.cta.proxy'),
      });
    }

    const expiringAccount = (cloudAccountsQuery.data ?? []).find((account) => {
      const expirySeconds = account.token?.expiry_timestamp ?? 0;
      return (
        cloudReferenceEpochSeconds !== null &&
        expirySeconds > 0 &&
        expirySeconds - cloudReferenceEpochSeconds < 24 * 60 * 60
      );
    });
    if (expiringAccount) {
      alerts.push({
        id: `cloud-expiring:${expiringAccount.id}`,
        severity: 'warning',
        title: t('dashboard.operationalAlerts.items.cloudTokenExpiring.title'),
        description: t('dashboard.operationalAlerts.items.cloudTokenExpiring.description', {
          identity: expiringAccount.email,
        }),
        ctaTo: '/accounts',
        ctaLabel: t('dashboard.operationalAlerts.cta.accounts'),
      });
    }

    const expiredAccount = (cloudAccountsQuery.data ?? []).find(
      (account) => account.status === 'expired',
    );
    if (expiredAccount) {
      alerts.push({
        id: `cloud-expired:${expiredAccount.id}`,
        severity: 'critical',
        title: t('dashboard.operationalAlerts.items.cloudExpired.title'),
        description: t('dashboard.operationalAlerts.items.cloudExpired.description', {
          identity: expiredAccount.email,
        }),
        ctaTo: '/accounts',
        ctaLabel: t('dashboard.operationalAlerts.cta.accounts'),
      });
    }

    const accountsWithQuota = (cloudAccountsQuery.data ?? []).filter(
      (account) => Object.keys(account.quota?.models ?? {}).length > 0,
    );
    if (
      accountsWithQuota.length > 0 &&
      accountsWithQuota.every((account) => {
        const summary = summarizeCanonicalQuotaModels(
          getCanonicalVisibleQuotaModels(account.quota?.models, visibilitySettings),
        );
        return summary.overallPercentage !== null && summary.overallPercentage < 10;
      })
    ) {
      alerts.push({
        id: 'cloud-low-quota',
        severity: 'warning',
        title: t('dashboard.operationalAlerts.items.lowQuota.title'),
        description: t('dashboard.operationalAlerts.items.lowQuota.description'),
        ctaTo: '/accounts',
        ctaLabel: t('dashboard.operationalAlerts.cta.accounts'),
      });
    }

    const loginRequiredAccount = (codexAccountsQuery.data ?? []).find(
      (account) => account.snapshot?.session.state === 'requires_login',
    );
    if (loginRequiredAccount) {
      alerts.push({
        id: `codex-login-required:${loginRequiredAccount.id}`,
        severity: 'critical',
        title: t('dashboard.operationalAlerts.items.codexRequiresLogin.title'),
        description: t('dashboard.operationalAlerts.items.codexRequiresLogin.description', {
          identity:
            loginRequiredAccount.label ||
            loginRequiredAccount.email ||
            loginRequiredAccount.accountId,
        }),
        ctaTo: '/accounts',
        ctaLabel: t('dashboard.operationalAlerts.cta.accounts'),
      });
    }

    const codexAccounts = codexAccountsQuery.data ?? [];
    if (
      codexAccounts.length > 0 &&
      codexAccounts.every((account) => account.snapshot?.session.state !== 'ready')
    ) {
      alerts.push({
        id: 'codex-none-ready',
        severity: 'warning',
        title: t('dashboard.operationalAlerts.items.noReadyCodex.title'),
        description: t('dashboard.operationalAlerts.items.noReadyCodex.description'),
        ctaTo: '/accounts',
        ctaLabel: t('dashboard.operationalAlerts.cta.accounts'),
      });
    }

    return alerts;
  }, [
    cloudAccountsQuery.data,
    cloudAccountsQuery.dataUpdatedAt,
    codexAccountsQuery.data,
    config?.model_visibility,
    isOffline,
    localizedServiceHealthItems,
    t,
  ]);

  useEffect(() => {
    for (const alert of operationalAlerts) {
      if (alert.severity !== 'critical' || surfacedOperationalAlertIds.has(alert.id)) {
        continue;
      }

      surfacedOperationalAlertIds.add(alert.id);
      toast({
        title: alert.title,
        description: alert.description,
        variant: 'destructive',
      });
    }
  }, [operationalAlerts, toast]);

  return (
    <div className="container mx-auto max-w-6xl space-y-5 px-6 py-8">
      <DashboardHeroCard
        eyebrow={t('dashboard.eyebrow')}
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        locale={locale}
        updateKicker={t('dashboard.update.kicker')}
        updateTitle={t('dashboard.update.title')}
        currentVersionLabel={t('dashboard.update.currentVersionLabel')}
        latestVersionLabel={t('dashboard.update.latestVersionLabel')}
        lastCheckedLabel={t('dashboard.update.lastCheckedLabel')}
        updateStatus={updateStatus}
        updateStatusMeta={updateStatusMeta}
        updateButtonLabel={updateButtonLabel}
        isReadyToInstall={isReadyToInstall}
        isUpdateActionPending={isUpdateActionPending}
        isUpdateActionDisabled={isOffline}
        onUpdateAction={handleUpdateAction}
        announcementsTitle={t('dashboard.announcements.kicker')}
        announcementsDescription={t('dashboard.announcements.description')}
        announcementsLoadingText={t('dashboard.announcements.loading')}
        announcementsErrorTitle={t('dashboard.announcements.errorTitle')}
        announcementsErrorDescription={t('dashboard.announcements.errorDescription')}
        announcementsEmptyTitle={t('dashboard.announcements.emptyTitle')}
        announcementsEmptyDescription={t('dashboard.announcements.emptyDescription')}
        announcementsLoading={announcementsQuery.isLoading && !announcementsQuery.data}
        announcementsError={announcementsQuery.isError}
        announcementsEmpty={
          !announcementsQuery.isLoading &&
          !announcementsQuery.isError &&
          announcementItems.length === 0
        }
        announcementItems={announcementItems}
        announcementTickerKey={announcementTickerKey}
        onAnnouncementClick={(url) => void handleAnnouncementClick(url)}
        healthKicker={t('dashboard.health.kicker')}
        healthDescription={t('dashboard.health.description')}
        healthLastUpdatedLabel={t('dashboard.health.lastUpdated')}
        serviceHealthSummary={serviceHealthSummary}
        localizedServiceHealthItems={localizedServiceHealthItems}
      />

      <ActiveAccountsSection
        title={t('dashboard.activeAccounts.kicker')}
        description={t('dashboard.activeAccounts.description')}
        ctaLabel={t('dashboard.activeAccounts.goToAccounts')}
        classicCard={{
          title: t('dashboard.activeAccounts.slots.antigravity'),
          subtitle: t('dashboard.activeAccounts.sources.classic'),
          icon: Sparkles,
          iconClassName: 'text-emerald-500',
          loading: cloudAccountsQuery.isLoading,
          loadingText: t('dashboard.activeAccounts.loading'),
          emptyText: t('dashboard.activeAccounts.emptyClassic'),
          error: Boolean(activeClassicError),
          errorText: activeClassicError ?? undefined,
          account: activeClassicAccount,
        }}
        codexCard={{
          title: t('dashboard.activeAccounts.slots.codex'),
          subtitle: t('dashboard.activeAccounts.sources.codex'),
          icon: SquareTerminal,
          iconClassName: 'text-sky-500',
          loading: codexAccountsQuery.isLoading,
          loadingText: t('dashboard.activeAccounts.loading'),
          emptyText: t('dashboard.activeAccounts.emptyCodex'),
          error: Boolean(activeCodexError),
          errorText: activeCodexError ?? undefined,
          account: activeCodexAccount,
        }}
      />

      <section
        className="rounded-[24px] border px-6 py-6"
        data-testid="dashboard-operational-alerts"
        style={{
          background: 'linear-gradient(180deg, var(--hud-panel), var(--hud-panel-alt))',
          borderColor: 'var(--hud-border-soft)',
          boxShadow: 'var(--hud-shadow)',
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div
              className="text-[10px] font-bold tracking-[0.2em] text-[var(--hud-text-subtle)] uppercase"
              style={{ fontFamily: 'Tomorrow, sans-serif' }}
            >
              {t('dashboard.operationalAlerts.kicker')}
            </div>
            <div className="text-muted-foreground mt-2 text-sm">
              {t('dashboard.operationalAlerts.description')}
            </div>
          </div>
        </div>

        {operationalAlerts.length === 0 ? (
          <div
            className="mt-5 rounded-[18px] border border-dashed px-4 py-5"
            style={{
              background: 'var(--hud-panel-elevated)',
              borderColor: 'var(--hud-border-soft)',
            }}
          >
            <div className="text-foreground text-sm font-semibold">
              {t('dashboard.operationalAlerts.emptyTitle')}
            </div>
            <div className="text-muted-foreground mt-2 text-sm">
              {t('dashboard.operationalAlerts.emptyDescription')}
            </div>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {operationalAlerts.map((alert) => {
              const isCritical = alert.severity === 'critical';
              return (
                <div
                  key={alert.id}
                  className="rounded-[18px] border px-4 py-4"
                  style={{
                    background: isCritical
                      ? 'var(--hud-danger-soft-bg)'
                      : 'var(--hud-warning-soft-bg)',
                    borderColor: isCritical
                      ? 'var(--hud-danger-soft-border)'
                      : 'var(--hud-warning-soft-border)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border"
                      style={{
                        background: isCritical
                          ? 'var(--hud-danger-soft-bg)'
                          : 'var(--hud-warning-soft-bg)',
                        borderColor: isCritical
                          ? 'var(--hud-danger-soft-border)'
                          : 'var(--hud-warning-soft-border)',
                        color: isCritical ? 'var(--hud-danger)' : 'var(--hud-warning)',
                      }}
                    >
                      {alert.id === 'offline' ? (
                        <WifiOff className="h-4 w-4" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-foreground text-sm font-semibold">{alert.title}</div>
                      <div className="text-muted-foreground mt-2 text-sm leading-6">
                        {alert.description}
                      </div>
                      <Button asChild size="sm" variant="outline" className="mt-4">
                        <Link to={alert.ctaTo}>{alert.ctaLabel}</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
