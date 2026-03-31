// @vitest-environment happy-dom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseAppConfig = vi.fn();
const mockSyncWithLocalTheme = vi.fn();
const mockSetAppLanguage = vi.fn();
const mockUpdateAppLanguage = vi.fn();

vi.mock('@/hooks/useAppConfig', () => ({
  useAppConfig: () => mockUseAppConfig(),
}));

vi.mock('@/actions/theme', () => ({
  syncWithLocalTheme: mockSyncWithLocalTheme,
}));

vi.mock('@/actions/language', () => ({
  setAppLanguage: mockSetAppLanguage,
  updateAppLanguage: mockUpdateAppLanguage,
}));

vi.mock('@tanstack/react-router', () => ({
  RouterProvider: () => React.createElement('div', null, 'router-shell'),
}));

vi.mock('@/utils/routes', () => ({
  router: {},
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();

  return {
    ...actual,
    useTranslation: () => ({
      i18n: {
        language: 'en',
      },
      t: (key: string, fallbackOrOptions?: string | Record<string, unknown>) =>
        typeof fallbackOrOptions === 'string'
          ? fallbackOrOptions
          : typeof fallbackOrOptions === 'object' && fallbackOrOptions
            ? String(fallbackOrOptions.defaultValue ?? key)
            : key,
    }),
    initReactI18next: {
      type: '3rdParty',
      init: () => undefined,
    },
  };
});

vi.mock('@/utils/appShortcuts', () => ({
  bindAppShortcuts: vi.fn(() => vi.fn()),
  dispatchAppShortcutEvent: vi.fn(),
  APP_SHORTCUT_EVENTS: {
    proxyStatusChanged: 'proxyStatusChanged',
    refreshGeminiAccounts: 'refreshGeminiAccounts',
    refreshCodexAccounts: 'refreshCodexAccounts',
  },
}));

describe('App bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows a loading spinner while config is loading', async () => {
    mockUseAppConfig.mockReturnValue({
      config: null,
      isLoading: true,
      saveConfig: vi.fn(async () => undefined),
    });

    const { App } = await import('@/App');
    render(React.createElement(App));

    expect(screen.queryByText('router-shell')).toBeNull();
    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders the router once config is ready', async () => {
    mockUseAppConfig.mockReturnValue({
      config: {
        language: 'en',
        theme: 'dark',
        managed_ide_target: 'antigravity',
        auto_startup: false,
        model_visibility: {},
        proxy: {
          enabled: false,
          auto_start: false,
          api_key: 'proxy-key',
          port: 8045,
          request_timeout: 120,
          upstream_proxy: { enabled: false, url: '' },
          anthropic_mapping: {},
        },
      },
      isLoading: false,
      saveConfig: vi.fn(async () => undefined),
    });

    const { App } = await import('@/App');
    render(React.createElement(App));

    expect(await screen.findByText('router-shell')).toBeInTheDocument();
  });
});
