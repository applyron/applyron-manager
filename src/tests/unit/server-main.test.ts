import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapNestServer, isAllowedLoopbackOrigin, stopNestServer } from '../../server/main';

const mockEnableCors = vi.fn();
const mockListen = vi.fn(async () => undefined);
const mockClose = vi.fn(async () => undefined);
const mockMetricsReset = vi.fn();

vi.mock('../../server/app.module', () => ({
  AppModule: class AppModule {},
}));

vi.mock('@nestjs/core', () => ({
  NestFactory: {
    create: vi.fn(async () => ({
      enableCors: mockEnableCors,
      listen: mockListen,
      close: mockClose,
      get: vi.fn(() => ({
        reset: mockMetricsReset,
      })),
    })),
  },
}));

vi.mock('@nestjs/platform-fastify', () => ({
  FastifyAdapter: class FastifyAdapter {},
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('server main security hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows only loopback origins', () => {
    expect(isAllowedLoopbackOrigin(undefined)).toBe(true);
    expect(isAllowedLoopbackOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedLoopbackOrigin('http://127.0.0.1:3000')).toBe(true);
    expect(isAllowedLoopbackOrigin('https://localhost:5173')).toBe(false);
    expect(isAllowedLoopbackOrigin('https://evil.example')).toBe(false);
  });

  it('refuses to bootstrap without a proxy API key', async () => {
    await expect(
      bootstrapNestServer({
        enabled: true,
        port: 8045,
        api_key: '',
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
      }),
    ).resolves.toBe(false);

    expect(mockListen).not.toHaveBeenCalled();
    await stopNestServer();
  });

  it('binds the proxy server to 127.0.0.1 and applies the CORS gate', async () => {
    await expect(
      bootstrapNestServer({
        enabled: true,
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
      }),
    ).resolves.toBe(true);

    expect(mockListen).toHaveBeenCalledWith(8045, '127.0.0.1');

    const corsOptions = mockEnableCors.mock.calls[0][0];
    const allowCallback = vi.fn();
    corsOptions.origin('http://localhost:5173', allowCallback);
    expect(allowCallback).toHaveBeenCalledWith(null, true);

    const rejectCallback = vi.fn();
    corsOptions.origin('https://evil.example', rejectCallback);
    expect(rejectCallback.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(rejectCallback.mock.calls[0][1]).toBe(false);

    await stopNestServer();
  });
});
