// @vitest-environment happy-dom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProxyPage } from '@/components/ProxyPage';

const mockSaveConfig = vi.fn();
const mockToast = vi.fn();
const mockGatewayStatus = vi.fn();
const mockGatewayStart = vi.fn();
const mockGatewayStop = vi.fn();
const mockGenerateKey = vi.fn();
const mockGetProxyDiagnostics = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options?: { queryFn?: () => unknown }) => {
    if (typeof options?.queryFn === 'function') {
      return {
        data: mockGetProxyDiagnostics(),
        isLoading: false,
        isError: false,
        error: null,
      };
    }

    return {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
    };
  },
}));

vi.mock('@/hooks/useAppConfig', () => ({
  useAppConfig: () => ({
    config: {
      proxy: {
        enabled: false,
        port: 8045,
        api_key: 'sk-test',
        auto_start: false,
        backend_canary_enabled: true,
        parity_enabled: false,
        parity_shadow_enabled: false,
        parity_kill_switch: false,
        parity_no_go_mismatch_rate: 0.15,
        parity_no_go_error_rate: 0.4,
        scheduling_mode: 'balance',
        max_wait_seconds: 60,
        preferred_account_id: '',
        default_project_id: 'silver-orbit-5m7qc',
        circuit_breaker_enabled: true,
        circuit_breaker_backoff_steps: [60, 300],
        custom_mapping: {},
        anthropic_mapping: {},
        request_timeout: 120,
        upstream_proxy: {
          enabled: false,
          url: '',
        },
      },
    },
    isLoading: false,
    saveConfig: mockSaveConfig,
  }),
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('@/ipc/manager', () => ({
  ipc: {
    client: {
      gateway: {
        status: () => mockGatewayStatus(),
        start: (input: unknown) => mockGatewayStart(input),
        stop: () => mockGatewayStop(),
        generateKey: () => mockGenerateKey(),
      },
    },
  },
}));

vi.mock('@/actions/app', () => ({
  getProxyDiagnostics: () => mockGetProxyDiagnostics(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        'proxy.title': 'API Proxy',
        'proxy.description': 'Manage the local API proxy service.',
        'proxy.service.title': 'Service Status',
        'proxy.service.description': 'Control the local API proxy server.',
        'proxy.service.running': 'Running',
        'proxy.service.stopped': 'Stopped',
        'proxy.service.start': 'Start Service',
        'proxy.service.stop': 'Stop Service',
        'proxy.errors.toggleFailed': 'The proxy service could not be started or stopped safely.',
        'proxy.toast.toggleFailed': 'Proxy service action failed',
        'proxy.mapping.title': 'Model Mapping',
        'proxy.mapping.description': 'Map Claude models to Gemini models for routing.',
        'proxy.examples.title': 'Usage Examples',
        'proxy.examples.description': 'Example commands to call the local API proxy.',
        'proxy.diagnostics.title': 'Proxy Health & Metrics',
        'proxy.diagnostics.description':
          'Live request metrics, runtime capacity state, and proxy health signals.',
        'proxy.diagnostics.summary.totalRequests': 'Total Requests',
        'proxy.diagnostics.summary.successRate': 'Success Rate',
        'proxy.diagnostics.summary.successResponses': 'Successful Responses',
        'proxy.diagnostics.summary.errorResponses': 'Error Responses',
        'proxy.diagnostics.summary.avgLatency': 'Average Latency',
        'proxy.diagnostics.summary.activeAccounts': 'Active Accounts',
        'proxy.diagnostics.runtime.capacityTitle': 'Capacity State',
        'proxy.diagnostics.runtime.capacityHealthy':
          'The proxy currently reports healthy request capacity.',
        'proxy.diagnostics.runtime.capacityReason': `Current capacity reason: ${String(
          fallback ?? '',
        )}`,
        'proxy.diagnostics.runtime.retryAfter': 'Retry after',
        'proxy.diagnostics.runtime.rateLimitsTitle': 'Cooldown & Rate Limits',
        'proxy.diagnostics.runtime.rateLimitsSummary': 'Cooldown summary',
        'proxy.diagnostics.runtime.parityTitle': 'Parity Overview',
        'proxy.diagnostics.runtime.paritySummary': 'Parity summary',
        'proxy.diagnostics.runtime.parityCounters': 'Parity counters',
        'proxy.diagnostics.runtime.healthTitle': 'Service Health',
        'proxy.diagnostics.runtime.healthSummary': 'Proxy service state',
        'proxy.diagnostics.runtime.enabled': 'enabled',
        'proxy.diagnostics.runtime.disabled': 'disabled',
        'proxy.diagnostics.runtime.none': 'None',
        'proxy.diagnostics.runtime.lastErrorNone': 'No recent proxy error recorded.',
        'proxy.config.port': 'Listen Port',
        'proxy.config.timeout': 'Request Timeout',
        'proxy.config.api_key': 'API Key',
        'proxy.config.auto_start': 'Auto Start with App',
        'proxy.config.auto_start_desc': 'Start proxy service when application launches',
        'proxy.config.local_access': 'Local access:',
        'proxy.config.show_key': 'Show',
        'proxy.config.hide_key': 'Hide',
        'proxy.copy': 'Copy',
        'proxy.regenerate': 'Regenerate',
        'proxy.mapping.maps_to': 'Maps to',
        'proxy.mapping.restore': 'Restore Defaults',
      };

      return translations[key] ?? fallback ?? key;
    },
  }),
}));

describe('ProxyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGatewayStatus.mockResolvedValue({ running: false });
    mockGatewayStart.mockRejectedValue(new Error('socket hang up'));
    mockGatewayStop.mockResolvedValue(undefined);
    mockGenerateKey.mockResolvedValue({ api_key: 'sk-new' });
    mockSaveConfig.mockResolvedValue(undefined);
    mockGetProxyDiagnostics.mockReturnValue({
      status: {
        running: false,
        port: 8045,
        base_url: 'http://127.0.0.1:8045',
        active_accounts: 2,
      },
      serviceHealth: {
        id: 'proxy_server',
        label: 'API Proxy',
        state: 'ready',
        message: null,
        updatedAt: Date.now(),
      },
      metrics: {
        totalRequests: 12,
        successResponses: 10,
        errorResponses: 2,
        capacityRejects: 1,
        rateLimitEvents: 1,
        streamRequests: 3,
        avgLatencyMs: 123,
        lastRequestAt: Date.now(),
        lastError: null,
        modelBreakdown: {},
      },
      capacity: {
        reason: null,
        retryAfterSec: null,
      },
      rateLimits: {
        cooldownCount: 1,
        upstreamLockCount: 0,
        reasonSummary: {},
        nextRetryAt: null,
        nextRetrySec: null,
      },
      parity: {
        enabled: false,
        shadowEnabled: false,
        noGoBlocked: false,
        shadowComparisonCount: 0,
        shadowMismatchCount: 0,
        parityRequestCount: 0,
        parityErrorCount: 0,
      },
    });
  });

  it('shows a destructive toast and inline error when proxy toggle fails', async () => {
    render(React.createElement(ProxyPage));

    await userEvent.click(await screen.findByRole('switch', { name: 'Start Service' }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Proxy service action failed',
          description: 'The proxy service could not be started or stopped safely.',
          variant: 'destructive',
        }),
      );
    });

    expect(
      screen.getByText('The proxy service could not be started or stopped safely.'),
    ).toBeTruthy();
  });

  it('renders proxy diagnostics metrics', async () => {
    render(React.createElement(ProxyPage));

    expect(await screen.findByTestId('proxy-diagnostics-panel')).toBeTruthy();
    expect(screen.getByText('Proxy Health & Metrics')).toBeTruthy();
    expect(screen.getByText('Total Requests')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('83%')).toBeTruthy();
  });
});
