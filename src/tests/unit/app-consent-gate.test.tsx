// @vitest-environment happy-dom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      t: (key: string, fallbackOrOptions?: string | Record<string, unknown>) => {
        const translations: Record<string, string> = {
          'consent.title': 'Choose whether to enable anonymous error reports',
          'consent.enableTitle': 'Enable anonymous error reports',
          'consent.disableTitle': 'Keep error reporting off',
        };

        if (typeof fallbackOrOptions === 'string') {
          return translations[key] ?? fallbackOrOptions;
        }

        const defaultValue =
          typeof fallbackOrOptions === 'object' && fallbackOrOptions
            ? String(fallbackOrOptions.defaultValue ?? '')
            : '';

        return translations[key] ?? (defaultValue || key);
      },
    }),
    initReactI18next: {
      type: '3rdParty',
      init: () => undefined,
    },
  };
});

describe('App privacy consent gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.electronTest = undefined;
  });

  it('blocks the router until privacy consent is answered', async () => {
    const saveConfig = vi.fn(async () => undefined);
    mockUseAppConfig.mockReturnValue({
      config: {
        language: 'en',
        privacy_consent_asked: false,
        error_reporting_enabled: false,
      },
      isLoading: false,
      saveConfig,
    });

    const { App } = await import('@/App');
    render(React.createElement(App));

    expect(
      screen.getByText('Choose whether to enable anonymous error reports'),
    ).toBeInTheDocument();
    expect(screen.queryByText('router-shell')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Enable anonymous error reports/i }));

    await waitFor(() => {
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          privacy_consent_asked: true,
          error_reporting_enabled: true,
        }),
      );
    });
  });

  it('renders the router when privacy consent already exists', async () => {
    mockUseAppConfig.mockReturnValue({
      config: {
        language: 'en',
        privacy_consent_asked: true,
        error_reporting_enabled: false,
      },
      isLoading: false,
      saveConfig: vi.fn(async () => undefined),
    });

    const { App } = await import('@/App');
    render(React.createElement(App));

    expect(await screen.findByText('router-shell')).toBeInTheDocument();
  });

  it('renders the router in packaged E2E mode even when privacy consent is not saved yet', async () => {
    window.electronTest = {
      setOrpcTestMode: vi.fn(),
      getOrpcTestMode: vi.fn(() => null),
    };

    mockUseAppConfig.mockReturnValue({
      config: {
        language: 'en',
        privacy_consent_asked: false,
        error_reporting_enabled: false,
      },
      isLoading: false,
      saveConfig: vi.fn(async () => undefined),
    });

    const { App } = await import('@/App');
    render(React.createElement(App));

    expect(await screen.findByText('router-shell')).toBeInTheDocument();
    expect(screen.queryByText('Choose whether to enable anonymous error reports')).toBeNull();
  });
});
