import {
  useCloudAccounts,
  useRefreshQuota,
  useDeleteCloudAccount,
  useDeleteCloudAccountsBatch,
  useAddGoogleAccount,
  useSwitchCloudAccount,
  useAutoSwitchEnabled,
  useSetAutoSwitchEnabled,
  useForcePollCloudMonitor,
  startAuthFlow,
} from '@/hooks/useCloudAccounts';
import { CloudAccountCard } from '@/components/CloudAccountCard';
import { IdentityProfileDialog } from '@/components/IdentityProfileDialog';
import { CloudAccount } from '@/types/cloudAccount';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Plus,
  Loader2,
  Cloud,
  Zap,
  RefreshCcw,
  CheckSquare,
  Trash2,
  X,
  RefreshCw,
  List,
  Columns2,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useState, useEffect, useRef, useMemo, useCallback, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { getLocalizedErrorMessage } from '@/utils/errorMessages';
import { useAppConfig } from '@/hooks/useAppConfig';
import { useConnectivityStatus } from '@/hooks/useConnectivityStatus';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { filter, flatMap, size } from 'lodash-es';
import { clampQuotaPercentage } from '@/utils/quota-display';
import {
  getCanonicalVisibleQuotaModels,
  summarizeCanonicalQuotaModels,
} from '@/utils/cloud-quota-models';
import { GridLayout, normalizeGridLayout } from '@/types/config';
import { getHudQuotaTone, getHudTone } from '@/utils/hudTone';
import { APP_SHORTCUT_EVENTS } from '@/utils/appShortcuts';

interface CloudAccountListProps {
  showOverviewHeader?: boolean;
}

type VisibleGridLayout = GridLayout;

const GRID_LAYOUT_CLASSES: Record<VisibleGridLayout, string> = {
  '2-col': 'grid gap-6 md:grid-cols-2',
  list: 'grid gap-6 grid-cols-1',
};

function normalizeGoogleAuthCode(value: string): string {
  return value.trim();
}

function StatCard({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string | number;
  valueStyle?: CSSProperties;
}) {
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{
        background: 'var(--hud-panel)',
        borderColor: 'var(--hud-border-soft)',
      }}
    >
      <div className="text-[10px] font-bold tracking-widest text-[var(--hud-text-subtle)] uppercase">
        {label}
      </div>
      <div className="text-foreground mt-1 text-lg font-semibold" style={valueStyle}>
        {value}
      </div>
    </div>
  );
}

export function CloudAccountList({ showOverviewHeader = true }: CloudAccountListProps) {
  const { t } = useTranslation();
  const { data: accounts, isLoading, isError, error, errorUpdatedAt, refetch } = useCloudAccounts();
  const { config, saveConfig } = useAppConfig();
  const refreshMutation = useRefreshQuota();
  const deleteMutation = useDeleteCloudAccount();
  const deleteBatchMutation = useDeleteCloudAccountsBatch();
  const addMutation = useAddGoogleAccount();
  const switchMutation = useSwitchCloudAccount();
  const { data: autoSwitchEnabled, isLoading: isSettingsLoading } = useAutoSwitchEnabled();
  const setAutoSwitchMutation = useSetAutoSwitchEnabled();
  const forcePollMutation = useForcePollCloudMonitor();

  const { toast } = useToast();
  const connectivityStatus = useConnectivityStatus();
  const lastLoadErrorToastAtRef = useRef<number>(0);
  const handledGoogleAuthCodesRef = useRef<Set<string>>(new Set());
  const isOffline = connectivityStatus === 'offline';

  const gridLayout = normalizeGridLayout(config?.grid_layout ?? '2-col');

  const updateGridLayout = async (layout: VisibleGridLayout) => {
    if (config) {
      await saveConfig({ ...config, grid_layout: layout });
    }
  };

  const overallQuotaPercentage = useMemo(() => {
    if (!accounts || accounts.length === 0) {
      return null;
    }

    const visibilitySettings = config?.model_visibility ?? {};
    const canonicalModels = flatMap(accounts, (account) =>
      getCanonicalVisibleQuotaModels(account.quota?.models, visibilitySettings),
    );

    return summarizeCanonicalQuotaModels(canonicalModels).overallPercentage;
  }, [accounts, config?.model_visibility]);

  const overallQuotaTone = getHudTone(
    overallQuotaPercentage === null ? 'danger' : getHudQuotaTone(overallQuotaPercentage),
  );

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [authCode, setAuthCode] = useState('');
  const [authStartError, setAuthStartError] = useState<string | null>(null);
  const [identityAccount, setIdentityAccount] = useState<CloudAccount | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const totalAccounts = size(accounts);
  const activeAccounts = filter(accounts, (account) => account.is_active).length;
  const rateLimitedAccounts = filter(
    accounts,
    (account) => account.status === 'rate_limited',
  ).length;

  const submitAuthCode = useCallback(
    (incomingAuthCode?: string) => {
      const codeToUse = normalizeGoogleAuthCode(incomingAuthCode || authCode);
      if (!codeToUse || addMutation.isPending) {
        return;
      }

      if (handledGoogleAuthCodesRef.current.has(codeToUse)) {
        toast({
          title: t('cloud.toast.addFailed.title'),
          description: t('cloud.errors.authCodeAlreadyUsed'),
          variant: 'destructive',
        });
        return;
      }

      handledGoogleAuthCodesRef.current.add(codeToUse);
      setAuthCode('');

      addMutation.mutate(
        { authCode: codeToUse },
        {
          onSuccess: () => {
            setIsAddDialogOpen(false);
            setAuthCode('');
            handledGoogleAuthCodesRef.current.clear();
            toast({ title: t('cloud.toast.addSuccess') });
          },
          onError: (err) => {
            toast({
              title: t('cloud.toast.addFailed.title'),
              description: getLocalizedErrorMessage(err, t),
              variant: 'destructive',
            });
          },
        },
      );
    },
    [addMutation, authCode, t, toast],
  );

  useEffect(() => {
    if (window.electron?.onGoogleAuthCode) {
      return window.electron.onGoogleAuthCode((code) => {
        setAuthCode(normalizeGoogleAuthCode(code));
      });
    }
  }, []);

  useEffect(() => {
    const normalizedAuthCode = normalizeGoogleAuthCode(authCode);
    if (
      normalizedAuthCode &&
      isAddDialogOpen &&
      !addMutation.isPending &&
      !handledGoogleAuthCodesRef.current.has(normalizedAuthCode)
    ) {
      const timeoutId = window.setTimeout(() => {
        submitAuthCode(normalizedAuthCode);
      }, 0);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }
  }, [addMutation.isPending, authCode, isAddDialogOpen, submitAuthCode]);

  useEffect(() => {
    if (!isError || !errorUpdatedAt || errorUpdatedAt === lastLoadErrorToastAtRef.current) {
      return;
    }

    toast({
      title: t('cloud.error.loadFailed'),
      description: getLocalizedErrorMessage(error, t),
      variant: 'destructive',
    });
    lastLoadErrorToastAtRef.current = errorUpdatedAt;
  }, [error, errorUpdatedAt, isError, t, toast]);

  useEffect(() => {
    const handleShortcutRefresh = () => {
      void refetch();
    };

    window.addEventListener(APP_SHORTCUT_EVENTS.refreshGeminiAccounts, handleShortcutRefresh);
    return () => {
      window.removeEventListener(APP_SHORTCUT_EVENTS.refreshGeminiAccounts, handleShortcutRefresh);
    };
  }, [refetch]);

  const handleRefresh = (id: string) => {
    if (isOffline) {
      toast({
        title: t('cloud.toast.refreshFailed'),
        description: t('error.offline'),
        variant: 'destructive',
      });
      return;
    }

    refreshMutation.mutate(
      { accountId: id },
      {
        onSuccess: () => toast({ title: t('cloud.toast.quotaRefreshed') }),
        onError: () => toast({ title: t('cloud.toast.refreshFailed'), variant: 'destructive' }),
      },
    );
  };

  const handleSwitch = (id: string) => {
    switchMutation.mutate(
      { accountId: id },
      {
        onSuccess: () =>
          toast({
            title: t('cloud.toast.switched.title'),
            description: t('cloud.toast.switched.description'),
          }),
        onError: (err) =>
          toast({
            title: t('cloud.toast.switchFailed'),
            description: getLocalizedErrorMessage(err, t),
            variant: 'destructive',
          }),
      },
    );
  };

  const handleDelete = (id: string) => {
    if (confirm(t('cloud.toast.deleteConfirm'))) {
      deleteMutation.mutate(
        { accountId: id },
        {
          onSuccess: () => {
            toast({ title: t('cloud.toast.deleted') });
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          },
          onError: () => toast({ title: t('cloud.toast.deleteFailed'), variant: 'destructive' }),
        },
      );
    }
  };

  const handleManageIdentity = (id: string) => {
    const target = (accounts || []).find((item) => item.id === id) || null;
    setIdentityAccount(target);
  };

  const handleToggleAutoSwitch = (checked: boolean) => {
    setAutoSwitchMutation.mutate(
      { enabled: checked },
      {
        onSuccess: () =>
          toast({
            title: checked ? t('cloud.toast.autoSwitchOn') : t('cloud.toast.autoSwitchOff'),
          }),
        onError: () =>
          toast({ title: t('cloud.toast.updateSettingsFailed'), variant: 'destructive' }),
      },
    );
  };

  const handleForcePoll = () => {
    if (forcePollMutation.isPending) {
      return;
    }

    if (isOffline) {
      toast({
        title: t('cloud.toast.pollFailed'),
        description: t('error.offline'),
        variant: 'destructive',
      });
      return;
    }

    forcePollMutation.mutate(undefined, {
      onSuccess: () => toast({ title: t('cloud.polling') }),
      onError: (err) =>
        toast({
          title: t('cloud.toast.pollFailed'),
          description: getLocalizedErrorMessage(err, t),
          variant: 'destructive',
        }),
    });
  };

  const openGoogleAuthSignIn = async () => {
    if (isOffline) {
      setAuthStartError(t('error.offline'));
      return;
    }

    try {
      setAuthCode('');
      setAuthStartError(null);
      await startAuthFlow();
    } catch (e) {
      setAuthStartError(
        getLocalizedErrorMessage(e, t, {
          fallbackKey: 'cloud.errors.authFlowStartFailed',
        }),
      );
    }
  };

  const setSelectionState = (id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const toggleSelectAllAccounts = () => {
    if (selectedIds.size === accounts?.length) {
      setSelectedIds(new Set());
      return;
    }

    setSelectedIds(new Set(accounts?.map((account) => account.id) || []));
  };

  const deleteSelectedAccounts = () => {
    if (confirm(t('cloud.batch.confirmDelete', { count: selectedIds.size }))) {
      const accountIds = Array.from(selectedIds);
      deleteBatchMutation.mutate(
        { accountIds },
        {
          onSuccess: (result) => {
            const failedIds = new Set(result.failed.map((entry) => entry.accountId));
            setSelectedIds(failedIds);

            if (result.failed.length === 0) {
              toast({
                title: t('cloud.toast.deleted'),
                description: t('cloud.batch.deleted', { count: result.deletedIds.length }),
              });
              return;
            }

            toast({
              title: t('cloud.batch.partialDeleteTitle'),
              description: t('cloud.batch.resultSummary', {
                deletedCount: result.deletedIds.length,
                failedCount: result.failed.length,
              }),
              variant: 'destructive',
            });
          },
          onError: (err) =>
            toast({
              title: t('cloud.toast.deleteFailed'),
              description: getLocalizedErrorMessage(err, t),
              variant: 'destructive',
            }),
        },
      );
    }
  };

  const renderAddAccountDialog = () => (
    <Dialog
      open={isAddDialogOpen}
      onOpenChange={(nextOpen) => {
        setIsAddDialogOpen(nextOpen);
        if (!nextOpen) {
          setAuthCode('');
          setAuthStartError(null);
          handledGoogleAuthCodesRef.current.clear();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button className="hud-success-cta border-none px-6 font-bold shadow-lg shadow-emerald-500/20 transition-all hover:opacity-90">
          <Plus className="mr-2 h-4 w-4" />
          {t('cloud.connectedIdentities.addNew', t('cloud.addAccount'))}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-[460px]"
        style={{
          background: 'var(--hud-panel)',
          borderColor: 'var(--hud-border-soft)',
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-foreground" style={{ fontFamily: 'Tomorrow, sans-serif' }}>
            {t('cloud.authDialog.title')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('cloud.authDialog.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <Button
            variant="outline"
            className="text-foreground hover:bg-accent/60 hover:text-primary justify-start border-[var(--hud-border-soft)] bg-[var(--hud-input-bg)]"
            onClick={openGoogleAuthSignIn}
            disabled={isOffline}
          >
            <Cloud className="mr-2 h-4 w-4" />
            {t('cloud.authDialog.openLogin')}
          </Button>
          {isOffline ? (
            <p className="text-muted-foreground text-xs">{t('cloud.authDialog.offlineHint')}</p>
          ) : null}
          {authStartError ? (
            <div
              className="rounded-xl border px-3 py-3 text-sm"
              data-testid="cloud-auth-start-error"
              style={{
                background: getHudTone('danger').softBackground,
                borderColor: getHudTone('danger').softBorder,
                color: getHudTone('danger').text,
              }}
            >
              <div className="font-semibold">{t('cloud.authDialog.startErrorTitle')}</div>
              <div className="mt-1 leading-6">{authStartError}</div>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="cloud-auth-code" className="text-foreground">
              {t('cloud.authDialog.authCode')}
            </Label>
            <Input
              id="cloud-auth-code"
              placeholder={t('cloud.authDialog.placeholder')}
              value={authCode}
              onChange={(e) => setAuthCode(e.target.value)}
              className="text-foreground placeholder:text-muted-foreground border-[var(--hud-border-soft)] bg-[var(--hud-input-bg)]"
            />
            <p className="text-muted-foreground text-xs">{t('cloud.authDialog.instruction')}</p>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => submitAuthCode()}
            disabled={addMutation.isPending || !normalizeGoogleAuthCode(authCode)}
            className="hud-success-cta border-none font-bold shadow-lg shadow-emerald-500/20 transition-all hover:opacity-90"
          >
            {addMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('cloud.authDialog.verify')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="rounded-2xl border border-dashed px-8 py-14 text-center"
        data-testid="cloud-load-error-fallback"
        style={{
          background: 'var(--hud-panel)',
          borderColor: 'var(--hud-danger-soft-border)',
        }}
      >
        <Cloud
          className="mx-auto mb-4 h-12 w-12 opacity-70"
          style={{ color: getHudTone('danger').text }}
        />
        <div
          className="text-foreground text-lg font-semibold"
          style={{ fontFamily: 'Tomorrow, sans-serif' }}
        >
          {t('cloud.error.loadFailed')}
        </div>
        <div className="text-muted-foreground mt-2 text-sm">{t('action.retry')}</div>
        <Button
          className="text-foreground hover:bg-accent/60 hover:text-primary mt-5 border-[var(--hud-border-soft)] bg-transparent"
          variant="outline"
          onClick={() => void refetch()}
          data-testid="cloud-load-error-retry"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('action.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      {showOverviewHeader ? (
        <div
          className="rounded-2xl border px-6 py-6"
          style={{
            background: 'linear-gradient(180deg, var(--hud-panel), var(--hud-panel-alt))',
            borderColor: 'var(--hud-border-strong)',
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-2">
              <h1
                className="text-foreground text-[32px] font-bold tracking-tight"
                style={{ fontFamily: 'Tomorrow, sans-serif' }}
              >
                {t('cloud.connectedIdentities.title', t('cloud.title'))}
              </h1>
              <p className="text-muted-foreground max-w-2xl text-sm">
                {t('cloud.connectedIdentities.description', t('cloud.description'))}
              </p>
            </div>
            <div className="grid min-w-[280px] gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label={t('cloud.stats.total')} value={totalAccounts} />
              <StatCard
                label={t('cloud.stats.active')}
                value={activeAccounts}
                valueStyle={{ color: getHudTone('success').text }}
              />
              <StatCard
                label={t('cloud.stats.rateLimited')}
                value={rateLimitedAccounts}
                valueStyle={{ color: getHudTone('danger').text }}
              />
              {overallQuotaPercentage !== null ? (
                <div
                  className="rounded-lg border px-4 py-3"
                  style={{
                    background: 'var(--hud-panel)',
                    borderColor: 'var(--hud-border-soft)',
                  }}
                >
                  <div className="text-[10px] font-bold tracking-widest text-[var(--hud-text-subtle)] uppercase">
                    {t('cloud.globalQuota')}
                  </div>
                  <div className="mt-1 flex items-center gap-3">
                    <span
                      className="text-lg font-semibold"
                      style={{ color: overallQuotaTone.text }}
                    >
                      {overallQuotaPercentage}%
                    </span>
                    <div
                      className="h-2 flex-1 overflow-hidden rounded-full"
                      style={{ background: 'var(--hud-border-soft)' }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${clampQuotaPercentage(overallQuotaPercentage)}%`,
                          background: overallQuotaTone.solid,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3"
        style={{
          background: 'var(--hud-panel)',
          borderColor: 'var(--hud-border-soft)',
        }}
      >
        <div
          className="flex items-center gap-3 rounded-xl border px-3 py-2"
          style={{ background: 'var(--hud-panel-alt)', borderColor: 'var(--hud-border-soft)' }}
        >
          <div className="flex items-center gap-2">
            <Zap
              className="h-4 w-4"
              style={{
                color: autoSwitchEnabled ? getHudTone('warning').solid : 'var(--hud-text-subtle)',
                fill: autoSwitchEnabled ? getHudTone('warning').solid : 'none',
              }}
            />
            <Label
              htmlFor="auto-switch"
              className="text-foreground cursor-pointer text-sm font-medium"
            >
              {t('cloud.autoSwitch')}
            </Label>
          </div>
          <Switch
            id="auto-switch"
            checked={!!autoSwitchEnabled}
            onCheckedChange={handleToggleAutoSwitch}
            disabled={isSettingsLoading || setAutoSwitchMutation.isPending}
            className="data-[state=checked]:bg-primary"
          />
        </div>

        <Button
          variant="outline"
          onClick={toggleSelectAllAccounts}
          title={t('cloud.batch.selectAll')}
          className="text-foreground hover:bg-accent/60 hover:text-primary border-[var(--hud-border-soft)] bg-[var(--hud-input-bg)]"
        >
          <CheckSquare
            className={`mr-2 h-4 w-4 ${selectedIds.size > 0 && selectedIds.size === accounts?.length ? 'fill-primary/20 text-primary' : ''}`}
          />
          {t('cloud.batch.selectAll')}
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={handleForcePoll}
          title={t('cloud.checkQuota')}
          disabled={forcePollMutation.isPending || isOffline}
          className="text-foreground hover:bg-accent/60 hover:text-primary border-[var(--hud-border-soft)] bg-[var(--hud-input-bg)]"
        >
          <RefreshCcw className={`h-4 w-4 ${forcePollMutation.isPending ? 'animate-spin' : ''}`} />
        </Button>

        {renderAddAccountDialog()}

        <div
          className="ml-auto flex items-center gap-1 rounded-xl border p-1"
          style={{ background: 'var(--hud-input-bg)', borderColor: 'var(--hud-border-soft)' }}
        >
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={gridLayout === '2-col' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="text-foreground h-8 w-8"
                  onClick={() => updateGridLayout('2-col')}
                >
                  <Columns2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('cloud.layout.twoCol')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={gridLayout === 'list' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="text-foreground h-8 w-8"
                  onClick={() => updateGridLayout('list')}
                >
                  <List className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('cloud.layout.list')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <div className={GRID_LAYOUT_CLASSES[gridLayout]}>
        {accounts?.map((account) => (
          <CloudAccountCard
            key={`${account.id}:${account.is_active ? 'active' : 'inactive'}`}
            account={account}
            onRefresh={handleRefresh}
            onDelete={handleDelete}
            onSwitch={handleSwitch}
            onManageIdentity={handleManageIdentity}
            isSelected={selectedIds.has(account.id)}
            onToggleSelection={setSelectionState}
            isRefreshing={
              refreshMutation.isPending && refreshMutation.variables?.accountId === account.id
            }
            isDeleting={
              deleteMutation.isPending && deleteMutation.variables?.accountId === account.id
            }
            isSwitching={
              switchMutation.isPending && switchMutation.variables?.accountId === account.id
            }
            isRefreshDisabled={isOffline}
          />
        ))}

        {accounts?.length === 0 ? (
          <div
            className="col-span-full rounded-2xl border border-dashed py-20 text-center"
            style={{
              background: 'var(--hud-panel-alt)',
              borderColor: 'var(--hud-border-soft)',
            }}
          >
            <Cloud className="text-muted-foreground mx-auto mb-4 h-12 w-12 opacity-40" />
            <div
              className="text-muted-foreground text-base font-semibold"
              style={{ fontFamily: 'Tomorrow, sans-serif' }}
            >
              {t('cloud.list.noAccounts')}
            </div>
            <div className="text-muted-foreground mt-2 text-sm">
              {t('cloud.list.emptyDescription')}
            </div>
          </div>
        ) : null}
      </div>

      {selectedIds.size > 0 ? (
        <div
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-full border px-6 py-2 shadow-lg"
          style={{
            background: 'var(--hud-panel-floating)',
            borderColor: 'var(--hud-border-soft)',
            boxShadow: 'var(--hud-shadow)',
          }}
        >
          <div className="flex items-center gap-2 border-r border-[var(--hud-border-soft)] pr-4">
            <span className="text-foreground text-sm font-semibold">
              {t('cloud.batch.selected', { count: selectedIds.size })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground h-6 w-6 rounded-full"
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={deleteSelectedAccounts}
              disabled={deleteBatchMutation.isPending}
            >
              <Trash2 className="mr-2 h-3 w-3" />
              {t('cloud.batch.delete')}
            </Button>
          </div>
        </div>
      ) : null}

      <IdentityProfileDialog
        account={identityAccount}
        open={Boolean(identityAccount)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setIdentityAccount(null);
          }
        }}
      />
    </div>
  );
}
