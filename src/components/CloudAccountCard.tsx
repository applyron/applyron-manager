import { CloudAccount } from '@/types/cloudAccount';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import {
  MoreVertical,
  Trash,
  RefreshCw,
  Box,
  Power,
  Fingerprint,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { formatDistanceToNow, type Locale } from 'date-fns';
import { enUS, tr } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { useAppConfig } from '@/hooks/useAppConfig';
import { useProviderGrouping } from '@/hooks/useProviderGrouping';
import { ProviderGroup } from '@/components/ProviderGroup';
import { useMemo, useState } from 'react';
import {
  type CanonicalQuotaModel,
  getCanonicalVisibleQuotaModels,
  summarizeCanonicalQuotaModels,
} from '@/utils/cloud-quota-models';
import {
  clampQuotaPercentage,
  formatResetTimeLabel,
  formatResetTimeTitle,
} from '@/utils/quota-display';
import { getHudQuotaTone, getHudTone } from '@/utils/hudTone';

const DATE_LOCALE_MAP: Record<string, Locale> = {
  en: enUS,
  tr: tr,
};

function getQuotaColor(percentage: number, type: 'text' | 'bar'): string {
  const tone = getHudTone(getHudQuotaTone(percentage));
  return type === 'text' ? tone.text : tone.solid;
}

interface CloudAccountCardProps {
  account: CloudAccount;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onSwitch: (id: string) => void;
  onManageIdentity: (id: string) => void;
  isSelected?: boolean;
  onToggleSelection?: (id: string, selected: boolean) => void;
  isRefreshing?: boolean;
  isDeleting?: boolean;
  isSwitching?: boolean;
  isRefreshDisabled?: boolean;
}

const CARD_MENU_STYLE = {
  background: 'var(--hud-panel-floating)',
  border: '1px solid var(--hud-border-soft)',
};
const CARD_ACTION_BUTTON_STYLE = {
  background: 'var(--hud-input-bg)',
  border: '1px solid var(--hud-border-soft)',
};
const CARD_SUMMARY_CHIP_STYLE = {
  background: 'var(--hud-panel-alt)',
  border: '1px solid var(--hud-border-soft)',
};

function getStatusBadge(account: CloudAccount, t: (key: string) => string) {
  if (account.is_active) {
    return {
      label: t('cloud.card.active'),
      background: 'var(--hud-success-soft-bg)',
      color: 'hsl(var(--primary))',
      dotColor: 'var(--hud-success)',
      dotShadow: '0 0 6px var(--hud-success-soft-border)',
    };
  }

  if (account.status === 'rate_limited') {
    return {
      label: t('cloud.card.rateLimited'),
      background: 'var(--hud-danger-soft-bg)',
      color: 'hsl(var(--destructive))',
      dotColor: 'var(--hud-danger)',
      dotShadow: 'none',
    };
  }

  if (account.status === 'expired') {
    return {
      label: t('cloud.card.expired'),
      background: 'var(--hud-warning-soft-bg)',
      color: 'var(--hud-warning)',
      dotColor: 'var(--hud-warning)',
      dotShadow: 'none',
    };
  }

  return {
    label: account.provider.toUpperCase(),
    background: 'var(--hud-neutral-soft-bg)',
    color: 'var(--hud-text-subtle)',
    dotColor: 'var(--hud-neutral)',
    dotShadow: 'none',
  };
}

export function CloudAccountCard({
  account,
  onRefresh,
  onDelete,
  onSwitch,
  onManageIdentity,
  isSelected = false,
  onToggleSelection,
  isRefreshing,
  isDeleting,
  isSwitching,
  isRefreshDisabled,
}: CloudAccountCardProps) {
  const { t, i18n } = useTranslation();
  const { config } = useAppConfig();
  const {
    enabled: providerGroupingsEnabled,
    getAccountStats,
    isProviderCollapsed,
    toggleProviderCollapse,
  } = useProviderGrouping();
  const [isExpanded, setIsExpanded] = useState(false);

  const formatResetTimeLabelText = (resetTime?: string) =>
    formatResetTimeLabel(resetTime, {
      prefix: t('cloud.card.resetPrefix'),
      unknown: t('cloud.card.resetUnknown'),
    });

  const formatResetTimeTitleText = (resetTime?: string) =>
    formatResetTimeTitle(resetTime, t('cloud.card.resetTime'));

  const formatQuotaLabel = (percentage: number) =>
    percentage === 0 ? t('cloud.card.rateLimitedQuota') : `${percentage}%`;

  const canonicalModels = useMemo(
    () => getCanonicalVisibleQuotaModels(account.quota?.models, config?.model_visibility ?? {}),
    [account.quota?.models, config?.model_visibility],
  );
  const canonicalSummary = useMemo(
    () => summarizeCanonicalQuotaModels(canonicalModels),
    [canonicalModels],
  );
  const providerStats = providerGroupingsEnabled ? getAccountStats(account) : null;
  const overallQuota = canonicalSummary.overallPercentage;
  const visibleModelCount = canonicalSummary.visibleModelCount;
  const hasVisibleQuotaModels =
    canonicalSummary.geminiModels.length > 0 || canonicalSummary.claudeModels.length > 0;
  const statusBadge = getStatusBadge(account, (key) => t(key));
  const accountIdentity = account.name || account.email || account.id;
  const detailsId = `cloud-account-details-${account.id}`;
  const lastUsedLabel = formatDistanceToNow(account.last_used * 1000, {
    addSuffix: true,
    locale: DATE_LOCALE_MAP[i18n.language] || enUS,
  });

  const renderModelRows = (models: CanonicalQuotaModel[]) =>
    models.map((model) => (
      <div key={model.id} className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span
            className="truncate text-[11px] font-semibold tracking-wider uppercase"
            style={{ color: 'var(--hud-text-subtle)', fontFamily: 'Tomorrow, sans-serif' }}
          >
            {model.displayName}
          </span>
          <span
            className="ml-2 shrink-0 font-mono text-[11px] font-bold"
            style={{ color: getQuotaColor(model.percentage, 'text') }}
          >
            {model.percentage}%
          </span>
        </div>
        {/* Progress bar */}
        <div
          className="h-0.5 w-full overflow-hidden rounded-full"
          style={{ background: 'var(--hud-border-soft)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${clampQuotaPercentage(model.percentage)}%`,
              background: getQuotaColor(model.percentage, 'bar'),
            }}
          />
        </div>
        {model.resetTime && (
          <div className="text-[10px]" style={{ color: 'var(--hud-text-subtle)' }}>
            {formatResetTimeLabelText(model.resetTime)}
          </div>
        )}
      </div>
    ));

  return (
    <div
      data-testid={`cloud-account-card-${account.id}`}
      data-selected={isSelected ? 'true' : 'false'}
      className="cloud-account-card group relative flex h-full flex-col overflow-hidden rounded-lg transition-all duration-300"
    >
      {/* Selection checkbox */}
      {onToggleSelection && (
        <div
          className={`absolute top-3 left-3 z-10 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onToggleSelection(account.id, checked as boolean)}
            aria-label={t('a11y.selectAccount', { target: accountIdentity })}
            className="h-11 w-11 rounded-lg border-2 p-2"
            style={{ borderColor: 'var(--hud-border-strong)' }}
          />
        </div>
      )}

      {/* ── Card Header ── */}
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Provider avatar */}
          {account.avatar_url ? (
            <img
              src={account.avatar_url}
              alt={account.name || ''}
              className="h-10 w-10 shrink-0 rounded-lg object-cover"
              style={{ border: '1px solid var(--hud-border-soft)' }}
            />
          ) : (
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
              style={{
                background: 'var(--hud-success-soft-bg)',
                color: 'hsl(var(--primary))',
                border: '1px solid var(--hud-success-soft-border)',
                fontFamily: 'Tomorrow, sans-serif',
              }}
            >
              {account.name?.[0]?.toUpperCase() || 'A'}
            </div>
          )}
          <div className="min-w-0">
            <div
              className="truncate text-[15px] leading-tight font-semibold"
              style={{ fontFamily: 'Tomorrow, sans-serif', color: 'var(--hud-text-strong)' }}
            >
              {account.name || t('cloud.card.unknown')}
            </div>
            <div className="text-muted-foreground mt-0.5 truncate text-[12px]">{account.email}</div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Status badge */}
          <div
            className="flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-bold tracking-wider uppercase"
            style={{
              fontFamily: 'Tomorrow, sans-serif',
              background: statusBadge.background,
              color: statusBadge.color,
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: statusBadge.dotColor,
                boxShadow: statusBadge.dotShadow,
              }}
            />
            {statusBadge.label}
          </div>

          <button
            type="button"
            onClick={() => setIsExpanded((current) => !current)}
            aria-label={
              isExpanded
                ? t('a11y.collapseAccount', { target: accountIdentity })
                : t('a11y.expandAccount', { target: accountIdentity })
            }
            aria-expanded={isExpanded}
            aria-controls={detailsId}
            title={
              isExpanded
                ? t('a11y.collapseAccount', { target: accountIdentity })
                : t('a11y.expandAccount', { target: accountIdentity })
            }
            className="text-muted-foreground hover:bg-accent/60 hover:text-foreground flex h-11 w-11 items-center justify-center rounded-lg transition-colors"
            style={CARD_ACTION_BUTTON_STYLE}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            <span className="sr-only">
              {isExpanded
                ? t('a11y.collapseAccount', { target: accountIdentity })
                : t('a11y.expandAccount', { target: accountIdentity })}
            </span>
          </button>

          {/* Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('a11y.actionsFor', { target: accountIdentity })}
                title={t('a11y.actionsFor', { target: accountIdentity })}
                className="text-muted-foreground hover:bg-accent/60 hover:text-foreground flex h-11 w-11 items-center justify-center rounded-lg transition-colors"
                style={CARD_ACTION_BUTTON_STYLE}
              >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">{t('a11y.actionsFor', { target: accountIdentity })}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" style={CARD_MENU_STYLE}>
              <DropdownMenuLabel
                style={{
                  color: 'var(--hud-text-subtle)',
                  fontSize: '0.65rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {t('cloud.card.actions')}
              </DropdownMenuLabel>
              {!account.is_active ? (
                <>
                  <DropdownMenuItem onClick={() => onSwitch(account.id)} disabled={isSwitching}>
                    <Power className="mr-2 h-4 w-4" />
                    {t('cloud.card.useAccount')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator style={{ background: 'var(--hud-border-soft)' }} />
                </>
              ) : null}
              <DropdownMenuItem
                onClick={() => onRefresh(account.id)}
                disabled={isRefreshing || isRefreshDisabled}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('cloud.card.refresh')}
              </DropdownMenuItem>
              <DropdownMenuSeparator style={{ background: 'var(--hud-border-soft)' }} />
              <DropdownMenuItem onClick={() => onManageIdentity(account.id)}>
                <Fingerprint className="mr-2 h-4 w-4" />
                {t('cloud.card.identityProfile')}
              </DropdownMenuItem>
              <DropdownMenuSeparator style={{ background: 'var(--hud-border-soft)' }} />
              <DropdownMenuItem
                onClick={() => onDelete(account.id)}
                style={{ color: getHudTone('danger').text }}
                disabled={isDeleting}
              >
                <Trash className="mr-2 h-4 w-4" />
                {t('cloud.card.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isExpanded ? (
        <div id={detailsId} className="flex-1 space-y-3 px-4 pb-4">
          {overallQuota !== null && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span
                  className="text-[10px] font-bold tracking-wider uppercase"
                  style={{ color: 'var(--hud-text-subtle)', fontFamily: 'Tomorrow, sans-serif' }}
                >
                  {t('cloud.card.quotaUsage')}
                </span>
                <span
                  className="font-mono text-[11px] font-bold"
                  style={{ color: getQuotaColor(overallQuota, 'text') }}
                >
                  {overallQuota}%
                </span>
              </div>
              <div
                className="h-0.5 w-full overflow-hidden rounded-full"
                style={{ background: 'var(--hud-border-soft)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${clampQuotaPercentage(overallQuota)}%`,
                    background: getQuotaColor(overallQuota, 'bar'),
                  }}
                />
              </div>
            </div>
          )}

          {providerGroupingsEnabled && providerStats ? (
            providerStats && providerStats.visibleModels > 0 ? (
              <>
                {providerStats.providers.map((statsByProvider) => (
                  <ProviderGroup
                    idPrefix={`cloud-provider-group-${account.id}`}
                    key={statsByProvider.providerKey}
                    stats={statsByProvider}
                    isCollapsed={isProviderCollapsed(account.id, statsByProvider.providerKey)}
                    onToggleCollapse={() =>
                      toggleProviderCollapse(account.id, statsByProvider.providerKey)
                    }
                    getQuotaTextStyle={(p) => ({ color: getHudTone(getHudQuotaTone(p)).text })}
                    getQuotaBarStyle={(p) => ({
                      background: getHudTone(getHudQuotaTone(p)).solid,
                    })}
                    formatQuotaLabel={formatQuotaLabel}
                    formatResetTimeLabel={formatResetTimeLabelText}
                    formatResetTimeTitle={formatResetTimeTitleText}
                    leftLabel={t('cloud.card.left')}
                  />
                ))}
              </>
            ) : (
              <div className="text-muted-foreground flex flex-col items-center justify-center py-6">
                <Box className="mb-2 h-7 w-7 opacity-30" />
                <span className="text-xs">{t('cloud.card.noQuota')}</span>
              </div>
            )
          ) : hasVisibleQuotaModels ? (
            <div className="mt-1 space-y-3">
              {canonicalSummary.geminiModels.length > 0 && (
                <div className="space-y-2.5">
                  <div
                    className="text-[10px] font-bold tracking-wider uppercase"
                    style={{ color: 'var(--hud-text-subtle)', fontFamily: 'Tomorrow, sans-serif' }}
                  >
                    {t('cloud.card.groupGoogleGemini')}
                  </div>
                  {renderModelRows(canonicalSummary.geminiModels)}
                </div>
              )}
              {canonicalSummary.claudeModels.length > 0 && (
                <div className="space-y-2.5">
                  <div
                    className="text-[10px] font-bold tracking-wider uppercase"
                    style={{ color: 'var(--hud-text-subtle)', fontFamily: 'Tomorrow, sans-serif' }}
                  >
                    {t('cloud.card.groupAnthropicClaude')}
                  </div>
                  {renderModelRows(canonicalSummary.claudeModels)}
                </div>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground flex flex-col items-center justify-center py-6">
              <Box className="mb-2 h-7 w-7 opacity-30" />
              <span className="text-xs">{t('cloud.card.noQuota')}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 pb-4">
          <div className="flex flex-wrap gap-2">
            <div
              className="text-foreground rounded-full px-3 py-1.5 text-[11px]"
              style={CARD_SUMMARY_CHIP_STYLE}
            >
              <span className="mr-1.5 text-[10px] font-bold tracking-wider text-[var(--hud-text-subtle)] uppercase">
                {t('cloud.card.quotaUsage')}
              </span>
              <span
                className="font-mono font-semibold"
                style={{
                  color:
                    overallQuota !== null
                      ? getQuotaColor(overallQuota, 'text')
                      : 'var(--hud-text-subtle)',
                }}
              >
                {overallQuota !== null ? `${overallQuota}%` : t('cloud.card.noQuota')}
              </span>
            </div>
            <div
              className="text-foreground rounded-full px-3 py-1.5 text-[11px]"
              style={CARD_SUMMARY_CHIP_STYLE}
            >
              <span className="text-[10px] font-bold tracking-wider text-[var(--hud-text-subtle)] uppercase">
                {t('settings.providerGroupings.models', { count: visibleModelCount })}
              </span>
            </div>
            <div
              className="text-muted-foreground rounded-full px-3 py-1.5 text-[11px]"
              style={CARD_SUMMARY_CHIP_STYLE}
            >
              {t('account.lastUsed', { time: lastUsedLabel })}
            </div>
          </div>
        </div>
      )}

      {/* ── Card Footer ── */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{
          borderTop: '1px solid var(--hud-border-soft)',
          background: 'var(--hud-panel-alt)',
        }}
      >
        <span className="text-muted-foreground text-[11px]">{lastUsedLabel}</span>

        {/* Use / Active button */}
        {account.is_active ? (
          <div
            className="flex items-center gap-1.5 text-[11px] font-semibold"
            style={{ color: 'hsl(var(--primary))', fontFamily: 'Tomorrow, sans-serif' }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: 'var(--hud-success)',
                boxShadow: '0 0 6px var(--hud-success-soft-border)',
              }}
            />
            {t('cloud.card.active')}
          </div>
        ) : (
          <button
            onClick={() => onSwitch(account.id)}
            disabled={isSwitching}
            className="hud-success-cta flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-semibold transition-all duration-200 disabled:opacity-50"
            style={{ fontFamily: 'Tomorrow, sans-serif', letterSpacing: '0.05em' }}
          >
            {isSwitching ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Power className="h-3 w-3" />
            )}
            {t('cloud.card.use')}
          </button>
        )}
      </div>
    </div>
  );
}
