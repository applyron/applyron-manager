import React from 'react';

import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { ProviderStats } from '@/utils/provider-grouping';
import { clampQuotaPercentage } from '@/utils/quota-display';

interface ProviderGroupProps {
  idPrefix: string;
  stats: ProviderStats;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  getQuotaTextStyle: (percentage: number) => React.CSSProperties;
  getQuotaBarStyle: (percentage: number) => React.CSSProperties;
  formatQuotaLabel: (percentage: number) => string;
  formatResetTimeLabel: (resetTime?: string) => string;
  formatResetTimeTitle: (resetTime?: string) => string | undefined;
  leftLabel: string;
}

export const ProviderGroup: React.FC<ProviderGroupProps> = ({
  idPrefix,
  stats,
  isCollapsed,
  onToggleCollapse,
  getQuotaTextStyle,
  getQuotaBarStyle,
  formatQuotaLabel,
  formatResetTimeLabel,
  formatResetTimeTitle,
  leftLabel,
}) => {
  const { t } = useTranslation();
  const { providerInfo, visibleModels, avgPercentage, earliestReset } = stats;
  const contentId = `${idPrefix}-${stats.providerKey.replace(/[^a-z0-9_-]/gi, '-')}-panel`;

  if (visibleModels.length === 0) {
    return null;
  }

  return (
    <div className="border-border/60 overflow-hidden rounded-lg border">
      {/* Provider Header */}
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!isCollapsed}
        aria-controls={contentId}
        aria-label={t('a11y.toggleProviderGroup', { provider: providerInfo.name })}
        className="hover:bg-muted/60 flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors"
      >
        {isCollapsed ? (
          <ChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        )}

        {/* Provider color dot */}
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: providerInfo.color }}
        />

        <span className="font-medium">{providerInfo.name}</span>

        <span className="text-muted-foreground text-xs">
          {t('settings.providerGroupings.models', { count: visibleModels.length })}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Averaged metrics */}
        <div className="flex items-center gap-2">
          {earliestReset && (
            <span
              className="text-muted-foreground text-[10px]"
              title={formatResetTimeTitle(earliestReset)}
            >
              {formatResetTimeLabel(earliestReset)}
            </span>
          )}
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-xs font-bold" style={getQuotaTextStyle(avgPercentage)}>
              {formatQuotaLabel(avgPercentage)}
            </span>
            {avgPercentage > 0 && (
              <span className="text-muted-foreground text-[10px]">
                {t('settings.providerGroupings.avgLabel')}
              </span>
            )}
          </div>
          <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${clampQuotaPercentage(avgPercentage)}%`,
                ...getQuotaBarStyle(avgPercentage),
              }}
            />
          </div>
        </div>
      </button>

      {/* Individual model rows (shown when expanded) */}
      {!isCollapsed && (
        <div id={contentId} className="border-border/40 border-t">
          {visibleModels.map((model, index) => (
            <div
              key={model.id}
              className={`hover:bg-muted/60 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-2 pl-9 text-sm transition-colors ${
                index < visibleModels.length - 1 ? 'border-border/20 border-b' : ''
              }`}
            >
              <span
                className="text-muted-foreground min-w-0 truncate"
                title={model.displayName || model.id}
              >
                {model.displayName || model.id.replace('models/', '')}
              </span>
              <div className="flex flex-col items-end gap-1">
                <span
                  className="text-muted-foreground text-[10px] leading-none"
                  title={formatResetTimeTitle(model.resetTime)}
                >
                  {formatResetTimeLabel(model.resetTime)}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="font-mono leading-none font-bold"
                    style={getQuotaTextStyle(model.percentage)}
                  >
                    {formatQuotaLabel(model.percentage)}
                  </span>
                  {model.percentage > 0 && (
                    <span className="text-muted-foreground text-[10px]">{leftLabel}</span>
                  )}
                </div>
                <div className="bg-muted h-1.5 w-24 overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${clampQuotaPercentage(model.percentage)}%`,
                      ...getQuotaBarStyle(model.percentage),
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
