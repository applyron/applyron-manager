import { useTheme } from '@/components/theme-provider';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { getAppVersion, getPlatform } from '@/actions/app';
import { useTranslation } from 'react-i18next';
import { setAppLanguage } from '@/actions/language';
import { useAppConfig } from '@/hooks/useAppConfig';
import { useManagedIdeTargets } from '@/hooks/useManagedIde';
import { Loader2, FolderOpen } from 'lucide-react';
import { ModelVisibilitySettings } from '@/components/ModelVisibilitySettings';
import { useEffect, useState } from 'react';
import { ProxyConfig } from '@/types/config';
import { openLogDirectory } from '@/actions/system';
import type { ManagedIdeTargetId } from '@/managedIde/types';
import { cn } from '@/lib/utils';
import { APP_LICENSE_NAME, getPlatformDisplayName } from '@/config/appMetadata';
import { useToast } from '@/components/ui/use-toast';
import { getLocalizedErrorMessage } from '@/utils/errorMessages';
import {
  APP_SHORTCUT_DEFINITIONS,
  getAppShortcutLabel,
  isMacLikePlatform,
} from '@/utils/appShortcuts';
import { OperationsSettingsTab } from '@/components/settings/OperationsSettingsTab';

export function SettingsPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { config, isLoading, saveConfig } = useAppConfig();
  const { data: managedIdeTargets = [], isLoading: isManagedIdeTargetsLoading } =
    useManagedIdeTargets();

  // Local state for configuration editing
  const [proxyConfig, setProxyConfig] = useState<ProxyConfig | undefined>(undefined);

  // Sync config to local state when loaded
  useEffect(() => {
    if (config) {
      // eslint-disable-next-line
      setProxyConfig(config.proxy);
    }
  }, [config]);

  const { data: appVersion } = useQuery({
    queryKey: ['app', 'version'],
    queryFn: getAppVersion,
    staleTime: Infinity,
  });

  const { data: platform } = useQuery({
    queryKey: ['app', 'platform'],
    queryFn: getPlatform,
    staleTime: Infinity,
  });

  const isAutoStartSupported =
    platform === 'win32' || platform === 'darwin' || platform === 'linux';
  const isMac = platform === 'darwin';
  const isShortcutMac = isMacLikePlatform();
  const selectedTargetId = (config?.managed_ide_target ?? 'antigravity') as ManagedIdeTargetId;
  const managedIdeOptions = managedIdeTargets.map((target) => ({
    ...target,
    displayName:
      target.id === 'vscode-codex' ? target.displayName : t('settings.managedIde.antigravityLabel'),
    description:
      target.id === 'vscode-codex'
        ? t('settings.managedIde.codexDescription')
        : t('settings.managedIde.antigravityDescription'),
    scope:
      target.id === 'vscode-codex'
        ? t('settings.managedIde.codexScope')
        : t('settings.managedIde.antigravityScope'),
  }));

  const handleLanguageChange = async (value: string) => {
    setAppLanguage(value, i18n);
    if (config) {
      await saveConfig({ ...config, language: value });
    }
  };

  const handleManagedIdeTargetChange = async (value: string) => {
    if (!config) {
      return;
    }

    await saveConfig({
      ...config,
      managed_ide_target: value as ManagedIdeTargetId,
    });
  };

  const handleDarkModeChange = async (checked: boolean) => {
    const nextTheme = checked ? 'dark' : 'light';
    setTheme(nextTheme);

    if (config) {
      await saveConfig({
        ...config,
        theme: nextTheme,
      });
    }
  };

  // Helper to update proxyConfig and auto-save
  const updateProxyConfig = async (newProxyConfig: ProxyConfig) => {
    setProxyConfig(newProxyConfig);
    if (config) {
      await saveConfig({ ...config, proxy: newProxyConfig });
    }
  };

  const handleOpenLogDirectory = async () => {
    try {
      await openLogDirectory();
    } catch (error) {
      toast({
        title: t('action.openLogs'),
        description: getLocalizedErrorMessage(error, t),
        variant: 'destructive',
      });
    }
  };

  if (isLoading || !proxyConfig) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-5 p-6" data-testid="settings-page">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t('settings.title')}</h2>
        <p className="text-muted-foreground mt-1">{t('settings.description')}</p>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="general">{t('settings.general', 'General')}</TabsTrigger>
          <TabsTrigger value="models">{t('settings.models', 'Models')}</TabsTrigger>
          <TabsTrigger value="proxy">{t('settings.proxy_tab', 'Proxy')}</TabsTrigger>
          <TabsTrigger value="operations">{t('settings.operations.tab', 'Operations')}</TabsTrigger>
        </TabsList>

        {/* --- GENERAL TAB --- */}
        <TabsContent value="general" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.appearance.title')}</CardTitle>
              <CardDescription>{t('settings.appearance.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between space-x-2">
                <div className="space-y-1">
                  <Label htmlFor="dark-mode">{t('settings.darkMode')}</Label>
                  <p className="text-muted-foreground text-sm">
                    {t('settings.darkModeDescription')}
                  </p>
                </div>
                <Switch
                  id="dark-mode"
                  checked={resolvedTheme === 'dark'}
                  onCheckedChange={(checked) => {
                    void handleDarkModeChange(checked);
                  }}
                />
              </div>

              <div className="flex items-center justify-between space-x-2">
                <div className="space-y-1">
                  <Label htmlFor="language">{t('settings.language.title')}</Label>
                  <p className="text-muted-foreground text-sm">
                    {t('settings.language.description')}
                  </p>
                </div>
                <Select
                  value={i18n.language}
                  onValueChange={handleLanguageChange}
                  key={i18n.language}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t('settings.language.title')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">{t('settings.language.english')}</SelectItem>
                    <SelectItem value="tr">{t('settings.language.turkish')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="managed-ide-target">{t('settings.managedIde.title')}</Label>
                  <p className="text-muted-foreground text-sm">
                    {t('settings.managedIde.description')}
                  </p>
                </div>

                <div className="bg-muted/40 rounded-xl border px-4 py-3">
                  <div className="text-foreground text-sm font-medium">
                    {t('settings.managedIde.selectionHintTitle')}
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t('settings.managedIde.selectionHint')}
                  </p>
                </div>

                <div id="managed-ide-target" className="grid gap-3 md:grid-cols-2">
                  {managedIdeOptions.map((target) => {
                    const isSelected = target.id === selectedTargetId;
                    const isUnavailable = !target.installation.available;
                    const statusLabel = target.installation.available
                      ? t('settings.managedIde.ready')
                      : t(`managedIde.availability.${target.installation.reason}`);

                    return (
                      <button
                        key={target.id}
                        type="button"
                        aria-pressed={isSelected}
                        disabled={(isUnavailable && !isSelected) || isManagedIdeTargetsLoading}
                        onClick={() => {
                          void handleManagedIdeTargetChange(target.id);
                        }}
                        className={cn(
                          'rounded-xl border p-4 text-left transition-all',
                          'disabled:cursor-not-allowed disabled:opacity-60',
                          isSelected
                            ? 'border-primary bg-primary/5 shadow-sm'
                            : 'hover:border-primary/40 hover:bg-accent/30',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-foreground text-sm font-semibold">
                              {target.displayName}
                            </div>
                            <p className="text-muted-foreground mt-1 text-xs">
                              {target.description}
                            </p>
                          </div>
                          <Badge
                            className={cn(
                              'shrink-0 border-0',
                              target.installation.available
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'bg-muted text-muted-foreground',
                            )}
                          >
                            {statusLabel}
                          </Badge>
                        </div>

                        <div className="mt-3">
                          <div className="text-[10px] font-bold tracking-[0.18em] text-[var(--hud-text-subtle)] uppercase">
                            {t('settings.managedIde.controls')}
                          </div>
                          <p className="text-foreground mt-1 text-xs">{target.scope}</p>
                        </div>

                        {isSelected ? (
                          <div className="text-primary mt-3 text-xs font-medium">
                            {t('settings.managedIde.selected')}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {isAutoStartSupported && (
            <Card>
              <CardHeader>
                <CardTitle>{t('settings.startup.title', 'Startup')}</CardTitle>
                <CardDescription>
                  {t(
                    'settings.startup.description',
                    'Control application launch behavior at system startup.',
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-1">
                    <Label>{t('settings.startup.auto_startup', 'Start with system')}</Label>
                    <p className="text-muted-foreground text-xs">
                      {t(
                        'settings.startup.auto_startup_desc',
                        'Launch at sign-in and keep the app in the system tray',
                      )}
                    </p>
                  </div>
                  <Switch
                    checked={config?.auto_startup || false}
                    onCheckedChange={async (checked) => {
                      if (config) {
                        await saveConfig({ ...config, auto_startup: checked });
                      }
                    }}
                  />
                </div>
                {isMac && (
                  <p className="text-muted-foreground text-xs">
                    {t(
                      'settings.startup.macos_hint',
                      'macOS requires a signed app for Login Items to work. If auto-start fails, please sign the app or enable it manually in System Settings.',
                    )}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.about.title')}</CardTitle>
              <CardDescription>{t('settings.about.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="text-muted-foreground">{t('settings.version')}</div>
                <div className="font-medium">{appVersion || 'Unknown'}</div>

                <div className="text-muted-foreground">{t('settings.platform')}</div>
                <div className="font-medium">{getPlatformDisplayName(platform)}</div>

                <div className="text-muted-foreground">{t('settings.license')}</div>
                <div className="font-medium">{APP_LICENSE_NAME}</div>

                <div className="text-muted-foreground">{t('action.openLogs')}</div>
                <button
                  onClick={() => {
                    void handleOpenLogDirectory();
                  }}
                  className="text-primary hover:text-primary/80 flex items-center gap-2 font-medium"
                >
                  <FolderOpen className="h-4 w-4" />
                  <span>{t('settings.openLogDir', 'Open')}</span>
                </button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.shortcuts.title')}</CardTitle>
              <CardDescription>{t('settings.shortcuts.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {APP_SHORTCUT_DEFINITIONS.map((shortcut) => (
                <div
                  key={shortcut.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
                >
                  <div className="text-foreground text-sm">{t(shortcut.translationKey)}</div>
                  <kbd className="bg-muted text-foreground rounded-md border px-2 py-1 font-mono text-xs">
                    {getAppShortcutLabel(shortcut.id, isShortcutMac)}
                  </kbd>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- MODELS TAB --- */}
        <TabsContent value="models" className="space-y-5">
          <ModelVisibilitySettings />
        </TabsContent>

        {/* --- PROXY TAB (Upstream Proxy Config Only) --- */}
        <TabsContent value="proxy" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.proxy.title')}</CardTitle>
              <CardDescription>{t('settings.proxy.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between space-x-2">
                <div className="space-y-1">
                  <Label htmlFor="upstream-proxy-enabled">{t('settings.proxy.enable')}</Label>
                </div>
                <Switch
                  id="upstream-proxy-enabled"
                  checked={proxyConfig.upstream_proxy.enabled}
                  onCheckedChange={(checked) =>
                    updateProxyConfig({
                      ...proxyConfig,
                      upstream_proxy: { ...proxyConfig.upstream_proxy, enabled: checked },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="upstream-proxy-url">{t('settings.proxy.url')}</Label>
                <Input
                  id="upstream-proxy-url"
                  placeholder="http://127.0.0.1:7890"
                  value={proxyConfig.upstream_proxy.url}
                  onChange={(e) =>
                    updateProxyConfig({
                      ...proxyConfig,
                      upstream_proxy: { ...proxyConfig.upstream_proxy, url: e.target.value },
                    })
                  }
                  disabled={!proxyConfig.upstream_proxy.enabled}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="operations" className="space-y-5">
          <OperationsSettingsTab defaultExportPath={config?.default_export_path ?? null} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
