import { useTranslation } from 'react-i18next';
import { ipc } from '@/ipc/manager';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '@/hooks/useAppConfig';
import { ProxyConfig } from '@/types/config';
import { getLocalizedErrorMessage } from '@/utils/errorMessages';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  Copy,
  CheckCircle,
  Zap,
  Cpu,
  Sparkles,
  BrainCircuit,
  Code,
  Terminal,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { getHudTone } from '@/utils/hudTone';
import { APP_SHORTCUT_EVENTS } from '@/utils/appShortcuts';
import { getProxyDiagnostics } from '@/actions/app';

type ProxyProtocol = 'openai' | 'anthropic';

interface ExampleModel {
  id: string;
  name: string;
  icon: ReactNode;
}

const EXAMPLE_MODELS: ExampleModel[] = [
  { id: 'gemini-3-flash', name: 'Gemini 3 Flash', icon: <Zap size={14} /> },
  { id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro (Low)', icon: <Cpu size={14} /> },
  { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro (High)', icon: <Cpu size={14} /> },
  {
    id: 'claude-sonnet-4-6-thinking',
    name: 'Claude Sonnet 4.6 (Thinking)',
    icon: <Sparkles size={14} />,
  },
  {
    id: 'claude-opus-4-6-thinking',
    name: 'Claude Opus 4.6 (Thinking)',
    icon: <BrainCircuit size={14} />,
  },
];

const ANTHROPIC_ROUTE_OPTIONS = [
  'claude-sonnet-4-6-thinking',
  'claude-opus-4-6-thinking',
  'gemini-3-flash',
  'gemini-3.1-pro-low',
  'gemini-3.1-pro-high',
] as const;

const DEFAULT_ANTHROPIC_MAPPING: Record<string, string> = {
  'claude-sonnet-4-6-20260219': 'claude-sonnet-4-6-thinking',
  'claude-sonnet-4-5-20250929': 'claude-sonnet-4-6-thinking',
  'claude-opus-4-6-20260201': 'claude-opus-4-6-thinking',
  opus: 'claude-opus-4-6-thinking',
};

const HUD_HEADER_STYLE = {
  background: 'linear-gradient(180deg, var(--hud-panel), var(--hud-panel-alt))',
  borderColor: 'var(--hud-border-strong)',
};

const HUD_CARD_STYLE = {
  background: 'var(--hud-panel)',
  borderColor: 'var(--hud-border-soft)',
};

const HUD_ALT_SURFACE_STYLE = {
  background: 'var(--hud-panel-alt)',
  borderColor: 'var(--hud-border-soft)',
};

const HUD_CODE_SURFACE_STYLE = {
  background: 'var(--hud-code-bg)',
  borderColor: 'var(--hud-border-soft)',
};

const HUD_SUCCESS_PANEL_STYLE = {
  background: 'var(--hud-success-soft-bg)',
  borderColor: 'var(--hud-success-soft-border)',
};

const HUD_INFO_PANEL_STYLE = {
  background: 'var(--hud-info-soft-bg)',
  borderColor: 'var(--hud-info-soft-border)',
};

const HUD_DANGER_PANEL_STYLE = {
  background: 'var(--hud-danger-soft-bg)',
  borderColor: 'var(--hud-danger-soft-border)',
};

function resolveAnthropicMappingValue(
  anthropicMapping: Record<string, string>,
  keys: string[],
  fallback: string,
): string {
  for (const key of keys) {
    const value = anthropicMapping[key];
    if (value) {
      return value;
    }
  }

  return fallback;
}

function formatMetricValue(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function DiagnosticsStatCard({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string | number;
  valueStyle?: CSSProperties;
}) {
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{
        background: 'var(--hud-panel)',
        borderColor: 'var(--hud-border-soft)',
      }}
    >
      <div className="text-[10px] font-bold tracking-widest text-[var(--hud-text-subtle)] uppercase">
        {label}
      </div>
      <div className="text-foreground mt-1 text-lg font-semibold" style={valueStyle}>
        {value}
      </div>
    </div>
  );
}

export function ProxyPage() {
  const { t } = useTranslation();
  const { config, isLoading, saveConfig } = useAppConfig();
  const { toast } = useToast();
  const [proxyConfig, setProxyConfig] = useState<ProxyConfig | undefined>(undefined);
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [isTogglingService, setIsTogglingService] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);

  useEffect(() => {
    if (!config) {
      return;
    }

    const syncServerStatus = async () => {
      try {
        const status = await ipc.client.gateway.status();
        const actualEnabled = status.running;

        if (config.proxy.enabled !== actualEnabled) {
          const syncedConfig = { ...config.proxy, enabled: actualEnabled };
          setProxyConfig(syncedConfig);
          await saveConfig({ ...config, proxy: syncedConfig });
        } else {
          setProxyConfig(config.proxy);
        }
      } catch {
        setProxyConfig(config.proxy);
      }
    };

    void syncServerStatus();
  }, [config, saveConfig]);

  useEffect(() => {
    const handleProxyStatusChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean; errorMessage?: string | null }>)
        .detail;
      if (!detail) {
        return;
      }

      setProxyConfig((previous) =>
        previous && typeof detail.enabled === 'boolean'
          ? { ...previous, enabled: detail.enabled }
          : previous,
      );
      setServiceError(detail.errorMessage ?? null);
    };

    window.addEventListener(APP_SHORTCUT_EVENTS.proxyStatusChanged, handleProxyStatusChanged);
    return () => {
      window.removeEventListener(APP_SHORTCUT_EVENTS.proxyStatusChanged, handleProxyStatusChanged);
    };
  }, []);

  const updateProxyConfig = async (newProxyConfig: ProxyConfig) => {
    setProxyConfig(newProxyConfig);
    if (config) {
      await saveConfig({ ...config, proxy: newProxyConfig });
    }
  };

  const [selectedProtocol, setSelectedProtocol] = useState<ProxyProtocol>('openai');
  const [activeModelTab, setActiveModelTab] = useState('gemini-3.1-pro-high');
  const [copied, setCopied] = useState<string | null>(null);
  const diagnosticsQuery = useQuery({
    queryKey: ['gateway', 'diagnostics'],
    queryFn: getProxyDiagnostics,
    staleTime: 2_000,
    refetchInterval: 5_000,
  });

  const apiKey = proxyConfig?.api_key || 'YOUR_API_KEY';
  const baseUrl = `http://127.0.0.1:${proxyConfig?.port || 8045}`;
  const diagnostics = diagnosticsQuery.data;
  const successRate = diagnostics
    ? diagnostics.metrics.totalRequests === 0
      ? 100
      : Math.round((diagnostics.metrics.successResponses / diagnostics.metrics.totalRequests) * 100)
    : null;

  const updateAnthropicMapping = (mappingPatch: Record<string, string>) => {
    if (!proxyConfig) {
      return;
    }

    void updateProxyConfig({
      ...proxyConfig,
      anthropic_mapping: {
        ...proxyConfig.anthropic_mapping,
        ...mappingPatch,
      },
    });
  };

  const toggleProxyService = async () => {
    if (!proxyConfig) {
      return;
    }

    setIsTogglingService(true);
    try {
      if (proxyConfig.enabled) {
        await ipc.client.gateway.stop();
        await updateProxyConfig({ ...proxyConfig, enabled: false });
      } else {
        await ipc.client.gateway.start({ port: proxyConfig.port });
        await updateProxyConfig({ ...proxyConfig, enabled: true });
      }
      setServiceError(null);
    } catch (error) {
      console.error(error);
      const description = getLocalizedErrorMessage(error, t, {
        fallbackKey: 'proxy.errors.toggleFailed',
      });
      setServiceError(description);
      toast({
        title: t('proxy.toast.toggleFailed'),
        description,
        variant: 'destructive',
      });
    } finally {
      setIsTogglingService(false);
    }
  };

  const copyToClipboard = (text: string, type: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const getCurlExample = (modelId: string) => {
    if (selectedProtocol === 'anthropic') {
      return `curl ${baseUrl}/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${apiKey}" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "${modelId}",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'`;
    }

    return `curl ${baseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{
    "model": "${modelId}",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`;
  };

  const getPythonExample = (modelId: string) => {
    if (selectedProtocol === 'anthropic') {
      return `from anthropic import Anthropic

client = Anthropic(
    base_url="${baseUrl}",
    api_key="${apiKey}"
)

response = client.messages.create(
    model="${modelId}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}]
)
print(response.content[0].text)`;
    }

    return `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}/v1",
    api_key="${apiKey}"
)

response = client.chat.completions.create(
    model="${modelId}",
    messages=[{"role": "user", "content": "Hello"}]
)
print(response.choices[0].message.content)`;
  };

  if (isLoading || !proxyConfig) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div className="rounded-2xl border px-6 py-6" style={HUD_HEADER_STYLE}>
        <div className="space-y-2">
          <h1
            className="text-foreground text-[34px] font-bold tracking-tight"
            style={{ fontFamily: 'Tomorrow, sans-serif' }}
          >
            {t('proxy.title', 'API Proxy')}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t('proxy.description', 'Manage the local API proxy service.')}
          </p>
        </div>

        {proxyConfig.enabled ? (
          <div className="mt-5 rounded-xl border px-4 py-3 text-sm" style={HUD_SUCCESS_PANEL_STYLE}>
            <div className="text-foreground flex flex-wrap items-center gap-2">
              <div className="font-semibold">{t('proxy.config.local_access', 'Local Access:')}</div>
              <code
                className="rounded px-2 py-1 font-mono select-all"
                style={{ color: getHudTone('success').text, background: 'var(--hud-code-bg)' }}
              >
                {baseUrl}/v1
              </code>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,380px)_1fr]">
        <div className="space-y-6">
          <section className="glass-card rounded-2xl p-6">
            <div className="mb-6">
              <h2
                className="text-[13px] font-bold tracking-widest text-[var(--hud-text-subtle)] uppercase"
                style={{ fontFamily: 'Tomorrow, sans-serif' }}
              >
                {t('proxy.service.title', 'Service Status')}
              </h2>
              <p className="text-muted-foreground mt-2 text-sm">
                {t('proxy.service.description', 'Control the local API proxy server.')}
              </p>
            </div>

            <div className="space-y-5">
              {serviceError ? (
                <div className="rounded-xl border px-4 py-3 text-sm" style={HUD_DANGER_PANEL_STYLE}>
                  {serviceError}
                </div>
              ) : null}
              <div
                className="flex items-center justify-between rounded-xl border p-4"
                style={HUD_ALT_SURFACE_STYLE}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      background: proxyConfig.enabled
                        ? getHudTone('success').solid
                        : getHudTone('danger').solid,
                      boxShadow: proxyConfig.enabled
                        ? getHudTone('success').glow
                        : getHudTone('danger').glow,
                    }}
                  />
                  <div>
                    <div className="text-foreground text-sm font-semibold">
                      {proxyConfig.enabled
                        ? t('proxy.service.running', 'Running')
                        : t('proxy.service.stopped', 'Stopped')}
                    </div>
                    <div className="text-muted-foreground text-[11px]">
                      {t(
                        'proxy.gateway.description',
                        'Local endpoint routing and protocol translation',
                      )}
                    </div>
                  </div>
                </div>
                <Switch
                  checked={proxyConfig.enabled}
                  onCheckedChange={() => {
                    void toggleProxyService();
                  }}
                  disabled={isTogglingService}
                  aria-label={
                    proxyConfig.enabled
                      ? t('proxy.service.stop', 'Stop Service')
                      : t('proxy.service.start', 'Start Service')
                  }
                  title={
                    proxyConfig.enabled
                      ? t('proxy.service.stop', 'Stop Service')
                      : t('proxy.service.start', 'Start Service')
                  }
                  className="data-[state=checked]:bg-[var(--hud-success)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-[11px] font-bold tracking-wider text-[var(--hud-text-subtle)] uppercase">
                    {t('proxy.config.port', 'Listen Port')}
                  </Label>
                  <Input
                    type="number"
                    value={proxyConfig.port}
                    onChange={(e) =>
                      void updateProxyConfig({
                        ...proxyConfig,
                        port: parseInt(e.target.value, 10) || 8045,
                      })
                    }
                    disabled={proxyConfig.enabled}
                    className="text-foreground border-[var(--hud-border-soft)] bg-[var(--hud-input-bg)] font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[11px] font-bold tracking-wider text-[var(--hud-text-subtle)] uppercase">
                    {t('proxy.config.timeout', 'Request Timeout')}
                  </Label>
                  <Input
                    type="number"
                    value={proxyConfig.request_timeout}
                    onChange={(e) =>
                      void updateProxyConfig({
                        ...proxyConfig,
                        request_timeout: parseInt(e.target.value, 10) || 120,
                      })
                    }
                    className="text-foreground border-[var(--hud-border-soft)] bg-[var(--hud-input-bg)] font-mono"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold tracking-wider text-[var(--hud-text-subtle)] uppercase">
                  {t('proxy.config.api_key', 'API Key')}
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      value={proxyConfig.api_key || ''}
                      readOnly
                      type={showKey ? 'text' : 'password'}
                      className="border-[var(--hud-border-soft)] bg-[var(--hud-input-bg)] pr-10 font-mono"
                      style={{ color: getHudTone('success').text }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 my-auto h-8 w-8"
                      onClick={() => setShowKey(!showKey)}
                      title={showKey ? t('proxy.config.hide_key') : t('proxy.config.show_key')}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="text-foreground hover:bg-accent/60 hover:text-primary border-[var(--hud-border-soft)] bg-[var(--hud-input-bg)]"
                    onClick={() => copyToClipboard(proxyConfig.api_key || '', 'key')}
                  >
                    {copied === 'key' ? (
                      <CheckCircle className="text-primary h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    className="text-foreground hover:bg-accent/60 border-[var(--hud-border-soft)] bg-[var(--hud-input-bg)]"
                    onClick={() => setIsRegenerateDialogOpen(true)}
                  >
                    {t('proxy.regenerate', 'Regenerate')}
                  </Button>
                </div>
              </div>

              <div
                className="flex items-center justify-between rounded-xl border p-4"
                style={HUD_ALT_SURFACE_STYLE}
              >
                <div className="space-y-1">
                  <Label className="text-foreground">
                    {t('proxy.config.auto_start', 'Auto Start with App')}
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    {t(
                      'proxy.config.auto_start_desc',
                      'Start proxy service when application launches',
                    )}
                  </p>
                </div>
                <Switch
                  checked={proxyConfig.auto_start}
                  onCheckedChange={(checked) =>
                    void updateProxyConfig({ ...proxyConfig, auto_start: checked })
                  }
                  className="data-[state=checked]:bg-[var(--hud-info)]"
                />
              </div>
            </div>
          </section>

          <Dialog open={isRegenerateDialogOpen} onOpenChange={setIsRegenerateDialogOpen}>
            <DialogContent style={HUD_CARD_STYLE}>
              <DialogHeader>
                <DialogTitle className="text-foreground">
                  {t('proxy.regenerateConfirm.title', 'Regenerate API Key?')}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {t(
                    'proxy.regenerateConfirm.description',
                    'This will invalidate the current API key immediately. Any applications using the old key will stop working.',
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsRegenerateDialogOpen(false)}>
                  {t('proxy.regenerateConfirm.cancel', 'Cancel')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    const result = await ipc.client.gateway.generateKey();
                    await updateProxyConfig({ ...proxyConfig, api_key: result.api_key });
                    setIsRegenerateDialogOpen(false);
                  }}
                >
                  {t('proxy.regenerateConfirm.confirm', 'Regenerate')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <section className="glass-card rounded-2xl p-6">
            <div className="mb-6">
              <h2
                className="text-[13px] font-bold tracking-widest text-[var(--hud-text-subtle)] uppercase"
                style={{ fontFamily: 'Tomorrow, sans-serif' }}
              >
                {t('proxy.mapping.title', 'Model Mapping')}
              </h2>
              <p className="text-muted-foreground mt-2 text-sm">
                {t('proxy.mapping.description', 'Map Claude models to Gemini models for routing.')}
              </p>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border p-4" style={HUD_INFO_PANEL_STYLE}>
                <div className="text-foreground mb-2 text-sm font-semibold">
                  Claude Sonnet 4.6 (Thinking)
                </div>
                <div className="text-muted-foreground mb-3 text-xs">
                  {t('proxy.mapping.maps_to', 'Maps to')}
                </div>
                <Select
                  value={resolveAnthropicMappingValue(
                    proxyConfig.anthropic_mapping,
                    ['claude-sonnet-4-6-20260219', 'claude-sonnet-4-5-20250929'],
                    'claude-sonnet-4-6-thinking',
                  )}
                  onValueChange={(value) =>
                    updateAnthropicMapping({
                      'claude-sonnet-4-6-20260219': value,
                      'claude-sonnet-4-5-20250929': value,
                    })
                  }
                >
                  <SelectTrigger className="text-foreground border-[var(--hud-border-soft)] bg-[var(--hud-input-bg)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="text-foreground" style={HUD_CARD_STYLE}>
                    {ANTHROPIC_ROUTE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-xl border p-4" style={HUD_DANGER_PANEL_STYLE}>
                <div className="text-foreground mb-2 text-sm font-semibold">
                  Claude Opus 4.6 (Thinking)
                </div>
                <div className="text-muted-foreground mb-3 text-xs">
                  {t('proxy.mapping.maps_to', 'Maps to')}
                </div>
                <Select
                  value={resolveAnthropicMappingValue(
                    proxyConfig.anthropic_mapping,
                    ['claude-opus-4-6-20260201', 'opus'],
                    'claude-opus-4-6-thinking',
                  )}
                  onValueChange={(value) =>
                    updateAnthropicMapping({
                      'claude-opus-4-6-20260201': value,
                      opus: value,
                    })
                  }
                >
                  <SelectTrigger className="text-foreground border-[var(--hud-border-soft)] bg-[var(--hud-input-bg)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="text-foreground" style={HUD_CARD_STYLE}>
                    {ANTHROPIC_ROUTE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end">
                <Button
                  variant="outline"
                  className="text-foreground hover:bg-accent/60 border-[var(--hud-border-soft)] bg-[var(--hud-input-bg)]"
                  onClick={() =>
                    void updateProxyConfig({
                      ...proxyConfig,
                      anthropic_mapping: { ...DEFAULT_ANTHROPIC_MAPPING },
                    })
                  }
                >
                  {t('proxy.mapping.restore', 'Restore Defaults')}
                </Button>
              </div>
            </div>
          </section>

          <section className="glass-card rounded-2xl p-6" data-testid="proxy-diagnostics-panel">
            <div className="mb-6">
              <h2
                className="text-[13px] font-bold tracking-widest text-[var(--hud-text-subtle)] uppercase"
                style={{ fontFamily: 'Tomorrow, sans-serif' }}
              >
                {t('proxy.diagnostics.title')}
              </h2>
              <p className="text-muted-foreground mt-2 text-sm">
                {t('proxy.diagnostics.description')}
              </p>
            </div>

            {diagnosticsQuery.isLoading ? (
              <div
                className="text-muted-foreground flex items-center rounded-xl border px-4 py-4 text-sm"
                style={HUD_ALT_SURFACE_STYLE}
              >
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('proxy.diagnostics.loading')}
              </div>
            ) : null}

            {diagnosticsQuery.isError ? (
              <div className="rounded-xl border px-4 py-4 text-sm" style={HUD_DANGER_PANEL_STYLE}>
                {getLocalizedErrorMessage(diagnosticsQuery.error, t, {
                  fallbackKey: 'proxy.diagnostics.loadFailed',
                })}
              </div>
            ) : null}

            {diagnostics ? (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <DiagnosticsStatCard
                    label={t('proxy.diagnostics.summary.totalRequests')}
                    value={formatMetricValue(diagnostics.metrics.totalRequests)}
                  />
                  <DiagnosticsStatCard
                    label={t('proxy.diagnostics.summary.successRate')}
                    value={successRate === null ? '—' : `${successRate}%`}
                    valueStyle={{ color: getHudTone('success').text }}
                  />
                  <DiagnosticsStatCard
                    label={t('proxy.diagnostics.summary.successResponses')}
                    value={formatMetricValue(diagnostics.metrics.successResponses)}
                  />
                  <DiagnosticsStatCard
                    label={t('proxy.diagnostics.summary.errorResponses')}
                    value={formatMetricValue(diagnostics.metrics.errorResponses)}
                    valueStyle={{ color: getHudTone('danger').text }}
                  />
                  <DiagnosticsStatCard
                    label={t('proxy.diagnostics.summary.avgLatency')}
                    value={`${Math.round(diagnostics.metrics.avgLatencyMs)} ms`}
                  />
                  <DiagnosticsStatCard
                    label={t('proxy.diagnostics.summary.activeAccounts')}
                    value={formatMetricValue(diagnostics.status.active_accounts)}
                  />
                </div>

                <div className="grid gap-3">
                  <div className="rounded-xl border px-4 py-4" style={HUD_ALT_SURFACE_STYLE}>
                    <div className="text-foreground text-sm font-semibold">
                      {t('proxy.diagnostics.runtime.capacityTitle')}
                    </div>
                    <div className="text-muted-foreground mt-2 text-sm">
                      {diagnostics.capacity.reason
                        ? t('proxy.diagnostics.runtime.capacityReason', {
                            reason: diagnostics.capacity.reason,
                          })
                        : t('proxy.diagnostics.runtime.capacityHealthy')}
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {t('proxy.diagnostics.runtime.retryAfter', {
                        seconds:
                          diagnostics.capacity.retryAfterSec ??
                          diagnostics.rateLimits.nextRetrySec ??
                          0,
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border px-4 py-4" style={HUD_ALT_SURFACE_STYLE}>
                    <div className="text-foreground text-sm font-semibold">
                      {t('proxy.diagnostics.runtime.rateLimitsTitle')}
                    </div>
                    <div className="text-muted-foreground mt-2 text-sm">
                      {t('proxy.diagnostics.runtime.rateLimitsSummary', {
                        cooldowns: diagnostics.rateLimits.cooldownCount,
                        upstreamLocks: diagnostics.rateLimits.upstreamLockCount,
                      })}
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {Object.entries(diagnostics.rateLimits.reasonSummary).length > 0
                        ? Object.entries(diagnostics.rateLimits.reasonSummary)
                            .map(([reason, count]) => `${reason}: ${count}`)
                            .join(' · ')
                        : t('proxy.diagnostics.runtime.none')}
                    </div>
                  </div>

                  <div className="rounded-xl border px-4 py-4" style={HUD_ALT_SURFACE_STYLE}>
                    <div className="text-foreground text-sm font-semibold">
                      {t('proxy.diagnostics.runtime.parityTitle')}
                    </div>
                    <div className="text-muted-foreground mt-2 text-sm">
                      {t('proxy.diagnostics.runtime.paritySummary', {
                        enabled: diagnostics.parity.enabled
                          ? t('proxy.diagnostics.runtime.enabled')
                          : t('proxy.diagnostics.runtime.disabled'),
                        shadow: diagnostics.parity.shadowEnabled
                          ? t('proxy.diagnostics.runtime.enabled')
                          : t('proxy.diagnostics.runtime.disabled'),
                        noGo: diagnostics.parity.noGoBlocked
                          ? t('proxy.diagnostics.runtime.enabled')
                          : t('proxy.diagnostics.runtime.disabled'),
                      })}
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {t('proxy.diagnostics.runtime.parityCounters', {
                        requests: diagnostics.parity.parityRequestCount,
                        mismatches: diagnostics.parity.shadowMismatchCount,
                        errors: diagnostics.parity.parityErrorCount,
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border px-4 py-4" style={HUD_ALT_SURFACE_STYLE}>
                    <div className="text-foreground text-sm font-semibold">
                      {t('proxy.diagnostics.runtime.healthTitle')}
                    </div>
                    <div className="text-muted-foreground mt-2 text-sm">
                      {t('proxy.diagnostics.runtime.healthSummary', {
                        state: t(`dashboard.health.states.${diagnostics.serviceHealth.state}`),
                        message:
                          diagnostics.serviceHealth.message ?? t('proxy.diagnostics.runtime.none'),
                      })}
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {diagnostics.metrics.lastError ??
                        t('proxy.diagnostics.runtime.lastErrorNone')}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <section className="glass-card rounded-2xl p-6">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h2
                className="text-[13px] font-bold tracking-widest text-[var(--hud-text-subtle)] uppercase"
                style={{ fontFamily: 'Tomorrow, sans-serif' }}
              >
                {t('proxy.examples.title', 'Usage Examples')}
              </h2>
              <p className="text-muted-foreground mt-2 text-sm">
                {t('proxy.examples.description', 'Example commands to call the local API proxy.')}
              </p>
            </div>
            <div className="rounded-lg border px-3 py-2 text-right" style={HUD_ALT_SURFACE_STYLE}>
              <div className="text-[10px] font-bold tracking-widest text-[var(--hud-text-subtle)] uppercase">
                {proxyConfig.enabled
                  ? t('proxy.service.running', 'Running')
                  : t('proxy.service.stopped', 'Stopped')}
              </div>
              <div className="mt-1 font-mono text-xs" style={{ color: getHudTone('info').text }}>
                {baseUrl}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <button
              type="button"
              className={`rounded-xl border p-4 text-left transition-all ${
                selectedProtocol === 'openai' ? 'shadow-md' : ''
              }`}
              style={{
                background:
                  selectedProtocol === 'openai'
                    ? 'var(--hud-success-soft-bg)'
                    : 'var(--hud-panel-alt)',
                borderColor:
                  selectedProtocol === 'openai'
                    ? 'var(--hud-success-soft-border)'
                    : 'var(--hud-border-soft)',
              }}
              onClick={() => setSelectedProtocol('openai')}
            >
              <div className="text-foreground mb-2 flex items-center gap-2 text-sm font-bold">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: getHudTone('success').solid }}
                />
                OpenAI Protocol
              </div>
              <code
                className="block rounded px-3 py-2 font-mono text-xs"
                style={{ background: 'var(--hud-code-bg)', color: getHudTone('info').text }}
              >
                POST /v1/chat/completions
              </code>
              <div className="text-muted-foreground mt-2 text-xs">Cursor, Windsurf, NextChat</div>
            </button>

            <button
              type="button"
              className={`rounded-xl border p-4 text-left transition-all ${
                selectedProtocol === 'anthropic' ? 'shadow-md' : ''
              }`}
              style={{
                background:
                  selectedProtocol === 'anthropic'
                    ? 'var(--hud-info-soft-bg)'
                    : 'var(--hud-panel-alt)',
                borderColor:
                  selectedProtocol === 'anthropic'
                    ? 'var(--hud-info-soft-border)'
                    : 'var(--hud-border-soft)',
              }}
              onClick={() => setSelectedProtocol('anthropic')}
            >
              <div className="text-foreground mb-2 flex items-center gap-2 text-sm font-bold">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: getHudTone('info').solid }}
                />
                Anthropic Protocol
              </div>
              <code
                className="block rounded px-3 py-2 font-mono text-xs"
                style={{ background: 'var(--hud-code-bg)', color: getHudTone('info').text }}
              >
                POST /v1/messages
              </code>
              <div className="text-muted-foreground mt-2 text-xs">Claude Code CLI</div>
            </button>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {EXAMPLE_MODELS.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => setActiveModelTab(model.id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                  activeModelTab === model.id ? 'text-foreground' : 'text-muted-foreground'
                }`}
                style={{
                  background: activeModelTab === model.id ? 'var(--hud-panel-alt)' : 'transparent',
                  borderColor:
                    activeModelTab === model.id ? 'var(--hud-border-strong)' : 'transparent',
                }}
              >
                {model.icon}
                {model.name}
              </button>
            ))}
          </div>

          <div className="mt-6 space-y-5">
            <div className="relative">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-foreground flex items-center gap-2 text-sm font-medium">
                  <Terminal className="h-4 w-4" />
                  cURL
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(getCurlExample(activeModelTab), 'curl')}
                  className="hover:text-primary flex items-center gap-1 text-xs"
                  style={{ color: getHudTone('info').text }}
                >
                  {copied === 'curl' ? (
                    <CheckCircle className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied === 'curl' ? t('proxy.copy', 'Copy') : t('proxy.copy', 'Copy')}
                </button>
              </div>
              <pre
                className="overflow-x-auto rounded-xl border p-4 font-mono text-[11px] whitespace-pre-wrap"
                style={{ ...HUD_CODE_SURFACE_STYLE, color: getHudTone('info').text }}
              >
                {getCurlExample(activeModelTab)}
              </pre>
            </div>

            <div className="relative">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-foreground flex items-center gap-2 text-sm font-medium">
                  <Code className="h-4 w-4" />
                  Python
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(getPythonExample(activeModelTab), 'python')}
                  className="hover:text-primary flex items-center gap-1 text-xs"
                  style={{ color: getHudTone('info').text }}
                >
                  {copied === 'python' ? (
                    <CheckCircle className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied === 'python' ? t('proxy.copy', 'Copy') : t('proxy.copy', 'Copy')}
                </button>
              </div>
              <pre
                className="overflow-x-auto rounded-xl border p-4 font-mono text-[11px] whitespace-pre-wrap"
                style={{ ...HUD_CODE_SURFACE_STYLE, color: getHudTone('success').text }}
              >
                {getPythonExample(activeModelTab)}
              </pre>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
