import type { ComponentType } from 'react';
import { BellRing, Download, Loader2, Megaphone, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AppUpdateStatus, ServiceHealthSummary } from '@/types/dashboard';
import { formatDateTime, getServiceHealthClass } from '@/components/dashboard/helpers';
import type { LocalizedAnnouncementItem } from '@/components/dashboard/types';
import {
  AnnouncementCarousel,
  SingleAnnouncementCard,
} from '@/components/dashboard/AnnouncementCarousel';

export function DashboardHeroCard({
  eyebrow,
  title,
  description,
  locale,
  updateKicker,
  updateTitle,
  currentVersionLabel,
  latestVersionLabel,
  lastCheckedLabel,
  updateStatus,
  updateStatusMeta,
  updateButtonLabel,
  isReadyToInstall,
  isUpdateActionPending,
  isUpdateActionDisabled,
  onUpdateAction,
  announcementsTitle,
  announcementsDescription,
  announcementsLoadingText,
  announcementsErrorTitle,
  announcementsErrorDescription,
  announcementsEmptyTitle,
  announcementsEmptyDescription,
  announcementsLoading,
  announcementsError,
  announcementsEmpty,
  announcementItems,
  announcementTickerKey,
  onAnnouncementClick,
  healthKicker,
  healthDescription,
  healthLastUpdatedLabel,
  serviceHealthSummary,
  localizedServiceHealthItems,
}: {
  eyebrow: string;
  title: string;
  description: string;
  locale: string;
  updateKicker: string;
  updateTitle: string;
  currentVersionLabel: string;
  latestVersionLabel: string;
  lastCheckedLabel: string;
  updateStatus: AppUpdateStatus;
  updateStatusMeta: {
    icon: ComponentType<{ className?: string }>;
    label: string;
    className: string;
    iconClassName: string;
  };
  updateButtonLabel: string;
  isReadyToInstall: boolean;
  isUpdateActionPending: boolean;
  isUpdateActionDisabled?: boolean;
  onUpdateAction: () => void;
  announcementsTitle: string;
  announcementsDescription: string;
  announcementsLoadingText: string;
  announcementsErrorTitle: string;
  announcementsErrorDescription: string;
  announcementsEmptyTitle: string;
  announcementsEmptyDescription: string;
  announcementsLoading: boolean;
  announcementsError: boolean;
  announcementsEmpty: boolean;
  announcementItems: LocalizedAnnouncementItem[];
  announcementTickerKey: string;
  onAnnouncementClick: (url: string) => void;
  healthKicker: string;
  healthDescription: string;
  healthLastUpdatedLabel: string;
  serviceHealthSummary: ServiceHealthSummary;
  localizedServiceHealthItems: Array<
    ServiceHealthSummary['services'][number] & { labelText: string; stateText: string }
  >;
}) {
  const UpdateStatusIcon = updateStatusMeta.icon;

  return (
    <section
      className="rounded-[28px] border px-6 py-6"
      style={{
        background:
          'radial-gradient(circle at top left, rgba(85,254,126,0.16), transparent 32%), linear-gradient(180deg, var(--hud-panel-elevated), var(--hud-panel-alt))',
        borderColor: 'var(--hud-border-strong)',
        boxShadow: 'var(--hud-shadow)',
      }}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold tracking-[0.24em] uppercase"
            style={{
              borderColor: 'var(--hud-success-soft-border)',
              background: 'var(--hud-success-soft-bg)',
              color: 'hsl(var(--primary))',
              fontFamily: 'Tomorrow, sans-serif',
            }}
          >
            <BellRing className="h-3.5 w-3.5" />
            {eyebrow}
          </div>
          <h1
            className="text-foreground mt-4 text-[30px] font-bold tracking-tight"
            style={{ fontFamily: 'Tomorrow, sans-serif' }}
          >
            {title}
          </h1>
          <p className="text-muted-foreground mt-3 max-w-xl text-sm leading-6">{description}</p>
        </div>

        <div
          className="w-full max-w-[320px] shrink-0 rounded-[22px] border px-4 py-4"
          style={{
            background: 'var(--hud-panel-elevated)',
            borderColor: 'var(--hud-border-soft)',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div
                className="text-[10px] font-bold tracking-[0.2em] text-[var(--hud-text-subtle)] uppercase"
                style={{ fontFamily: 'Tomorrow, sans-serif' }}
              >
                {updateKicker}
              </div>
              <div
                className="text-foreground mt-1 text-sm font-semibold"
                style={{ fontFamily: 'Tomorrow, sans-serif' }}
              >
                {updateTitle}
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-semibold ${updateStatusMeta.className}`}
            >
              <UpdateStatusIcon className={`h-3.5 w-3.5 ${updateStatusMeta.iconClassName}`} />
              {updateStatusMeta.label}
            </span>
          </div>

          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <div className="text-foreground text-xl font-semibold">
                {updateStatus.currentVersion}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">{currentVersionLabel}</div>
            </div>
            <div className="text-right">
              <div className="text-foreground text-sm font-semibold">
                {updateStatus.latestVersion ?? '—'}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">{latestVersionLabel}</div>
            </div>
          </div>

          <div className="text-muted-foreground mt-3 text-xs">
            {lastCheckedLabel}: {formatDateTime(updateStatus.lastCheckedAt, locale)}
          </div>

          {updateStatus.message ? (
            <div className="text-muted-foreground mt-2 text-xs leading-5">
              {updateStatus.message}
            </div>
          ) : null}

          <Button
            onClick={onUpdateAction}
            disabled={isUpdateActionPending || isUpdateActionDisabled}
            className="hud-success-cta mt-4 h-9 w-full border-none font-semibold shadow-lg shadow-emerald-500/20 transition-all hover:opacity-90"
          >
            {isUpdateActionPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : isReadyToInstall ? (
              <Download className="mr-2 h-4 w-4" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {updateButtonLabel}
          </Button>
        </div>
      </div>

      <div className="mt-5 border-t pt-5" style={{ borderColor: 'var(--hud-border-soft)' }}>
        <div className="mt-3">
          {announcementsLoading ? (
            <div
              className="text-muted-foreground flex items-center rounded-[18px] border border-dashed px-4 py-4 text-sm"
              style={{
                background: 'var(--hud-panel-elevated)',
                borderColor: 'var(--hud-border-soft)',
              }}
            >
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {announcementsLoadingText}
            </div>
          ) : null}

          {announcementsError ? (
            <div
              className="rounded-[18px] border border-dashed px-4 py-4"
              style={{
                background: 'var(--hud-panel-elevated)',
                borderColor: 'var(--hud-border-soft)',
              }}
            >
              <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
                <Megaphone className="text-muted-foreground h-4 w-4" />
                {announcementsErrorTitle}
              </div>
              <div className="text-muted-foreground mt-2 text-sm">
                {announcementsErrorDescription}
              </div>
            </div>
          ) : null}

          {announcementsEmpty ? (
            <div
              className="rounded-[18px] border border-dashed px-4 py-4"
              style={{
                background: 'var(--hud-panel-elevated)',
                borderColor: 'var(--hud-border-soft)',
              }}
            >
              <div className="text-foreground text-sm font-semibold">{announcementsEmptyTitle}</div>
              <div className="text-muted-foreground mt-2 text-sm">
                {announcementsEmptyDescription}
              </div>
            </div>
          ) : null}

          {!announcementsError && announcementItems.length === 1 ? (
            <SingleAnnouncementCard
              announcement={announcementItems[0]}
              locale={locale}
              onClick={onAnnouncementClick}
            />
          ) : null}

          {!announcementsError && announcementItems.length > 1 ? (
            <AnnouncementCarousel
              key={announcementTickerKey}
              announcementItems={announcementItems}
              locale={locale}
              kickerText={announcementsTitle}
              descriptionText={announcementsDescription}
              onClick={onAnnouncementClick}
            />
          ) : null}
        </div>

        <div
          className="mt-4 border-t pt-4"
          style={{ borderColor: 'var(--hud-border-soft)' }}
          data-testid="dashboard-service-health"
        >
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div
                className="text-[10px] font-bold tracking-[0.2em] text-[var(--hud-text-subtle)] uppercase"
                style={{ fontFamily: 'Tomorrow, sans-serif' }}
              >
                {healthKicker}
              </div>
              <div className="text-muted-foreground mt-1 text-sm">{healthDescription}</div>
            </div>
            <div className="text-muted-foreground text-xs">
              {healthLastUpdatedLabel}: {formatDateTime(serviceHealthSummary.updatedAt, locale)}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {localizedServiceHealthItems.map((item) => (
              <div
                key={item.id}
                data-testid={`service-health-${item.id}`}
                className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${getServiceHealthClass(item.state)}`}
              >
                <span className="font-semibold">{item.labelText}</span>
                <span className="opacity-80">{item.stateText}</span>
                {item.state === 'error' && item.message ? (
                  <span className="max-w-[240px] truncate opacity-90">{item.message}</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
