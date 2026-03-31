import { CloudAccountList } from '@/components/CloudAccountList';
import { createRouteErrorBoundary } from '@/components/RouteErrorState';
import { CodexAccountPanel } from '@/components/CodexAccountPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppConfig } from '@/hooks/useAppConfig';
import type { ManagedIdeTargetId } from '@/managedIde/types';
import { Loader2, Sparkles, SquareTerminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function AccountsPage() {
  const { t } = useTranslation();
  const { config, isLoading, isSaving, saveConfig } = useAppConfig();
  const targetId = config?.managed_ide_target ?? 'antigravity';

  const handleTabChange = (nextValue: string) => {
    if (!config) {
      return;
    }

    const nextTargetId: ManagedIdeTargetId =
      nextValue === 'vscode-codex' ? 'vscode-codex' : 'antigravity';
    if (nextTargetId === targetId) {
      return;
    }

    void saveConfig({
      ...config,
      managed_ide_target: nextTargetId,
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div
        className="rounded-2xl border px-6 py-6"
        style={{
          background: 'linear-gradient(180deg, var(--hud-panel-elevated), var(--hud-panel-alt))',
          borderColor: 'var(--hud-border-strong)',
          boxShadow: 'var(--hud-shadow)',
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1
              className="text-foreground text-[34px] font-bold tracking-tight"
              style={{ fontFamily: 'Tomorrow, sans-serif' }}
            >
              {t('cloud.title')}
            </h1>
            <p className="text-muted-foreground max-w-2xl text-sm">
              {t('cloud.descriptionCombined')}
            </p>
          </div>
          {isSaving ? (
            <div className="text-primary flex items-center text-sm">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('settings.save')}
            </div>
          ) : null}
        </div>
      </div>

      <Tabs value={targetId} onValueChange={handleTabChange} className="space-y-6">
        <TabsList
          className="mx-auto grid h-auto w-full max-w-[440px] grid-cols-2 rounded-[28px] border p-2"
          style={{
            background: 'linear-gradient(180deg, var(--hud-panel), var(--hud-panel-alt))',
            borderColor: 'var(--hud-border-soft)',
            boxShadow: 'var(--hud-shadow)',
          }}
        >
          <TabsTrigger
            value="antigravity"
            className="group text-foreground rounded-[22px] border border-transparent px-4 py-3 text-left transition-all duration-300 data-[state=active]:border-[var(--hud-success-soft-border)] data-[state=active]:bg-[var(--hud-panel-elevated)] data-[state=active]:shadow-[0_10px_30px_rgba(85,254,126,0.15)]"
            style={{ fontFamily: 'Tomorrow, sans-serif' }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-2xl border transition-colors duration-300 group-data-[state=active]:border-emerald-400/40"
                style={{
                  background: 'linear-gradient(135deg, rgba(85,254,126,0.20), rgba(4,210,89,0.08))',
                  borderColor: 'var(--hud-border-soft)',
                }}
              >
                <Sparkles className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="min-w-0">
                <div className="text-foreground text-[13px] font-bold tracking-[0.22em] uppercase">
                  {t('cloud.tabs.gemini')}
                </div>
                <div className="mt-1 text-[10px] font-medium tracking-[0.18em] text-[var(--hud-text-subtle)] uppercase">
                  Google AI Pool
                </div>
              </div>
            </div>
          </TabsTrigger>
          <TabsTrigger
            value="vscode-codex"
            className="group text-foreground rounded-[22px] border border-transparent px-4 py-3 text-left transition-all duration-300 data-[state=active]:border-sky-400/30 data-[state=active]:bg-[var(--hud-panel-elevated)] data-[state=active]:shadow-[0_10px_30px_rgba(141,235,255,0.14)]"
            style={{ fontFamily: 'Tomorrow, sans-serif' }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-2xl border transition-colors duration-300 group-data-[state=active]:border-sky-400/35"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(141,235,255,0.18), rgba(45,125,255,0.08))',
                  borderColor: 'var(--hud-border-soft)',
                }}
              >
                <SquareTerminal className="h-4 w-4 text-sky-500" />
              </div>
              <div className="min-w-0">
                <div className="text-foreground text-[13px] font-bold tracking-[0.22em] uppercase">
                  {t('cloud.tabs.codex')}
                </div>
                <div className="mt-1 text-[10px] font-medium tracking-[0.18em] text-[var(--hud-text-subtle)] uppercase">
                  VS Code Session
                </div>
              </div>
            </div>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="antigravity" className="mt-0">
          <CloudAccountList showOverviewHeader={false} />
        </TabsContent>

        <TabsContent value="vscode-codex" className="mt-0">
          <CodexAccountPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export const AccountsPageErrorBoundary = createRouteErrorBoundary('accounts-route-error-state');
