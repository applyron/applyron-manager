// @vitest-environment happy-dom
import React, { useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_STORAGE_KEYS } from '@/constants';
import { syncWithLocalTheme } from '@/actions/theme';
import { setAppLanguage, updateAppLanguage } from '@/actions/language';
import { ipc } from '@/ipc/manager';
import { useTranslation } from 'react-i18next';

const {
  mockSyncWithLocalTheme,
  mockSetAppLanguage,
  mockUpdateAppLanguage,
  mockConfigLoad,
  mockUseTranslation,
} = vi.hoisted(() => ({
  mockSyncWithLocalTheme: vi.fn(),
  mockSetAppLanguage: vi.fn(),
  mockUpdateAppLanguage: vi.fn(),
  mockConfigLoad: vi.fn(),
  mockUseTranslation: vi.fn(),
}));

vi.mock('@/actions/theme', () => ({
  syncWithLocalTheme: mockSyncWithLocalTheme,
}));

vi.mock('@/actions/language', () => ({
  setAppLanguage: mockSetAppLanguage,
  updateAppLanguage: mockUpdateAppLanguage,
}));

vi.mock('@/ipc/manager', () => ({
  ipc: {
    client: {
      config: {
        load: mockConfigLoad,
      },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: mockUseTranslation,
}));

function AppBootstrapHarness() {
  const { i18n } = useTranslation();

  useEffect(() => {
    void syncWithLocalTheme();
  }, []);

  useEffect(() => {
    let active = true;

    const storedLanguage = localStorage.getItem(LOCAL_STORAGE_KEYS.LANGUAGE);
    if (!storedLanguage) {
      ipc.client.config
        .load()
        .then((config: { language?: string } | undefined) => {
          if (!active) {
            return;
          }
          setAppLanguage(config?.language || 'tr', i18n);
        })
        .catch(() => {
          if (!active) {
            return;
          }
          setAppLanguage('tr', i18n);
        });
    } else {
      updateAppLanguage(i18n);
      if (window.electron?.changeLanguage) {
        window.electron.changeLanguage(i18n.language);
      }
    }

    return () => {
      active = false;
    };
  }, [i18n]);

  return React.createElement('div', { 'data-testid': 'bootstrap-harness' });
}

describe('App bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
    document.documentElement.lang = '';
    window.electron = {
      ...(window.electron ?? {}),
      changeLanguage: vi.fn(),
    };
    mockUseTranslation.mockReturnValue({
      t: ((key: string) => key) as ReturnType<typeof useTranslation>['t'],
      i18n: {
        language: 'en',
        changeLanguage: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as ReturnType<typeof useTranslation>);
  });

  it('syncs theme immediately and uses stored language without loading config', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.LANGUAGE, 'en');

    render(React.createElement(AppBootstrapHarness));

    await waitFor(() => {
      expect(mockSyncWithLocalTheme).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateAppLanguage).toHaveBeenCalledTimes(1);
    expect(mockConfigLoad).not.toHaveBeenCalled();
    expect(window.electron.changeLanguage).toHaveBeenCalledWith('en');
  });

  it('loads config when no stored language exists and falls back to config language', async () => {
    mockConfigLoad.mockResolvedValue({ language: 'tr' });

    render(React.createElement(AppBootstrapHarness));

    await waitFor(() => {
      expect(mockSetAppLanguage).toHaveBeenCalledWith(
        'tr',
        expect.objectContaining({ language: 'en' }),
      );
    });
    expect(mockUpdateAppLanguage).not.toHaveBeenCalled();
  });

  it('falls back to Turkish when config loading fails', async () => {
    mockConfigLoad.mockRejectedValue(new Error('Config unavailable'));

    render(React.createElement(AppBootstrapHarness));

    await waitFor(() => {
      expect(mockSetAppLanguage).toHaveBeenCalledWith(
        'tr',
        expect.objectContaining({ language: 'en' }),
      );
    });
  });
});
