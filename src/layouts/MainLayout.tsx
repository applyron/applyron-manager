import React, { useEffect, useMemo } from 'react';
import { RouteErrorState } from '@/components/RouteErrorState';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { StatusBar } from '@/components/StatusBar';
import { UpdatePopup } from '@/components/UpdatePopup';
import { useAppUpdateStatus } from '@/hooks/useAppUpdateStatus';
import { LayoutDashboard, Network, Settings, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from 'react-error-boundary';
import { getAppVersion } from '@/actions/app';
import appIcon from '@/assets/icon.png';
import { useToast } from '@/components/ui/use-toast';
import { getAppShortcutLabel, isMacLikePlatform, type AppShortcutId } from '@/utils/appShortcuts';
import { useConnectivityStatus } from '@/hooks/useConnectivityStatus';

export const MainLayout: React.FC = () => {
  const location = useLocation();
  const { t } = useTranslation();
  const { toast } = useToast();
  const connectivityStatus = useConnectivityStatus();
  const appName = t('appName', 'Applyron Manager');
  const [brandPrimary, ...brandSecondaryParts] = useMemo(() => appName.split(' '), [appName]);
  const brandSecondary = brandSecondaryParts.join(' ') || 'Manager';
  const isMac = isMacLikePlatform();
  useAppUpdateStatus({ owner: true });
  const { data: appVersion } = useQuery({
    queryKey: ['app', 'version'],
    queryFn: getAppVersion,
    staleTime: 300_000,
  });

  const navItems = [
    {
      to: '/',
      icon: LayoutDashboard,
      label: t('nav.dashboard'),
      shortcutId: 'dashboard' as AppShortcutId,
    },
    {
      to: '/accounts',
      icon: Users,
      label: t('nav.accounts'),
      shortcutId: 'accounts' as AppShortcutId,
    },
    {
      to: '/proxy',
      icon: Network,
      label: t('nav.proxy', 'API Proxy'),
      shortcutId: 'proxy' as AppShortcutId,
    },
    {
      to: '/settings',
      icon: Settings,
      label: t('nav.settings'),
      shortcutId: 'settings' as AppShortcutId,
    },
  ];

  useEffect(() => {
    return window.electron?.onAppAlreadyRunning?.(() => {
      toast({
        title: t('app.alreadyRunning.title', 'Applyron Manager is already running'),
        description: t(
          'app.alreadyRunning.description',
          'The existing window was focused instead of starting a second instance.',
        ),
      });
    });
  }, [t, toast]);

  return (
    <div className="bg-background text-foreground flex h-screen overflow-hidden pb-[-1px]">
      <div className="flex flex-1 overflow-hidden">
        <aside
          className="glass-sidebar relative z-10 flex w-[118px] shrink-0 flex-col px-4 py-6"
          style={{
            minHeight: '100vh',
            borderRight: '1px solid var(--hud-border-strong)',
          }}
        >
          <div className="mb-8 flex flex-col items-center px-1 text-center">
            <div
              className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl shadow-lg"
              style={{
                boxShadow: '0 16px 32px var(--hud-success-soft-bg)',
                background: 'var(--hud-panel-alt)',
                border: '1px solid var(--hud-border-soft)',
              }}
            >
              <img
                src={appIcon}
                alt={appName}
                className="h-full w-full object-cover"
                draggable={false}
              />
            </div>

            <div className="mt-3">
              <div
                className="text-[13px] font-bold uppercase"
                style={{
                  color: 'hsl(var(--foreground))',
                  fontFamily: 'Tomorrow, sans-serif',
                  letterSpacing: '0.18em',
                }}
              >
                {brandPrimary}
              </div>
              <div
                className="mt-1 text-[10px] uppercase"
                style={{
                  color: 'var(--hud-text-subtle)',
                  fontFamily: 'Tomorrow, sans-serif',
                  letterSpacing: '0.16em',
                }}
              >
                {brandSecondary}
              </div>
            </div>

            <div
              className="mt-3 rounded-full border px-2 py-1 text-[9px] font-semibold"
              style={{
                background: 'var(--hud-panel-alt)',
                borderColor: 'var(--hud-border-soft)',
                color: 'var(--hud-text-subtle)',
              }}
            >
              {appVersion ?? '—'}
            </div>
          </div>

          <nav className="flex flex-1 flex-col items-center gap-2">
            {navItems.map((item) => {
              const isActive =
                item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);

              return (
                <Link
                  key={item.to}
                  to={item.to}
                  title={`${item.label} (${getAppShortcutLabel(item.shortcutId, isMac)})`}
                  className={cn(
                    'flex w-full flex-col items-center justify-center gap-1.5 rounded-2xl px-3 py-3 text-center transition-all duration-200',
                    isActive
                      ? 'text-primary shadow-sm'
                      : 'hover:text-foreground text-[var(--hud-text-subtle)]',
                  )}
                  style={{
                    background: isActive ? 'var(--hud-panel-alt)' : 'transparent',
                    border: isActive
                      ? '1px solid var(--hud-success-soft-border)'
                      : '1px solid transparent',
                  }}
                >
                  <item.icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.5 : 1.5} />
                  <span
                    className="text-[9px] font-bold tracking-wider uppercase"
                    style={{
                      fontFamily: 'Tomorrow, sans-serif',
                      textTransform: 'uppercase',
                    }}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--hud-border-soft)' }}>
            <StatusBar />
          </div>
        </aside>

        <main className="bg-background relative flex-1 overflow-auto">
          <ErrorBoundary
            resetKeys={[location.pathname]}
            fallbackRender={({ error, resetErrorBoundary }) => (
              <RouteErrorState
                error={error}
                onRetry={resetErrorBoundary}
                testId="layout-error-state"
              />
            )}
          >
            <UpdatePopup />
            {connectivityStatus === 'offline' ? (
              <div
                className="sticky top-0 z-20 border-b px-6 py-3"
                data-testid="offline-banner"
                style={{
                  background: 'var(--hud-warning-soft-bg)',
                  borderColor: 'var(--hud-warning-soft-border)',
                }}
              >
                <div className="text-foreground text-sm font-semibold">
                  {t('app.offline.title')}
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {t('app.offline.description')}
                </div>
              </div>
            ) : null}
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
};
