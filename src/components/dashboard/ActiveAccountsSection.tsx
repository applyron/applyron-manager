import type { ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import type { DashboardAccountSummary } from '@/components/dashboard/types';

function ActiveAccountCard({
  title,
  subtitle,
  icon: Icon,
  iconClassName,
  loading,
  loadingText,
  emptyText,
  error,
  errorText,
  account,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  iconClassName: string;
  loading: boolean;
  loadingText: string;
  emptyText: string;
  error?: boolean;
  errorText?: string;
  account: DashboardAccountSummary | null;
}) {
  return (
    <div
      className="rounded-[20px] border px-4 py-4"
      style={{
        background: 'var(--hud-panel-elevated)',
        borderColor: 'var(--hud-border-soft)',
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-2xl border"
          style={{
            background:
              iconClassName === 'text-emerald-500'
                ? 'linear-gradient(135deg, rgba(85,254,126,0.18), rgba(4,210,89,0.08))'
                : 'linear-gradient(135deg, rgba(141,235,255,0.18), rgba(45,125,255,0.08))',
            borderColor: 'var(--hud-border-soft)',
          }}
        >
          <Icon className={`h-4 w-4 ${iconClassName}`} />
        </div>
        <div className="min-w-0">
          <div
            className="text-foreground text-sm font-semibold"
            style={{ fontFamily: 'Tomorrow, sans-serif' }}
          >
            {title}
          </div>
          <div className="text-muted-foreground text-xs">{subtitle}</div>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground mt-4 flex items-center text-sm">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {loadingText}
        </div>
      ) : error ? (
        <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/8 px-3 py-3">
          <div className="flex items-start gap-2 text-sm text-rose-600 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="leading-6">{errorText}</span>
          </div>
        </div>
      ) : account ? (
        <div className="mt-4 space-y-3">
          <div>
            <div
              className="text-foreground truncate text-base font-semibold"
              style={{ fontFamily: 'Tomorrow, sans-serif' }}
            >
              {account.name}
            </div>
            <div className="text-muted-foreground truncate text-sm">{account.secondary}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.16em] uppercase ${
                account.source === 'classic'
                  ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300'
                  : 'bg-sky-500/12 text-sky-600 dark:text-sky-300'
              }`}
            >
              {account.sourceLabel}
            </span>
            <span className="text-foreground rounded-full bg-white/8 px-2.5 py-1 text-[10px] font-medium dark:bg-white/6">
              {account.status}
            </span>
          </div>

          <div className="text-muted-foreground text-sm leading-6">{account.summary}</div>
        </div>
      ) : (
        <div className="text-muted-foreground mt-4 text-sm leading-6">{emptyText}</div>
      )}
    </div>
  );
}

export function ActiveAccountsSection({
  title,
  description,
  ctaLabel,
  classicCard,
  codexCard,
}: {
  title: string;
  description: string;
  ctaLabel: string;
  classicCard: ComponentProps<typeof ActiveAccountCard>;
  codexCard: ComponentProps<typeof ActiveAccountCard>;
}) {
  return (
    <section
      className="rounded-[24px] border px-6 py-6"
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
            {title}
          </div>
          <div className="text-muted-foreground mt-2 text-sm">{description}</div>
        </div>
        <Link
          to="/accounts"
          className="text-primary hover:text-primary/80 inline-flex items-center text-xs font-semibold"
        >
          {ctaLabel}
        </Link>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <ActiveAccountCard {...classicCard} />
        <ActiveAccountCard {...codexCard} />
      </div>
    </section>
  );
}
