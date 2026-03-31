import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MainLayout } from '@/layouts/MainLayout';

const {
  mockUseLocation,
  mockOutletRender,
  mockUseAppUpdateStatus,
  mockUseConnectivityStatus,
  mockToast,
  mockOnAppAlreadyRunning,
} = vi.hoisted(() => ({
  mockUseLocation: vi.fn(),
  mockOutletRender: vi.fn(() => React.createElement('div', { 'data-testid': 'outlet' })),
  mockUseAppUpdateStatus: vi.fn(),
  mockUseConnectivityStatus: vi.fn(),
  mockToast: vi.fn(),
  mockOnAppAlreadyRunning: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) =>
    React.createElement('a', { href: to, ...props }, children),
  Outlet: () => mockOutletRender(),
  useLocation: () => mockUseLocation(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: '0.10.0',
  }),
}));

vi.mock('@/components/StatusBar', () => ({
  StatusBar: () => React.createElement('div', null, 'status-bar'),
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('@/actions/app', () => ({
  getAppVersion: vi.fn(),
}));

vi.mock('@/hooks/useAppUpdateStatus', () => ({
  useAppUpdateStatus: (options?: { owner?: boolean }) => mockUseAppUpdateStatus(options),
}));

vi.mock('@/hooks/useConnectivityStatus', () => ({
  useConnectivityStatus: () => mockUseConnectivityStatus(),
}));

vi.mock('@/components/UpdatePopup', () => ({
  UpdatePopup: () => React.createElement('div', { 'data-testid': 'update-popup' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        appName: 'Applyron Manager',
        'nav.dashboard': 'Dashboard',
        'nav.accounts': 'Accounts',
        'nav.proxy': 'API Proxy',
        'nav.settings': 'Settings',
        'app.alreadyRunning.title': 'Applyron Manager is already running',
        'app.alreadyRunning.description':
          'The existing window was focused instead of starting a second instance.',
        'app.offline.title': 'Offline mode is active',
        'app.offline.description':
          'Network-dependent actions are temporarily disabled. Local diagnostics, settings, and portability tools remain available.',
        'error.generic': 'An unexpected error occurred.',
        'action.retry': 'Retry',
      };

      return translations[key] ?? fallback ?? key;
    },
  }),
}));

describe('MainLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnAppAlreadyRunning.mockImplementation((callback: () => void) => {
      (mockOnAppAlreadyRunning as unknown as { lastCallback?: () => void }).lastCallback = callback;
      return vi.fn();
    });
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        onAppAlreadyRunning: mockOnAppAlreadyRunning,
      },
    });
    mockUseLocation.mockReturnValue({
      pathname: '/',
    });
    mockUseAppUpdateStatus.mockReturnValue({
      data: undefined,
      isError: false,
      error: null,
    });
    mockUseConnectivityStatus.mockReturnValue('online');
    mockOutletRender.mockImplementation(() =>
      React.createElement('div', { 'data-testid': 'outlet' }),
    );
  });

  it('renders the left navigation in dashboard-first order', () => {
    render(React.createElement(MainLayout));

    const links = screen.getAllByRole('link');

    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Dashboard',
      'Accounts',
      'API Proxy',
      'Settings',
    ]);

    expect(links[0].getAttribute('href')).toBe('/');
    expect(links[1].getAttribute('href')).toBe('/accounts');
    expect(links[2].getAttribute('href')).toBe('/proxy');
    expect(links[3].getAttribute('href')).toBe('/settings');
    expect(screen.getByRole('img', { name: 'Applyron Manager' })).toBeTruthy();
    expect(mockUseAppUpdateStatus).toHaveBeenCalledWith({ owner: true });
  });

  it('renders the inline fallback without emitting a duplicate toast when a route crashes', () => {
    mockOutletRender.mockImplementation(() => {
      throw new Error('Route crashed');
    });

    render(React.createElement(MainLayout));

    expect(screen.getAllByText('An unexpected error occurred.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('shows a warning toast when a second instance redirects to the active window', () => {
    render(React.createElement(MainLayout));

    const registeredCallback = (mockOnAppAlreadyRunning as unknown as { lastCallback?: () => void })
      .lastCallback;
    expect(registeredCallback).toBeTypeOf('function');

    registeredCallback?.();

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Applyron Manager is already running',
        description: 'The existing window was focused instead of starting a second instance.',
      }),
    );
  });

  it('renders a sticky offline banner when connectivity is lost', () => {
    mockUseConnectivityStatus.mockReturnValue('offline');

    render(React.createElement(MainLayout));

    expect(screen.getByTestId('offline-banner')).toBeTruthy();
    expect(screen.getByText('Offline mode is active')).toBeTruthy();
  });
});
