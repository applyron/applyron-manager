import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, LogIn, RefreshCw, SquareArrowOutUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { getLocalizedErrorMessage } from '@/utils/errorMessages';
import { cn } from '@/lib/utils';
import {
  getCodexRemainingRequestPercent,
  getCodexWindowKind,
  normalizeCodexAgentMode,
  normalizeCodexServiceTier,
  prettifyCodexValue,
} from '@/managedIde/codexMetadata';
import type {
  ManagedIdeAvailabilityReason,
  ManagedIdeCurrentStatus,
  ManagedIdeQuotaSnapshot,
  ManagedIdeSessionSnapshot,
} from '@/managedIde/types';
import {
  useOpenManagedIde,
  useOpenManagedIdeLoginGuidance,
  useRefreshManagedIdeStatus,
} from '@/hooks/useManagedIde';

interface ManagedIdeStatusPanelProps {
  status: ManagedIdeCurrentStatus;
  showOverviewHeader?: boolean;
  showActions?: boolean;
}

function formatTimestamp(timestamp: number | null | undefined, locale: string): string {
  if (!timestamp) {
    return '—';
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

function getAvailabilityTone(reason: ManagedIdeAvailabilityReason): string {
  if (reason === 'ready') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  }

  if (reason === 'app_server_unavailable') {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  }

  return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
}

function getSessionTone(state: ManagedIdeSessionSnapshot['state']): string {
  if (state === 'ready') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  }

  if (state === 'requires_login') {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  }

  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

function QuotaMetric({
  label,
  value,
  windowDurationMins,
  resetLabel,
}: {
  label: string;
  value: ManagedIdeQuotaSnapshot['primary'];
  windowDurationMins: number | null | undefined;
  resetLabel: string;
}) {
  const remaining = getCodexRemainingRequestPercent(value?.usedPercent);

  return (
    <div className="rounded-lg border p-3">
      <div className="text-muted-foreground text-xs font-medium uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold">
        {remaining !== null ? `${remaining}%` : '—'}
      </div>
      <div className="text-muted-foreground mt-1 text-xs">
        {windowDurationMins === 300 ? '5h' : windowDurationMins === 10080 ? '7d' : '—'} {resetLabel}
        :{' '}
        {value?.resetsAt
          ? new Intl.DateTimeFormat(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(value.resetsAt)
          : '—'}
      </div>
    </div>
  );
}

export function ManagedIdeStatusPanel({
  status,
  showOverviewHeader = true,
  showActions = true,
}: ManagedIdeStatusPanelProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const refreshMutation = useRefreshManagedIdeStatus(status.targetId);
  const openIdeMutation = useOpenManagedIde(status.targetId);
  const openLoginMutation = useOpenManagedIdeLoginGuidance(status.targetId);
  const serviceTierLabel = useMemo(() => {
    const normalized = normalizeCodexServiceTier(status.session.serviceTier);
    if (normalized === 'fast') {
      return t('cloud.codex.values.serviceTier.fast');
    }
    if (normalized === 'flex') {
      return t('cloud.codex.values.serviceTier.flex');
    }
    if (normalized === 'priority') {
      return t('cloud.codex.values.serviceTier.priority');
    }
    if (normalized === 'standard') {
      return t('cloud.codex.values.serviceTier.standard');
    }
    return prettifyCodexValue(normalized) || t('managedIde.empty.unknown');
  }, [status.session.serviceTier, t]);
  const agentModeLabel = useMemo(() => {
    const normalized = normalizeCodexAgentMode(status.session.agentMode);
    if (normalized === 'full-access') {
      return t('cloud.codex.values.agentMode.fullAccess');
    }
    if (normalized === 'read-only') {
      return t('cloud.codex.values.agentMode.readOnly');
    }
    if (normalized === 'workspace-write') {
      return t('cloud.codex.values.agentMode.workspaceWrite');
    }
    if (normalized === 'danger-full-access') {
      return t('cloud.codex.values.agentMode.dangerFullAccess');
    }
    return prettifyCodexValue(normalized) || t('managedIde.empty.unknown');
  }, [status.session.agentMode, t]);

  const limitEntries = useMemo(
    () => Object.entries(status.quotaByLimitId ?? {}),
    [status.quotaByLimitId],
  );

  const handleRefresh = () => {
    refreshMutation.mutate(undefined, {
      onError: (error) => {
        toast({
          title: t('managedIde.toast.refreshFailedTitle'),
          description: getLocalizedErrorMessage(error, t),
          variant: 'destructive',
        });
      },
    });
  };

  const handleOpenIde = () => {
    openIdeMutation.mutate(undefined, {
      onError: (error) => {
        toast({
          title: t('managedIde.toast.openIdeFailedTitle'),
          description: getLocalizedErrorMessage(error, t),
          variant: 'destructive',
        });
      },
    });
  };

  const handleOpenLogin = () => {
    openLoginMutation.mutate(undefined, {
      onError: (error) => {
        toast({
          title: t('managedIde.toast.openLoginFailedTitle'),
          description: getLocalizedErrorMessage(error, t),
          variant: 'destructive',
        });
      },
    });
  };

  return (
    <div className="space-y-5 pb-20" data-testid="managed-ide-status-panel">
      <Card>
        {showOverviewHeader || showActions ? (
          <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              {showOverviewHeader ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{t('managedIde.title')}</CardTitle>
                    <Badge
                      className={cn('border-0', getAvailabilityTone(status.installation.reason))}
                    >
                      {t(`managedIde.availability.${status.installation.reason}`)}
                    </Badge>
                    {status.fromCache ? (
                      <Badge variant="secondary">{t('managedIde.badges.cached')}</Badge>
                    ) : null}
                  </div>
                  <CardDescription>{t('managedIde.description')}</CardDescription>
                </>
              ) : null}
            </div>

            {showActions ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={handleRefresh}
                  disabled={refreshMutation.isPending}
                  data-testid="managed-ide-refresh"
                >
                  {refreshMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  {t('managedIde.actions.refresh')}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleOpenIde}
                  disabled={openIdeMutation.isPending || !status.installation.idePath}
                  data-testid="managed-ide-open-ide"
                >
                  {openIdeMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <SquareArrowOutUpRight className="mr-2 h-4 w-4" />
                  )}
                  {t('managedIde.actions.openIde')}
                </Button>
                <Button
                  onClick={handleOpenLogin}
                  disabled={openLoginMutation.isPending || !status.installation.idePath}
                  data-testid="managed-ide-open-login"
                >
                  {openLoginMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LogIn className="mr-2 h-4 w-4" />
                  )}
                  {t('managedIde.actions.openLogin')}
                </Button>
              </div>
            ) : null}
          </CardHeader>
        ) : null}
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border p-4">
              <div className="text-muted-foreground text-xs font-medium uppercase">
                {t('managedIde.labels.installation')}
              </div>
              <div className="mt-2 text-base font-semibold">
                {status.installation.available
                  ? t('managedIde.installation.ready')
                  : t('managedIde.installation.needsAttention')}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                {t(`managedIde.availability.${status.installation.reason}`)}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="text-muted-foreground text-xs font-medium uppercase">
                {t('managedIde.labels.session')}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Badge className={cn('border-0', getSessionTone(status.session.state))}>
                  {t(`managedIde.session.${status.session.state}`)}
                </Badge>
                {status.isProcessRunning ? (
                  <Badge variant="secondary">{t('managedIde.badges.running')}</Badge>
                ) : null}
              </div>
              <div className="text-muted-foreground mt-2 text-xs">
                {status.session.email || t('managedIde.empty.noAccount')}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="text-muted-foreground text-xs font-medium uppercase">
                {t('managedIde.labels.plan')}
              </div>
              <div className="mt-2 text-base font-semibold">
                {status.session.planType || t('managedIde.empty.unknown')}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                {t('managedIde.labels.serviceTier')}:&nbsp;
                {serviceTierLabel}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="text-muted-foreground text-xs font-medium uppercase">
                {t('managedIde.labels.agentMode')}
              </div>
              <div className="mt-2 text-base font-semibold">{agentModeLabel}</div>
              <div className="text-muted-foreground mt-1 text-xs">
                {t('managedIde.labels.lastUpdated')}:{' '}
                {formatTimestamp(status.lastUpdatedAt, i18n.language)}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">{t('managedIde.sections.installation')}</CardTitle>
                <CardDescription>
                  {t('managedIde.sections.installationDescription')}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">{t('managedIde.labels.ideVersion')}</span>
                  <span className="text-right font-medium">
                    {status.installation.ideVersion || t('managedIde.empty.unknown')}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">
                    {t('managedIde.labels.extensionVersion')}
                  </span>
                  <span className="text-right font-medium">
                    {status.installation.extensionVersion || t('managedIde.empty.unknown')}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">{t('managedIde.labels.idePath')}</span>
                  <span className="max-w-[60%] text-right font-medium break-all">
                    {status.installation.idePath || t('managedIde.empty.unavailable')}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">
                    {t('managedIde.labels.extensionPath')}
                  </span>
                  <span className="max-w-[60%] text-right font-medium break-all">
                    {status.installation.extensionPath || t('managedIde.empty.unavailable')}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">{t('managedIde.sections.session')}</CardTitle>
                <CardDescription>{t('managedIde.sections.sessionDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">
                    {t('managedIde.labels.accountType')}
                  </span>
                  <span className="font-medium">
                    {status.session.accountType || t('managedIde.empty.unknown')}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">{t('managedIde.labels.authMode')}</span>
                  <span className="font-medium">
                    {status.session.authMode || t('managedIde.empty.unknown')}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">
                    {t('managedIde.labels.requiresOpenaiAuth')}
                  </span>
                  <span className="font-medium">
                    {status.session.requiresOpenaiAuth
                      ? t('managedIde.values.yes')
                      : t('managedIde.values.no')}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">
                    {t('managedIde.labels.lastUpdated')}
                  </span>
                  <span className="font-medium">
                    {formatTimestamp(status.session.lastUpdatedAt, i18n.language)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('managedIde.sections.quota')}</CardTitle>
              <CardDescription>{t('managedIde.sections.quotaDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {status.quota ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <QuotaMetric
                    label={`${t('cloud.codex.remainingRequests')} · ${t(`cloud.codex.windows.${getCodexWindowKind(status.quota.primary?.windowDurationMins)}`)}`}
                    value={status.quota.primary}
                    windowDurationMins={status.quota.primary?.windowDurationMins}
                    resetLabel={t('managedIde.labels.resetsAt')}
                  />
                  <QuotaMetric
                    label={`${t('cloud.codex.remainingRequests')} · ${t(`cloud.codex.windows.${getCodexWindowKind(status.quota.secondary?.windowDurationMins)}`)}`}
                    value={status.quota.secondary}
                    windowDurationMins={status.quota.secondary?.windowDurationMins}
                    resetLabel={t('managedIde.labels.resetsAt')}
                  />
                  <div className="rounded-lg border p-3">
                    <div className="text-muted-foreground text-xs font-medium uppercase">
                      {t('managedIde.labels.credits')}
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {status.quota.credits?.unlimited
                        ? t('managedIde.values.unlimited')
                        : status.quota.credits?.balance || '—'}
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {status.quota.credits?.hasCredits
                        ? t('managedIde.values.creditsAvailable')
                        : t('managedIde.values.noCredits')}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-muted-foreground text-xs font-medium uppercase">
                      {t('managedIde.labels.limitName')}
                    </div>
                    <div className="mt-1 text-base font-semibold">
                      {status.quota.limitName || t('managedIde.empty.unknown')}
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {status.quota.limitId || t('managedIde.empty.unknown')}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
                  {t('managedIde.empty.noQuota')}
                </div>
              )}

              {limitEntries.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium">
                    {t('managedIde.labels.additionalLimits')}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {limitEntries.map(([limitId, limitSnapshot]) => (
                      <div key={limitId} className="rounded-lg border p-3 text-sm">
                        <div className="font-medium">
                          {limitSnapshot.limitName || t('managedIde.empty.unknown')}
                        </div>
                        <div className="text-muted-foreground mt-1 text-xs break-all">
                          {limitId}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className="text-muted-foreground">
                              {t('managedIde.labels.primaryWindow')}
                            </div>
                            <div className="font-medium">
                              {getCodexRemainingRequestPercent(
                                limitSnapshot.primary?.usedPercent,
                              ) !== null
                                ? `${getCodexRemainingRequestPercent(limitSnapshot.primary?.usedPercent)}%`
                                : '—'}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">
                              {t('managedIde.labels.secondaryWindow')}
                            </div>
                            <div className="font-medium">
                              {getCodexRemainingRequestPercent(
                                limitSnapshot.secondary?.usedPercent,
                              ) !== null
                                ? `${getCodexRemainingRequestPercent(limitSnapshot.secondary?.usedPercent)}%`
                                : '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}
