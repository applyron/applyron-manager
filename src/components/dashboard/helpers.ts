import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Clock3,
  Download,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
} from 'lucide-react';
import { getCodexHealthState } from '@/managedIde/codexHealth';
import { getCodexAccountDisplayIdentity, getCodexWorkspaceLabel } from '@/managedIde/codexIdentity';
import { getCodexRemainingRequestPercent } from '@/managedIde/codexMetadata';
import type { CodexAccountRecord } from '@/managedIde/types';
import type { CloudAccount } from '@/types/cloudAccount';
import type { AppUpdateStatus, ServiceHealthItem } from '@/types/dashboard';
import {
  getCanonicalVisibleQuotaModels,
  summarizeCanonicalQuotaModels,
} from '@/utils/cloud-quota-models';
import type { DashboardAccountSummary } from '@/components/dashboard/types';

type Translator = (key: string, options?: Record<string, unknown>) => string;

export function formatDateTime(value: number | string | null | undefined, locale: string): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatAnnouncementDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
  }).format(date);
}

export function getAnnouncementLevelLabel(level: string, t: Translator): string {
  const normalizedLevel = level.trim().toLowerCase();

  switch (normalizedLevel) {
    case 'success':
    case 'warning':
    case 'critical':
    case 'info':
      return t(`dashboard.announcements.level.${normalizedLevel}`);
    default:
      return level;
  }
}

export function getAnnouncementLevelClass(level: string): string {
  switch (level.trim().toLowerCase()) {
    case 'success':
      return 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300';
    case 'warning':
      return 'bg-amber-500/12 text-amber-700 dark:text-amber-300';
    case 'critical':
      return 'bg-rose-500/12 text-rose-600 dark:text-rose-300';
    default:
      return 'bg-sky-500/12 text-sky-600 dark:text-sky-300';
  }
}

export function getServiceHealthClass(state: ServiceHealthItem['state']): string {
  switch (state) {
    case 'ready':
      return 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300';
    case 'starting':
      return 'bg-sky-500/12 text-sky-600 dark:text-sky-300';
    case 'degraded':
      return 'bg-amber-500/12 text-amber-700 dark:text-amber-300';
    case 'unsupported':
      return 'bg-slate-500/12 text-slate-700 dark:text-slate-300';
    case 'error':
      return 'bg-rose-500/12 text-rose-600 dark:text-rose-300';
    default:
      return 'bg-white/8 text-foreground/80 dark:bg-white/6';
  }
}

export function getUpdateStatusMeta(
  status: AppUpdateStatus['status'],
  t: Translator,
): {
  icon: LucideIcon;
  label: string;
  className: string;
  iconClassName: string;
} {
  switch (status) {
    case 'checking':
      return {
        icon: RefreshCw,
        label: t('dashboard.update.status.checking'),
        className: 'bg-sky-500/12 text-sky-600 dark:text-sky-300',
        iconClassName: 'text-sky-500 animate-spin',
      };
    case 'up_to_date':
      return {
        icon: ShieldCheck,
        label: t('dashboard.update.status.up_to_date'),
        className: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300',
        iconClassName: 'text-emerald-500',
      };
    case 'update_available':
      return {
        icon: Download,
        label: t('dashboard.update.status.update_available'),
        className: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
        iconClassName: 'text-amber-500',
      };
    case 'error':
      return {
        icon: AlertTriangle,
        label: t('dashboard.update.status.error'),
        className: 'bg-rose-500/12 text-rose-600 dark:text-rose-300',
        iconClassName: 'text-rose-500',
      };
    case 'unsupported':
      return {
        icon: AlertTriangle,
        label: t('dashboard.update.status.unsupported'),
        className: 'bg-slate-500/12 text-slate-700 dark:text-slate-300',
        iconClassName: 'text-slate-500',
      };
    case 'ready_to_install':
      return {
        icon: Download,
        label: t('dashboard.update.status.ready_to_install'),
        className: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300',
        iconClassName: 'text-emerald-500',
      };
    default:
      return {
        icon: Clock3,
        label: t('dashboard.update.status.idle'),
        className: 'bg-white/8 text-foreground/90 dark:bg-white/6',
        iconClassName: 'text-primary',
      };
  }
}

export function buildClassicAccountSummary(
  account: CloudAccount,
  visibilitySettings: Record<string, boolean>,
  t: Translator,
): DashboardAccountSummary {
  const visibleModels = getCanonicalVisibleQuotaModels(account.quota?.models, visibilitySettings);
  const quotaSummary = summarizeCanonicalQuotaModels(visibleModels);

  let status = t('cloud.card.active');
  if (account.status === 'rate_limited') {
    status = t('cloud.card.rateLimited');
  } else if (account.status === 'expired') {
    status = t('cloud.card.expired');
  }

  return {
    key: `classic:${account.id}`,
    source: 'classic',
    sourceLabel: t('dashboard.activeAccounts.sources.classic'),
    name: account.name?.trim() || account.email,
    secondary: account.email,
    status,
    summary:
      quotaSummary.overallPercentage === null
        ? t('dashboard.activeAccounts.classicNoQuota')
        : t('dashboard.activeAccounts.classicQuotaSummary', {
            percentage: quotaSummary.overallPercentage,
            count: quotaSummary.visibleModelCount,
          }),
    icon: Sparkles,
  };
}

export function buildCodexAccountSummary(
  account: CodexAccountRecord,
  t: Translator,
): DashboardAccountSummary {
  const healthState = getCodexHealthState(account);
  const primaryRemaining = getCodexRemainingRequestPercent(
    account.snapshot?.quota?.primary?.usedPercent,
  );
  const secondaryRemaining = getCodexRemainingRequestPercent(
    account.snapshot?.quota?.secondary?.usedPercent,
  );

  const summaryParts = [
    primaryRemaining === null
      ? null
      : t('dashboard.activeAccounts.primaryRemaining', { value: primaryRemaining }),
    secondaryRemaining === null
      ? null
      : t('dashboard.activeAccounts.secondaryRemaining', { value: secondaryRemaining }),
    account.snapshot?.session.planType
      ? t('dashboard.activeAccounts.planType', { value: account.snapshot.session.planType })
      : null,
  ].filter(Boolean);

  const status =
    healthState === 'ready'
      ? t('cloud.codex.health.ready')
      : healthState === 'limited'
        ? t('cloud.codex.health.limited')
        : t('cloud.codex.health.attention');
  const primaryIdentity = getCodexAccountDisplayIdentity({
    ...account,
    planType: account.snapshot?.session.planType,
  });
  const workspaceLabel = getCodexWorkspaceLabel(account.workspace);
  const secondaryIdentity =
    account.email?.trim() && account.email.trim() !== primaryIdentity
      ? account.email.trim()
      : workspaceLabel && workspaceLabel !== primaryIdentity
        ? workspaceLabel
        : null;

  return {
    key: `codex:${account.id}`,
    source: 'codex',
    sourceLabel: t('dashboard.activeAccounts.sources.codex'),
    name: primaryIdentity || t('managedIde.empty.noAccount'),
    secondary: secondaryIdentity ?? account.accountId,
    status,
    summary:
      summaryParts.length > 0
        ? summaryParts.join(' · ')
        : t('dashboard.activeAccounts.codexNoQuota'),
    icon: SquareTerminal,
  };
}
