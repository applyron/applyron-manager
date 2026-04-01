// @vitest-environment happy-dom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from '@/components/StatusBar';

const { mockUseQuery, mockUseMutation, mockUseQueryClient } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockUseMutation: vi.fn(),
  mockUseQueryClient: vi.fn(),
}));

const mockUseManagedIdeStatus = vi.fn();
const mockToast = vi.fn();
const classicStartMutate = vi.fn();
const classicStopMutate = vi.fn();
const codexStartMutate = vi.fn();
const codexStopMutate = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => mockUseQuery(options),
  useMutation: (options: unknown) => mockUseMutation(options),
  useQueryClient: () => mockUseQueryClient(),
}));

vi.mock('@/actions/process', () => ({
  isProcessRunning: vi.fn(),
  startManagedIde: vi.fn(),
  closeManagedIde: vi.fn(),
}));

vi.mock('@/hooks/useManagedIde', () => ({
  useManagedIdeStatus: (...args: unknown[]) => mockUseManagedIdeStatus(...args),
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'statusBar.toolsLabel': 'Araçlar',
        'statusBar.classicActionLabel': 'Gemini Uygulaması',
        'statusBar.codexActionLabel': 'Codex Uygulaması',
        'statusBar.classicShortLabel': 'Gemini',
        'statusBar.codexShortLabel': 'Codex',
        'statusBar.checking': 'Kontrol ediliyor',
        'statusBar.running': 'Çalışıyor',
        'statusBar.stopped': 'Durdu',
        'statusBar.toggleFailedTitle': 'Yönetilen IDE işlemi başarısız oldu',
        'statusBar.toggleFailedDescription': 'İstenen başlatma veya durdurma işlemi tamamlanamadı.',
        'proxy.errors.portInUse':
          'Seçilen API proxy portu başka bir işlem tarafından kullanılıyor.',
      };

      return translations[key] ?? key;
    },
  }),
}));

describe('StatusBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseQueryClient.mockReturnValue({
      invalidateQueries: vi.fn(),
    });

    mockUseQuery.mockReturnValue({
      data: true,
      isLoading: false,
    });

    mockUseMutation
      .mockReturnValueOnce({
        mutate: classicStartMutate,
        isPending: false,
      })
      .mockReturnValueOnce({
        mutate: classicStopMutate,
        isPending: false,
      })
      .mockReturnValueOnce({
        mutate: codexStartMutate,
        isPending: false,
      })
      .mockReturnValueOnce({
        mutate: codexStopMutate,
        isPending: false,
      });

    mockUseManagedIdeStatus.mockReturnValue({
      data: {
        isProcessRunning: true,
        session: { state: 'ready' },
      },
      isLoading: false,
    });
  });

  it('renders quick actions for both Gemini and Codex', () => {
    render(React.createElement(StatusBar));

    expect(screen.getByText('Araçlar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gemini Uygulaması' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Codex Uygulaması' })).toBeTruthy();
    expect(screen.queryByText('Gemini')).toBeNull();
    expect(screen.queryByText('Codex')).toBeNull();
    expect(screen.queryAllByText('Çalışıyor')).toHaveLength(0);
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        staleTime: 30_000,
        refetchInterval: 30_000,
        refetchOnWindowFocus: false,
        refetchIntervalInBackground: false,
      }),
    );
    expect(mockUseManagedIdeStatus).toHaveBeenCalledWith('vscode-codex', {
      enabled: true,
      refresh: false,
      refetchInterval: 300000,
    });
  });

  it('starts the classic app when pressed while stopped', () => {
    mockUseQuery.mockReturnValueOnce({
      data: false,
      isLoading: false,
    });

    render(React.createElement(StatusBar));

    fireEvent.click(screen.getByRole('button', { name: 'Gemini Uygulaması' }));

    expect(classicStartMutate).toHaveBeenCalledTimes(1);
    expect(classicStopMutate).not.toHaveBeenCalled();
  });

  it('stops the Codex app when pressed while running', () => {
    render(React.createElement(StatusBar));

    fireEvent.click(screen.getByRole('button', { name: 'Codex Uygulaması' }));

    expect(codexStopMutate).toHaveBeenCalledTimes(1);
    expect(codexStartMutate).not.toHaveBeenCalled();
  });

  it('shows a destructive toast when a toggle mutation fails', () => {
    render(React.createElement(StatusBar));
    const onError = mockUseMutation.mock.calls[0]?.[0]?.onError as
      | ((error: Error) => void)
      | undefined;

    onError?.(new Error('PROXY_PORT_IN_USE'));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Yönetilen IDE işlemi başarısız oldu',
        description: 'Seçilen API proxy portu başka bir işlem tarafından kullanılıyor.',
        variant: 'destructive',
      }),
    );
  });
});
