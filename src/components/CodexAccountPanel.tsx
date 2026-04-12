import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  RefreshCcw,
  Cloud,
  Trash2,
  Power,
  Zap,
  CheckSquare,
  Plus,
  Columns2,
  List,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import {
  useActivateCodexAccount,
  useAddCodexAccount,
  useCodexAccounts,
  useDeleteCodexAccount,
  useImportCurrentCodexAccount,
  useManagedIdeStatus,
  useRefreshAllCodexAccounts,
  useRefreshCodexAccount,
  useSyncCodexRuntimeState,
} from '@/hooks/useManagedIde';
import { openExternalUrl } from '@/actions/system';
import { useAppConfig } from '@/hooks/useAppConfig';
import { getCodexRemainingRequestPercent, getCodexWindowKind } from '@/managedIde/codexMetadata';
import { getCodexHealthState } from '@/managedIde/codexHealth';
import {
  reconcileCodexAccountsWithLiveIdentity,
  sortCodexAccounts,
} from '@/managedIde/codexAccounts';
import { getCodexAccountDisplayIdentity, getCodexWorkspaceLabel } from '@/managedIde/codexIdentity';
import type { CodexAccountRecord, CodexRuntimeId } from '@/managedIde/types';
import { getLocalizedErrorMessage } from '@/utils/errorMessages';
import { GridLayout, normalizeGridLayout } from '@/types/config';
import { getHudTone } from '@/utils/hudTone';
import { APP_SHORTCUT_EVENTS, getAppShortcutLabel, isMacLikePlatform } from '@/utils/appShortcuts';

const EMPTY_ACCOUNTS: CodexAccountRecord[] = [];
const PANEL_CARD_STYLE = {
  background: 'var(--hud-panel)',
  border: '1px solid var(--hud-border-soft)',
};
const ALERT_PANEL_STYLE = {
  background: 'var(--hud-danger-soft-bg)',
  border: '1px solid var(--hud-danger-soft-border)',
};
const WARNING_PANEL_STYLE = {
  background: 'var(--hud-warning-soft-bg)',
  border: '1px solid var(--hud-warning-soft-border)',
};
const SUMMARY_PILL_STYLE = {
  background: 'var(--hud-panel-alt)',
  border: '1px solid var(--hud-border-soft)',
};
const PRIMARY_ADD_BUTTON_CLASS =
  'hud-success-cta border-none px-6 font-bold shadow-lg shadow-emerald-500/20 transition-all hover:opacity-90';
const PRIMARY_ADD_BUTTON_STYLE = {};
const CODEX_STATUS_REFETCH_INTERVAL_MS = 1000 * 60 * 5;
const CODEX_STATUS_PENDING_REFETCH_INTERVAL_MS = 5000;
const NON_BLOCKING_RUNTIME_SYNC_WARNINGS = new Set(['CODEX_RUNTIME_SYNC_STATE_SKIPPED']);

type VisibleGridLayout = GridLayout;

const GRID_LAYOUT_CLASSES: Record<VisibleGridLayout, string> = {
  '2-col': 'grid gap-5 md:grid-cols-2',
  list: 'grid gap-5 grid-cols-1',
};

function formatTimestamp(timestamp: number | null | undefined, locale: string): string {
  if (!timestamp) {
    return '—';
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

function getRemainingLabel(
  usedPercent: number | null | undefined,
  windowDurationMins: number | null | undefined,
  t: (key: string) => string,
): string {
  const remaining = getCodexRemainingRequestPercent(usedPercent);
  if (remaining === null) {
    return t('managedIde.empty.unknown');
  }

  const windowKind = getCodexWindowKind(windowDurationMins);
  const windowLabel =
    windowKind === 'fiveHours'
      ? t('cloud.codex.windows.fiveHours')
      : windowKind === 'weekly'
        ? t('cloud.codex.windows.weekly')
        : t('cloud.codex.windows.generic');

  return `${remaining}% · ${windowLabel}`;
}

function getRuntimeLabel(runtimeId: CodexRuntimeId, t: (key: string) => string): string {
  return runtimeId === 'wsl-remote'
    ? t('managedIde.runtimes.wslRemote')
    : t('managedIde.runtimes.windowsLocal');
}

function AccountCard({
  account,
  locale,
  onRefresh,
  onActivate,
  onDelete,
  onToggleSelection,
  isSelected,
  refreshPending,
  activatePending,
  deletePending,
  actionsDisabled,
}: {
  account: CodexAccountRecord;
  locale: string;
  onRefresh: (accountId: string) => void;
  onActivate: (accountId: string) => void;
  onDelete: (accountId: string) => void;
  onToggleSelection?: (accountId: string, selected: boolean) => void;
  isSelected?: boolean;
  refreshPending: boolean;
  activatePending: boolean;
  deletePending: boolean;
  actionsDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const healthState = getCodexHealthState(account);
  const session = account.snapshot?.session;
  const quota = account.snapshot?.quota;
  const canSelect = Boolean(onToggleSelection) && !account.isActive;
  const accountIdentity = getCodexAccountDisplayIdentity({
    ...account,
    planType: session?.planType,
  });
  const secondaryIdentity =
    account.email?.trim() && account.email.trim() !== accountIdentity ? account.email.trim() : null;
  const workspaceLabel = getCodexWorkspaceLabel(account.workspace);
  const showWorkspaceLabel = Boolean(workspaceLabel && workspaceLabel !== accountIdentity);
  const healthTone =
    healthState === 'ready'
      ? getHudTone('info')
      : healthState === 'limited'
        ? getHudTone('danger')
        : getHudTone('warning');
  const statusTone = getHudTone('info');
  const primaryQuotaTone = getHudTone('success');
  const secondaryQuotaTone = getHudTone('info');
  const dangerTone = getHudTone('danger');

  const primaryQuotaLabel = getRemainingLabel(
    quota?.primary?.usedPercent,
    quota?.primary?.windowDurationMins,
    t,
  );
  const secondaryQuotaLabel = getRemainingLabel(
    quota?.secondary?.usedPercent,
    quota?.secondary?.windowDurationMins,
    t,
  );
  const statusLabel = session
    ? t(`managedIde.session.${session.state}`)
    : t('managedIde.empty.unavailable');

  return (
    <div
      className="group relative overflow-hidden rounded-lg transition-all duration-300"
      style={{
        ...PANEL_CARD_STYLE,
        background: isSelected ? 'var(--hud-panel-elevated)' : 'var(--hud-panel)',
        border: isSelected
          ? '1px solid var(--hud-success-soft-border)'
          : '1px solid var(--hud-border-soft)',
        boxShadow: isSelected ? 'var(--hud-shadow)' : 'none',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: 'linear-gradient(135deg, var(--hud-info-soft-bg), transparent 70%)' }}
      />

      {canSelect ? (
        <div
          className={`absolute top-3 left-3 z-10 transition-opacity ${
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <Checkbox
            checked={Boolean(isSelected)}
            onCheckedChange={(checked) => onToggleSelection?.(account.id, checked === true)}
            aria-label={t('a11y.selectAccount', { target: accountIdentity })}
            className="h-11 w-11 rounded-lg border-2 p-2"
            style={{ borderColor: 'var(--hud-border-strong)' }}
          />
        </div>
      ) : null}

      <div
        className={`relative z-10 flex items-start justify-between border-b p-4 pb-3 ${
          canSelect ? 'pl-10' : ''
        }`}
        style={{ borderColor: 'var(--hud-border-soft)' }}
      >
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className="text-foreground text-base font-semibold"
              style={{ fontFamily: 'Tomorrow, sans-serif' }}
            >
              {accountIdentity}
            </h3>
            {account.isActive ? (
              <span
                className="rounded px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase"
                style={{
                  background: 'var(--hud-success-soft-bg)',
                  color: 'hsl(var(--primary))',
                }}
              >
                {t('cloud.card.active')}
              </span>
            ) : null}
            <span
              className="rounded px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase"
              style={{
                background: healthTone.softBackground,
                color: healthTone.text,
                border: `1px solid ${healthTone.softBorder}`,
              }}
            >
              {healthState === 'ready'
                ? t('cloud.codex.health.ready')
                : healthState === 'limited'
                  ? t('cloud.codex.health.limited')
                  : t('cloud.codex.health.attention')}
            </span>
          </div>
          {secondaryIdentity ? (
            <p className="text-muted-foreground text-[12px]">{secondaryIdentity}</p>
          ) : account.email ? null : (
            <p className="text-muted-foreground text-[12px]">
              {t('cloud.codex.labels.accountIdPrefix', { id: account.accountId })}
            </p>
          )}
          {showWorkspaceLabel ? (
            <p className="text-muted-foreground text-[12px]">
              {t('cloud.codex.labels.workspacePrefix', { name: workspaceLabel })}
            </p>
          ) : null}
        </div>
        <div className="flex items-start gap-2">
          <div className="text-right">
            <div className="text-[10px] font-bold tracking-widest text-[var(--hud-text-subtle)] uppercase">
              {t('managedIde.labels.lastUpdated')}
            </div>
            <div className="text-muted-foreground mt-0.5 text-[11px]">
              {formatTimestamp(account.lastRefreshedAt ?? account.snapshot?.lastUpdatedAt, locale)}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 pt-3">
        <div className="flex flex-wrap gap-2">
          <div
            className="text-foreground rounded-full px-3 py-1.5 text-[11px]"
            style={SUMMARY_PILL_STYLE}
          >
            <span className="mr-1.5 text-[10px] font-bold tracking-wider text-[var(--hud-text-subtle)] uppercase">
              {t('cloud.codex.labels.plan')}
            </span>
            <span className="font-semibold">
              {session?.planType || t('managedIde.empty.unknown')}
            </span>
          </div>
          <div
            className="text-foreground rounded-full px-3 py-1.5 text-[11px]"
            style={SUMMARY_PILL_STYLE}
          >
            <span className="mr-1.5 text-[10px] font-bold tracking-wider text-[var(--hud-text-subtle)] uppercase">
              {t('cloud.codex.labels.status')}
            </span>
            <span className="font-semibold" style={{ color: statusTone.text }}>
              {statusLabel}
            </span>
          </div>
          <div
            className="text-foreground rounded-full px-3 py-1.5 text-[11px]"
            style={SUMMARY_PILL_STYLE}
          >
            <span className="mr-1.5 text-[10px] font-bold tracking-wider text-[var(--hud-text-subtle)] uppercase">
              {t('cloud.codex.labels.primaryQuota')}
            </span>
            <span className="font-mono font-semibold" style={{ color: primaryQuotaTone.text }}>
              {primaryQuotaLabel}
            </span>
          </div>
          <div
            className="text-foreground rounded-full px-3 py-1.5 text-[11px]"
            style={SUMMARY_PILL_STYLE}
          >
            <span className="mr-1.5 text-[10px] font-bold tracking-wider text-[var(--hud-text-subtle)] uppercase">
              {t('cloud.codex.labels.secondaryQuota')}
            </span>
            <span className="font-mono font-semibold" style={{ color: secondaryQuotaTone.text }}>
              {secondaryQuotaLabel}
            </span>
          </div>
        </div>
      </div>

      <div
        className="flex flex-wrap gap-2 border-t px-4 py-3"
        style={{ borderColor: 'var(--hud-border-soft)', background: 'var(--hud-panel-alt)' }}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRefresh(account.id)}
          disabled={refreshPending || actionsDisabled}
          className="text-foreground hover:bg-accent/60 h-8 border-[var(--hud-border-soft)] bg-transparent text-xs"
        >
          {refreshPending ? (
            <Loader2 className="text-primary mr-2 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 h-3 w-3" />
          )}
          {t('managedIde.actions.refresh')}
        </Button>

        <Button
          size="sm"
          onClick={() => onActivate(account.id)}
          disabled={activatePending || account.isActive || actionsDisabled}
          className={`h-8 text-xs font-semibold tracking-wider uppercase ${
            account.isActive
              ? 'bg-primary/10 text-primary hover:bg-primary/15'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          {activatePending ? (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          ) : (
            <Power className="mr-2 h-3 w-3" />
          )}
          {account.isActive ? t('cloud.card.active') : t('cloud.codex.actions.activate')}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(account.id)}
          disabled={deletePending || account.isActive}
          title={account.isActive ? t('cloud.errors.codexDeleteActiveBlocked') : undefined}
          className="ml-auto h-8 text-xs disabled:opacity-50"
          style={{
            color: dangerTone.text,
          }}
        >
          {deletePending ? (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="mr-2 h-3 w-3" />
          )}
          {t('cloud.card.delete')}
        </Button>
      </div>
    </div>
  );
}

export function CodexAccountPanel() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { config, saveConfig, isSaving } = useAppConfig();
  const refreshShortcutLabel = getAppShortcutLabel('refreshAccounts', isMacLikePlatform());

  const statusQuery = useManagedIdeStatus('vscode-codex', {
    enabled: true,
    refresh: false,
    refetchInterval: (query) =>
      query.state.data?.pendingRuntimeApply
        ? CODEX_STATUS_PENDING_REFETCH_INTERVAL_MS
        : CODEX_STATUS_REFETCH_INTERVAL_MS,
  });
  const accountsQuery = useCodexAccounts();
  const addMutation = useAddCodexAccount();
  const importMutation = useImportCurrentCodexAccount();
  const refreshAllMutation = useRefreshAllCodexAccounts();
  const refreshAccountMutation = useRefreshCodexAccount();
  const activateMutation = useActivateCodexAccount();
  const deleteMutation = useDeleteCodexAccount();
  const syncRuntimeMutation = useSyncCodexRuntimeState();

  const status = statusQuery.data;
  const installation = status?.installation;
  const statusErrorMessage = statusQuery.isError
    ? getLocalizedErrorMessage(statusQuery.error, t)
    : null;
  const accounts = useMemo(
    () =>
      reconcileCodexAccountsWithLiveIdentity(
        sortCodexAccounts(accountsQuery.data ?? EMPTY_ACCOUNTS),
        status?.liveAccountIdentityKey,
      ),
    [accountsQuery.data, status?.liveAccountIdentityKey],
  );
  const gridLayout = normalizeGridLayout(config?.grid_layout ?? '2-col');
  const runtimeStatuses = status?.runtimes ?? [];
  const availableRuntimes = runtimeStatuses.filter((runtime) => runtime.installation.available);
  const activeRuntime =
    runtimeStatuses.find((runtime) => runtime.id === status?.activeRuntimeId) ?? null;
  const pendingRuntimeApply = status?.pendingRuntimeApply ?? null;
  const pendingRuntimeAccount =
    accounts.find((account) => account.id === pendingRuntimeApply?.recordId) ?? null;
  const pendingRuntimeLabel = pendingRuntimeApply
    ? getRuntimeLabel(pendingRuntimeApply.runtimeId, t)
    : null;
  const activeRuntimeLabel = activeRuntime ? getRuntimeLabel(activeRuntime.id, t) : null;
  const hasRuntimeMismatch = Boolean(status?.hasRuntimeMismatch);
  const runtimeActionBlocked = !installation?.available;
  const canAddAccount = Boolean(installation?.available && installation?.codexCliPath);
  const canImportCurrent = Boolean(installation?.available);
  const canSyncRuntime = availableRuntimes.length >= 2;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectableAccountIds = useMemo(
    () => accounts.filter((account) => !account.isActive).map((account) => account.id),
    [accounts],
  );
  const selectableAccountIdSet = useMemo(
    () => new Set(selectableAccountIds),
    [selectableAccountIds],
  );
  const effectiveSelectedIds = useMemo(
    () => new Set([...selectedIds].filter((id) => selectableAccountIdSet.has(id))),
    [selectedIds, selectableAccountIdSet],
  );
  const allSelectableSelected =
    selectableAccountIds.length > 0 && effectiveSelectedIds.size === selectableAccountIds.length;

  useEffect(() => {
    if (statusQuery.data?.session.state !== 'ready') {
      return;
    }

    void accountsQuery.refetch();
  }, [accountsQuery, statusQuery.data?.lastUpdatedAt, statusQuery.data?.session.state]);

  const handleRefreshAll = useCallback(() => {
    refreshAllMutation.mutate(undefined, {
      onError: (error) => {
        toast({
          title: t('managedIde.toast.refreshFailedTitle'),
          description: getLocalizedErrorMessage(error, t),
          variant: 'destructive',
        });
      },
    });
  }, [refreshAllMutation, t, toast]);

  useEffect(() => {
    const handleShortcutRefresh = () => {
      handleRefreshAll();
    };

    window.addEventListener(APP_SHORTCUT_EVENTS.refreshCodexAccounts, handleShortcutRefresh);
    return () => {
      window.removeEventListener(APP_SHORTCUT_EVENTS.refreshCodexAccounts, handleShortcutRefresh);
    };
  }, [handleRefreshAll]);

  const updateGridLayout = async (layout: VisibleGridLayout) => {
    if (!config) {
      return;
    }

    try {
      await saveConfig({ ...config, grid_layout: layout });
    } catch {
      // useAppConfig already surfaces a localized error toast
    }
  };

  const handleToggleAutoSwitch = async (checked: boolean) => {
    if (!config) {
      return;
    }

    try {
      await saveConfig({ ...config, codex_auto_switch_enabled: checked });
    } catch {
      // useAppConfig already surfaces a localized error toast
    }
  };

  const handleAddAccount = () => {
    addMutation.mutate(undefined, {
      onSuccess: (accounts) => {
        const description =
          accounts.length === 1
            ? (accounts[0]?.email ??
              getCodexAccountDisplayIdentity({
                ...accounts[0],
                planType: accounts[0]?.snapshot?.session.planType,
              }) ??
              t('cloud.codex.toast.addedDescription'))
            : t('cloud.codex.toast.addedBatchDescription', { count: accounts.length });
        toast({
          title: t('cloud.codex.toast.addedTitle'),
          description,
        });
      },
      onError: (error) => {
        toast({
          title: t('cloud.codex.toast.addFailedTitle'),
          description: getLocalizedErrorMessage(error, t),
          variant: 'destructive',
        });
      },
    });
  };

  const handleImportCurrent = () => {
    importMutation.mutate(undefined, {
      onSuccess: (account) => {
        toast({
          title: t('cloud.codex.toast.importedTitle'),
          description: account.email || t('cloud.codex.toast.importedDescription'),
        });
      },
      onError: (error) => {
        toast({
          title: t('cloud.codex.toast.importFailedTitle'),
          description: getLocalizedErrorMessage(error, t),
          variant: 'destructive',
        });
      },
    });
  };

  const handleRefreshAccount = (accountId: string) => {
    refreshAccountMutation.mutate(accountId, {
      onError: (error) => {
        toast({
          title: t('managedIde.toast.refreshFailedTitle'),
          description: getLocalizedErrorMessage(error, t),
          variant: 'destructive',
        });
      },
    });
  };

  const handleActivateAccount = (accountId: string) => {
    activateMutation.mutate(accountId, {
      onSuccess: (activation) => {
        const accountIdentity =
          activation.account.email ||
          getCodexAccountDisplayIdentity({
            ...activation.account,
            planType: activation.account.snapshot?.session.planType,
          }) ||
          t('cloud.codex.toast.activatedDescription');

        if (activation.deferredUntilIdeRestart) {
          toast({
            title: t('cloud.codex.toast.deferredActivationTitle'),
            description: t('cloud.codex.toast.deferredActivationDescription', {
              account: accountIdentity,
              runtime: activation.appliedRuntimeId
                ? getRuntimeLabel(activation.appliedRuntimeId, t)
                : t('managedIde.empty.unknown'),
            }),
          });
          return;
        }

        toast({
          title: t('cloud.codex.toast.activatedTitle'),
          description: accountIdentity,
        });
      },
      onError: (error) => {
        toast({
          title: t('cloud.codex.toast.activateFailedTitle'),
          description: getLocalizedErrorMessage(error, t),
          variant: 'destructive',
        });
      },
    });
  };

  const handleReloadVsCode = async () => {
    try {
      await openExternalUrl({
        url: 'vscode://command/workbench.action.reloadWindow',
        intent: 'vscode_command',
      });
    } catch (error) {
      toast({
        title: t('cloud.codex.pendingApply.title'),
        description: getLocalizedErrorMessage(error, t),
        variant: 'destructive',
      });
    }
  };

  const handleSyncRuntimeState = () => {
    syncRuntimeMutation.mutate(undefined, {
      onSuccess: (result) => {
        const source = getRuntimeLabel(result.sourceRuntimeId, t);
        const target = getRuntimeLabel(result.targetRuntimeId, t);
        const actionableWarnings = result.warnings.filter(
          (warning) => !NON_BLOCKING_RUNTIME_SYNC_WARNINGS.has(warning),
        );
        const warningDescription = actionableWarnings
          .map((warning) => getLocalizedErrorMessage(new Error(warning), t))
          .join(' ');

        toast({
          title:
            actionableWarnings.length > 0
              ? t('cloud.codex.toast.runtimeSyncWarningTitle')
              : t('cloud.codex.toast.runtimeSyncTitle'),
          description:
            actionableWarnings.length > 0
              ? t('cloud.codex.toast.runtimeSyncWarningDescription', {
                  source,
                  target,
                  warnings: warningDescription,
                })
              : t('cloud.codex.toast.runtimeSyncDescription', {
                  source,
                  target,
                }),
        });
      },
      onError: (error) => {
        toast({
          title: t('cloud.codex.toast.runtimeSyncFailedTitle'),
          description: getLocalizedErrorMessage(error, t),
          variant: 'destructive',
        });
      },
    });
  };

  const handleDeleteAccount = (id: string) => {
    const targetAccount = accounts.find((account) => account.id === id);
    const accountIdentity = targetAccount
      ? getCodexAccountDisplayIdentity({
          ...targetAccount,
          planType: targetAccount.snapshot?.session.planType,
        })
      : id;
    const workspaceLabel = targetAccount ? getCodexWorkspaceLabel(targetAccount.workspace) : null;
    const deleteTarget =
      workspaceLabel && targetAccount?.email
        ? `${targetAccount.email} (${workspaceLabel})`
        : workspaceLabel && !targetAccount?.email
          ? workspaceLabel
          : accountIdentity;
    if (!window.confirm(t('cloud.codex.confirmDelete', { target: deleteTarget }))) {
      return;
    }

    deleteMutation.mutate(id, {
      onSuccess: () => {
        toast({
          title: t('cloud.codex.toast.deletedTitle'),
          description: deleteTarget,
        });
      },
      onError: (error) => {
        toast({
          title: t('cloud.codex.toast.deleteFailedTitle'),
          description: getLocalizedErrorMessage(error, t),
          variant: 'destructive',
        });
      },
    });
  };

  const toggleSelectAllAccounts = () => {
    if (allSelectableSelected) {
      setSelectedIds(new Set());
      return;
    }

    setSelectedIds(new Set(selectableAccountIds));
  };

  const setSelectionState = (accountId: string, selected: boolean) => {
    if (!selectableAccountIds.includes(accountId)) {
      return;
    }

    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (selected) {
        next.add(accountId);
      } else {
        next.delete(accountId);
      }
      return next;
    });
  };

  const deleteSelectedAccounts = async () => {
    if (effectiveSelectedIds.size === 0) {
      return;
    }

    if (!window.confirm(t('cloud.batch.confirmDelete', { count: effectiveSelectedIds.size }))) {
      return;
    }

    try {
      for (const accountId of effectiveSelectedIds) {
        await deleteMutation.mutateAsync(accountId);
      }

      toast({
        title: t('cloud.codex.toast.deletedTitle'),
        description: t('cloud.batch.deleted', { count: effectiveSelectedIds.size }),
      });
      setSelectedIds(new Set());
    } catch (error) {
      toast({
        title: t('cloud.codex.toast.deleteFailedTitle'),
        description: getLocalizedErrorMessage(error, t),
        variant: 'destructive',
      });
    }
  };

  if (statusQuery.isLoading || (accountsQuery.isLoading && !accountsQuery.data)) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin" style={{ color: getHudTone('info').text }} />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      <div
        className="rounded-2xl border px-4 py-3"
        style={{
          background: 'var(--hud-panel)',
          borderColor: 'var(--hud-border-soft)',
        }}
      >
        <div className="overflow-x-auto">
          <div
            className="flex w-max min-w-full items-center gap-2.5"
            style={{ scrollbarWidth: 'thin' }}
          >
            <div
              className="flex h-11 shrink-0 items-center gap-3 rounded-xl border px-3.5"
              style={{ background: 'var(--hud-panel-alt)', borderColor: 'var(--hud-border-soft)' }}
            >
              <div className="flex items-center gap-2">
                <Zap
                  className="h-4 w-4"
                  style={{
                    color: config?.codex_auto_switch_enabled
                      ? getHudTone('warning').solid
                      : 'var(--hud-text-subtle)',
                    fill: config?.codex_auto_switch_enabled ? getHudTone('warning').solid : 'none',
                  }}
                />
                <span className="text-foreground text-sm font-semibold whitespace-nowrap">
                  {t('cloud.autoSwitch')}
                </span>
              </div>
              <Switch
                id="codex-auto-switch"
                checked={Boolean(config?.codex_auto_switch_enabled)}
                onCheckedChange={handleToggleAutoSwitch}
                disabled={!config || isSaving}
                className="data-[state=checked]:bg-primary"
              />
            </div>

            {activeRuntime ? (
              <div
                className="flex h-11 shrink-0 items-center gap-3 rounded-xl border px-3.5 text-sm"
                style={{
                  background: 'var(--hud-panel-alt)',
                  borderColor: hasRuntimeMismatch
                    ? 'var(--hud-warning-soft-border)'
                    : 'var(--hud-border-soft)',
                }}
              >
                <span className="text-[10px] font-bold tracking-[0.2em] text-[var(--hud-text-subtle)] uppercase">
                  {t('managedIde.labels.activeRuntime')}
                </span>
                <span className="text-foreground font-semibold whitespace-nowrap">
                  {activeRuntimeLabel}
                </span>
              </div>
            ) : null}

            {hasRuntimeMismatch ? (
              <div
                className="flex h-9 shrink-0 items-center rounded-full px-3 text-xs font-semibold whitespace-nowrap"
                style={{
                  background: 'var(--hud-warning-soft-bg)',
                  border: '1px solid var(--hud-warning-soft-border)',
                  color: getHudTone('warning').text,
                }}
              >
                {t('cloud.codex.badges.runtimeMismatch')}
              </div>
            ) : null}

            <div
              className="flex h-11 shrink-0 items-center rounded-xl border p-1"
              style={{ background: 'var(--hud-input-bg)', borderColor: 'var(--hud-border-soft)' }}
            >
              <Button
                variant="ghost"
                onClick={toggleSelectAllAccounts}
                title={t('cloud.batch.selectAll')}
                disabled={selectableAccountIds.length === 0}
                className="text-foreground hover:bg-accent/60 hover:text-primary h-9 rounded-lg px-3.5 whitespace-nowrap"
              >
                <CheckSquare
                  className={`mr-2 h-4 w-4 ${
                    allSelectableSelected ? 'fill-primary/20 text-primary' : ''
                  }`}
                />
                {t('cloud.batch.selectAll')}
              </Button>

              <div
                className="mx-1 h-5 w-px shrink-0"
                style={{ background: 'var(--hud-border-soft)' }}
              />

              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefreshAll}
                title={`${t('cloud.codex.actions.refreshAll')} (${refreshShortcutLabel})`}
                aria-label={`${t('cloud.codex.actions.refreshAll')} (${refreshShortcutLabel})`}
                disabled={refreshAllMutation.isPending || accounts.length === 0}
                className="text-foreground hover:bg-accent/60 hover:text-primary h-9 w-9 rounded-lg"
              >
                <RefreshCcw
                  className={`h-4 w-4 ${refreshAllMutation.isPending ? 'animate-spin' : ''}`}
                />
              </Button>

              {canSyncRuntime ? (
                <>
                  <div
                    className="mx-1 h-5 w-px shrink-0"
                    style={{ background: 'var(--hud-border-soft)' }}
                  />
                  <Button
                    variant="ghost"
                    onClick={handleSyncRuntimeState}
                    disabled={syncRuntimeMutation.isPending}
                    className="text-foreground hover:bg-accent/60 hover:text-primary h-9 rounded-lg px-3.5 whitespace-nowrap"
                  >
                    {syncRuntimeMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCcw className="mr-2 h-4 w-4" />
                    )}
                    {t('cloud.codex.actions.syncRuntime')}
                  </Button>
                </>
              ) : null}
            </div>

            <Button
              onClick={handleAddAccount}
              disabled={addMutation.isPending || !canAddAccount}
              className={`${PRIMARY_ADD_BUTTON_CLASS} h-11 shrink-0 px-5 whitespace-nowrap`}
              style={PRIMARY_ADD_BUTTON_STYLE}
            >
              {addMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {t('cloud.connectedIdentities.addNew', t('cloud.addAccount'))}
            </Button>

            <div
              className="ml-auto flex h-11 shrink-0 items-center gap-1 rounded-xl border p-1"
              style={{ background: 'var(--hud-input-bg)', borderColor: 'var(--hud-border-soft)' }}
            >
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={gridLayout === '2-col' ? 'secondary' : 'ghost'}
                      size="icon"
                      className="text-foreground h-8 w-8"
                      aria-label={t('cloud.layout.twoCol')}
                      title={t('cloud.layout.twoCol')}
                      onClick={() => void updateGridLayout('2-col')}
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
                      aria-label={t('cloud.layout.list')}
                      title={t('cloud.layout.list')}
                      onClick={() => void updateGridLayout('list')}
                    >
                      <List className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('cloud.layout.list')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>
      </div>

      {accountsQuery.isError ? (
        <div
          className="text-foreground rounded-lg border border-dashed p-4 text-sm"
          style={ALERT_PANEL_STYLE}
        >
          <div className="font-medium">{t('cloud.codex.toast.importFailedTitle')}</div>
          <div className="text-muted-foreground mt-1 text-xs">
            {t('cloud.codex.accountCardDescription')}
          </div>
        </div>
      ) : null}

      {statusErrorMessage ? (
        <div
          className="text-foreground rounded-lg border border-dashed p-4 text-sm"
          style={ALERT_PANEL_STYLE}
        >
          <div className="font-medium">{t('managedIde.toast.refreshFailedTitle')}</div>
          <div className="text-muted-foreground mt-1 text-xs">{statusErrorMessage}</div>
          <Button
            variant="outline"
            className="text-foreground hover:bg-accent/60 mt-3 border-[var(--hud-border-soft)] bg-transparent"
            onClick={() => void statusQuery.refetch()}
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            {t('action.retry')}
          </Button>
        </div>
      ) : null}

      {installation && !installation.available ? (
        <div
          className="text-foreground rounded-lg border border-dashed p-6 text-sm"
          style={ALERT_PANEL_STYLE}
        >
          <div className="font-medium">{t('managedIde.installation.unavailableTitle')}</div>
          <div className="text-muted-foreground mt-2">
            {t(`managedIde.availability.${installation.reason || 'unknown_error'}`)}
          </div>
        </div>
      ) : null}

      {pendingRuntimeApply ? (
        <div
          className="text-foreground rounded-lg border border-dashed p-4 text-sm"
          style={WARNING_PANEL_STYLE}
          data-testid="codex-pending-runtime-apply"
        >
          <div className="font-medium">{t('cloud.codex.pendingApply.title')}</div>
          <div className="text-muted-foreground mt-1 text-xs">
            {t('cloud.codex.pendingApply.description', {
              account:
                pendingRuntimeAccount?.email ||
                (pendingRuntimeAccount
                  ? getCodexAccountDisplayIdentity({
                      ...pendingRuntimeAccount,
                      planType: pendingRuntimeAccount.snapshot?.session.planType,
                    })
                  : t('managedIde.empty.unknown')),
              runtime: pendingRuntimeLabel ?? t('managedIde.empty.unknown'),
            })}
          </div>
          <div className="mt-3">
            <Button
              variant="outline"
              onClick={() => void handleReloadVsCode()}
              className="text-foreground hover:bg-accent/60 border-[var(--hud-border-soft)] bg-transparent"
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              {t('cloud.codex.pendingApply.reloadAction')}
            </Button>
          </div>
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <div
          className="text-foreground rounded-xl border border-dashed py-20 text-center"
          style={PANEL_CARD_STYLE}
        >
          <Cloud className="text-muted-foreground mx-auto h-12 w-12 opacity-30" />
          <div
            className="mt-4 text-lg font-semibold"
            style={{ fontFamily: 'Tomorrow, sans-serif' }}
          >
            {t('cloud.codex.emptyTitle')}
          </div>
          <div className="text-muted-foreground mt-2 text-sm">
            {t('cloud.codex.emptyDescription')}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              onClick={handleAddAccount}
              disabled={addMutation.isPending || !canAddAccount}
              className={PRIMARY_ADD_BUTTON_CLASS}
              style={PRIMARY_ADD_BUTTON_STYLE}
            >
              {addMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {t('cloud.connectedIdentities.addNew', t('cloud.addAccount'))}
            </Button>
            <Button
              variant="outline"
              onClick={handleImportCurrent}
              disabled={importMutation.isPending || !canImportCurrent}
              className="text-foreground hover:bg-accent/60 h-11 border-[var(--hud-border-soft)] bg-transparent px-5"
            >
              {importMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Cloud className="mr-2 h-4 w-4" />
              )}
              {t('cloud.codex.actions.importCurrent')}
            </Button>
          </div>
        </div>
      ) : (
        <div data-testid="codex-account-grid" className={GRID_LAYOUT_CLASSES[gridLayout]}>
          {accounts.map((account) => (
            <AccountCard
              key={`${account.id}:${account.isActive ? 'active' : 'inactive'}`}
              account={account}
              locale={i18n.language}
              onRefresh={handleRefreshAccount}
              onActivate={handleActivateAccount}
              onDelete={handleDeleteAccount}
              onToggleSelection={setSelectionState}
              isSelected={effectiveSelectedIds.has(account.id)}
              actionsDisabled={runtimeActionBlocked}
              refreshPending={
                refreshAccountMutation.isPending && refreshAccountMutation.variables === account.id
              }
              activatePending={
                activateMutation.isPending && activateMutation.variables === account.id
              }
              deletePending={deleteMutation.isPending && deleteMutation.variables === account.id}
            />
          ))}
        </div>
      )}

      {effectiveSelectedIds.size > 0 ? (
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
              {t('cloud.batch.selected', { count: effectiveSelectedIds.size })}
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
            <Button variant="destructive" size="sm" onClick={() => void deleteSelectedAccounts()}>
              <Trash2 className="mr-2 h-3 w-3" />
              {t('cloud.batch.delete')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
