import { ArrowUpRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LocalizedAnnouncementItem } from '@/components/dashboard/types';
import { formatAnnouncementDate, getAnnouncementLevelClass } from '@/components/dashboard/helpers';

const ANNOUNCEMENT_ROTATION_MS = 10_000;
const ANNOUNCEMENT_TRANSITION_MS = 700;

function AnnouncementButton({
  announcement,
  locale,
  onClick,
}: {
  announcement: LocalizedAnnouncementItem;
  locale: string;
  onClick: (url: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(announcement.url)}
      data-testid={`announcement-card-${announcement.id}`}
      className="group focus-visible:ring-primary/60 block h-full w-full rounded-[18px] border px-4 py-3 text-left transition-transform duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:outline-none"
      style={{
        background: 'var(--hud-panel-elevated)',
        borderColor: 'var(--hud-border-soft)',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${getAnnouncementLevelClass(announcement.level)}`}
          >
            {announcement.levelLabel}
          </span>
          <div className="min-w-0">
            <div
              className="text-foreground truncate text-sm font-semibold"
              style={{ fontFamily: 'Tomorrow, sans-serif' }}
            >
              {announcement.titleText}
            </div>
            <div className="text-muted-foreground truncate text-xs">{announcement.bodyText}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {formatAnnouncementDate(announcement.publishedAt, locale)}
          </span>
          <ArrowUpRight className="text-muted-foreground group-hover:text-foreground h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>
      </div>
    </button>
  );
}

export function AnnouncementCarousel({
  announcementItems,
  locale,
  kickerText,
  descriptionText,
  onClick,
}: {
  announcementItems: LocalizedAnnouncementItem[];
  locale: string;
  kickerText: string;
  descriptionText: string;
  onClick: (url: string) => void;
}) {
  const [announcementIndex, setAnnouncementIndex] = useState(0);
  const [tickerTransitionEnabled, setTickerTransitionEnabled] = useState(true);

  const tickerItems =
    announcementItems.length > 1 ? [...announcementItems, announcementItems[0]] : announcementItems;
  const tickerStepPercent = tickerItems.length > 0 ? 100 / tickerItems.length : 100;
  const tickerCounter =
    announcementItems.length > 0 ? (announcementIndex % announcementItems.length) + 1 : 0;

  useEffect(() => {
    if (announcementItems.length <= 1) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setAnnouncementIndex((current) => current + 1);
    }, ANNOUNCEMENT_ROTATION_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [announcementItems.length]);

  useEffect(() => {
    if (announcementItems.length <= 1 || announcementIndex < announcementItems.length) {
      return;
    }

    const resetTimeoutId = window.setTimeout(() => {
      setTickerTransitionEnabled(false);
      setAnnouncementIndex(0);
    }, ANNOUNCEMENT_TRANSITION_MS);

    return () => {
      window.clearTimeout(resetTimeoutId);
    };
  }, [announcementIndex, announcementItems.length]);

  useEffect(() => {
    if (tickerTransitionEnabled) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setTickerTransitionEnabled(true);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [tickerTransitionEnabled]);

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label={kickerText}
      className="overflow-hidden rounded-[18px] border"
      style={{
        background: 'var(--hud-panel-elevated)',
        borderColor: 'var(--hud-border-soft)',
      }}
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <div
            className="text-[10px] font-bold tracking-[0.2em] text-[var(--hud-text-subtle)] uppercase"
            style={{ fontFamily: 'Tomorrow, sans-serif' }}
          >
            {kickerText}
          </div>
          <div className="text-muted-foreground mt-1 text-sm">{descriptionText}</div>
        </div>
        <div
          aria-label={`${kickerText} ${tickerCounter} / ${announcementItems.length}`}
          className="text-muted-foreground rounded-full bg-white/8 px-3 py-1 text-[10px] font-semibold dark:bg-white/6"
        >
          {tickerCounter} / {announcementItems.length}
        </div>
      </div>

      <div
        className="flex"
        style={{
          width: `${tickerItems.length * 100}%`,
          transform: `translateX(-${announcementIndex * tickerStepPercent}%)`,
          transition: tickerTransitionEnabled
            ? `transform ${ANNOUNCEMENT_TRANSITION_MS}ms ease`
            : 'none',
        }}
      >
        {tickerItems.map((announcement, index) => (
          <div
            key={`${announcement.id}-${index}`}
            className="shrink-0 p-3"
            style={{ width: `${100 / tickerItems.length}%` }}
          >
            <AnnouncementButton announcement={announcement} locale={locale} onClick={onClick} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SingleAnnouncementCard({
  announcement,
  locale,
  onClick,
}: {
  announcement: LocalizedAnnouncementItem;
  locale: string;
  onClick: (url: string) => void;
}) {
  return <AnnouncementButton announcement={announcement} locale={locale} onClick={onClick} />;
}
