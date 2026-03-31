import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalizedErrorMessage } from '@/utils/errorMessages';
import { openLogDirectory } from '@/actions/system';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';

vi.mock('@/actions/system', () => ({
  openLogDirectory: vi.fn(),
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(),
}));

function SettingsPageOpenLogActionHarness() {
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleOpenLogDirectory = async () => {
    try {
      await openLogDirectory();
    } catch (error) {
      toast({
        title: t('action.openLogs'),
        description: getLocalizedErrorMessage(error, t),
        variant: 'destructive',
      });
    }
  };

  return React.createElement(
    'button',
    {
      type: 'button',
      onClick: () => {
        void handleOpenLogDirectory();
      },
    },
    'Open',
  );
}

describe('SettingsPage log action', () => {
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useToast).mockReturnValue({
      toast: mockToast,
      dismiss: vi.fn(),
      toasts: [],
    });
    vi.mocked(useTranslation).mockReturnValue({
      i18n: { language: 'en' },
      t: (key: string) => {
        const translations: Record<string, string> = {
          'action.openLogs': 'Open Log Directory',
          'error.generic': 'An unexpected error occurred.',
        };

        return translations[key] ?? key;
      },
    } as ReturnType<typeof useTranslation>);
  });

  it('shows a destructive toast when opening the log directory fails', async () => {
    vi.mocked(openLogDirectory).mockRejectedValue(new Error('no handler'));

    render(React.createElement(SettingsPageOpenLogActionHarness));

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Open Log Directory',
          description: 'An unexpected error occurred.',
          variant: 'destructive',
        }),
      );
    });
  });
});
