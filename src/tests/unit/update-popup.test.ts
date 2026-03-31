import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdatePopup } from '@/components/UpdatePopup';
import type { AppUpdateStatus } from '@/types/dashboard';

const mockInstallDownloadedUpdate = vi.fn();
const mockToast = vi.fn();
let currentUpdateStatus: AppUpdateStatus | undefined;

vi.mock('@/actions/app', () => ({
  installDownloadedUpdate: () => mockInstallDownloadedUpdate(),
}));

vi.mock('@/hooks/useAppUpdateStatus', () => ({
  APP_UPDATE_STATUS_QUERY_KEY: ['app', 'update-status'],
  useAppUpdateStatus: () => ({
    data: currentUpdateStatus,
    isError: false,
    error: null,
  }),
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'a11y.close': 'Close',
        'dashboard.update.title': 'Application Updates',
        'dashboard.update.laterButton': 'Later',
        'dashboard.update.restartButton': 'Restart and install',
        'dashboard.update.downloadingTitle': 'Update downloading',
        'dashboard.update.readyTitle': 'Update ready to install',
      };

      if (key === 'dashboard.update.downloadingDescription') {
        return `Version ${String(options?.version)} is downloading in the background.`;
      }

      if (key === 'dashboard.update.readyDescription') {
        return `Version ${String(options?.version)} has been downloaded.`;
      }

      return translations[key] ?? key;
    },
  }),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function renderPopup() {
  const queryClient = createQueryClient();

  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(UpdatePopup),
    ),
  );
}

describe('UpdatePopup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();

    currentUpdateStatus = {
      status: 'ready_to_install',
      currentVersion: '0.10.0',
      latestVersion: '0.10.1',
      lastCheckedAt: Date.now(),
      message: null,
    };

    mockInstallDownloadedUpdate.mockResolvedValue(currentUpdateStatus);
  });

  it('shows a restart button when the update is ready to install', async () => {
    renderPopup();

    expect(await screen.findByText('Update ready to install')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Restart and install' }));

    await waitFor(() => {
      expect(mockInstallDownloadedUpdate).toHaveBeenCalledTimes(1);
    });
  });

  it('shows a download-in-progress popup without the restart action', async () => {
    currentUpdateStatus = {
      status: 'update_available',
      currentVersion: '0.10.0',
      latestVersion: '0.10.1',
      lastCheckedAt: Date.now(),
      message: null,
    };

    renderPopup();

    expect(await screen.findByText('Update downloading')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restart and install' })).toBeNull();
  });

  it('keeps the popup dismissed after remount for the same state key', async () => {
    const view = renderPopup();

    expect(await screen.findByText('Update ready to install')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Later' }));

    await waitFor(() => {
      expect(screen.queryByText('Update ready to install')).toBeNull();
    });

    view.unmount();
    renderPopup();

    await waitFor(() => {
      expect(screen.queryByText('Update ready to install')).toBeNull();
    });

    expect(window.localStorage.getItem('applyron:update-popup-dismissed')).toBe(
      'ready_to_install:0.10.1',
    );
  });

  it('reopens the popup when the state key changes', async () => {
    const view = renderPopup();

    expect(await screen.findByText('Update ready to install')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Later' }));

    await waitFor(() => {
      expect(screen.queryByText('Update ready to install')).toBeNull();
    });

    currentUpdateStatus = {
      status: 'update_available',
      currentVersion: '0.10.0',
      latestVersion: '0.10.1',
      lastCheckedAt: Date.now(),
      message: null,
    };

    view.rerender(
      React.createElement(
        QueryClientProvider,
        { client: createQueryClient() },
        React.createElement(UpdatePopup),
      ),
    );

    expect(await screen.findByText('Update downloading')).toBeTruthy();
  });
});
