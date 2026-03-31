// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationsSettingsTab } from '@/components/settings/OperationsSettingsTab';

const mockListActivityEvents = vi.fn();
const mockPickExportBundlePath = vi.fn();
const mockPickImportBundleFile = vi.fn();
const mockExportBundle = vi.fn();
const mockPreviewImportBundle = vi.fn();
const mockApplyImportBundle = vi.fn();
const mockOpenLogDirectory = vi.fn();
const mockToast = vi.fn();

vi.mock('@/actions/operations', () => ({
  listActivityEvents: (input?: unknown) => mockListActivityEvents(input),
  pickExportBundlePath: (input?: unknown) => mockPickExportBundlePath(input),
  pickImportBundleFile: (input?: unknown) => mockPickImportBundleFile(input),
  exportBundle: (input: unknown) => mockExportBundle(input),
  previewImportBundle: (input: unknown) => mockPreviewImportBundle(input),
  applyImportBundle: (input: unknown) => mockApplyImportBundle(input),
}));

vi.mock('@/actions/system', () => ({
  openLogDirectory: () => mockOpenLogDirectory(),
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'settings.operations.dataPortability.title': 'Data Portability',
        'settings.operations.dataPortability.description': 'Portable account import and export.',
        'settings.operations.dataPortability.lastDirectory': 'Last used directory',
        'settings.operations.dataPortability.noDirectory': 'No export directory selected yet',
        'settings.operations.dataPortability.exportButton': 'Export Bundle',
        'settings.operations.dataPortability.importButton': 'Import Bundle',
        'settings.operations.shared.cancel': 'Cancel',
        'settings.operations.shared.legacy': 'Legacy',
        'settings.operations.shared.cloud': 'Cloud',
        'settings.operations.shared.codex': 'Codex',
        'settings.operations.export.title': 'Export Portable Bundle',
        'settings.operations.export.description': 'Protect the portable export with a password.',
        'settings.operations.export.targetFile': 'Target file',
        'settings.operations.export.password': 'Export password',
        'settings.operations.export.passwordPlaceholder': 'Enter a password for this bundle',
        'settings.operations.export.confirmButton': 'Create Export',
        'settings.operations.export.successTitle': 'Portable bundle exported',
        'settings.operations.export.failedTitle': 'Portable export failed',
        'settings.operations.export.failedDescription': 'The portable bundle could not be created.',
        'settings.operations.import.title': 'Import Portable Bundle',
        'settings.operations.import.description': 'Preview the bundle first.',
        'settings.operations.import.sourceFile': 'Source file',
        'settings.operations.import.password': 'Import password',
        'settings.operations.import.passwordPlaceholder': 'Enter the bundle password',
        'settings.operations.import.previewButton': 'Preview Import',
        'settings.operations.import.applyButton': 'Apply Merge Import',
        'settings.operations.import.mergeSummary': 'Merge plan',
        'settings.operations.import.successTitle': 'Portable bundle imported',
        'settings.operations.import.failedTitle': 'Portable import failed',
        'settings.operations.import.failedDescription': 'The portable bundle could not be applied.',
        'settings.operations.import.previewFailedTitle': 'Import preview failed',
        'settings.operations.import.previewFailedDescription':
          'The portable bundle preview could not be prepared.',
        'settings.operations.activity.title': 'Activity Log',
        'settings.operations.activity.description': 'Structured operator events.',
        'settings.operations.activity.loading': 'Loading recent activity...',
        'settings.operations.activity.empty': 'No activity events match the current filter.',
        'settings.operations.activity.loadMore': 'Load More',
        'settings.operations.activity.actionLine': `Action: ${String(
          options?.action ?? '',
        )} · Target: ${String(options?.target ?? '')}`,
        'settings.operations.activity.noTarget': 'No explicit target',
        'settings.operations.activity.outcomes.success': 'Success',
        'settings.operations.activity.outcomes.failure': 'Failure',
        'settings.operations.activity.outcomes.info': 'Info',
        'settings.operations.activity.categories.all': 'All',
        'settings.operations.activity.categories.cloud': 'Cloud',
        'settings.operations.activity.categories.codex': 'Codex',
        'settings.operations.activity.categories.proxy': 'Proxy',
        'settings.operations.activity.categories.update': 'Update',
        'settings.operations.activity.categories.operations': 'Operations',
        'action.openLogs': 'Open Log Directory',
      };

      if (key === 'settings.operations.export.successDescription') {
        return `Exported ${String(options?.legacy)} legacy, ${String(options?.cloud)} cloud, and ${String(options?.codex)} Codex records.`;
      }

      if (key === 'settings.operations.import.successDescription') {
        return `Imported ${String(options?.legacy)} legacy, ${String(options?.cloud)} cloud, and ${String(options?.codex)} Codex records.`;
      }

      if (key === 'settings.operations.import.mergeLine') {
        return `${String(options?.label)}: ${String(options?.created)} new / ${String(options?.updated)} updated`;
      }

      return translations[key] ?? key;
    },
  }),
}));

function renderOperationsTab() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <OperationsSettingsTab defaultExportPath="C:\\exports" />
    </QueryClientProvider>,
  );
}

describe('OperationsSettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListActivityEvents.mockResolvedValue({
      events: [
        {
          id: 'evt-1',
          occurredAt: Date.now(),
          category: 'proxy',
          action: 'start',
          target: 'proxy',
          outcome: 'success',
          message: 'Proxy started.',
          metadata: null,
        },
      ],
      nextOffset: null,
      total: 1,
    });
    mockPickExportBundlePath.mockResolvedValue({
      canceled: false,
      filePath: 'C:\\exports\\bundle.applyron-export',
    });
    mockPickImportBundleFile.mockResolvedValue({
      canceled: false,
      filePath: 'C:\\exports\\bundle.applyron-export',
    });
    mockExportBundle.mockResolvedValue({
      filePath: 'C:\\exports\\bundle.applyron-export',
      counts: {
        legacy: 1,
        cloud: 2,
        codex: 3,
      },
    });
    mockPreviewImportBundle.mockResolvedValue({
      previewId: 'preview-1',
      filePath: 'C:\\exports\\bundle.applyron-export',
      fileName: 'bundle.applyron-export',
      version: 'ApplyronPortableExportV1',
      exportedAt: Date.now(),
      appVersion: '0.10.0',
      counts: {
        legacy: 1,
        cloud: 2,
        codex: 1,
      },
      dedupe: {
        legacyMatches: 0,
        cloudMatches: 1,
        codexMatches: 0,
      },
      applyPlan: {
        legacyCreate: 1,
        legacyUpdate: 0,
        cloudCreate: 1,
        cloudUpdate: 1,
        codexCreate: 1,
        codexUpdate: 0,
      },
    });
    mockApplyImportBundle.mockResolvedValue({
      imported: {
        legacyCreated: 1,
        legacyUpdated: 0,
        cloudCreated: 1,
        cloudUpdated: 1,
        codexCreated: 1,
        codexUpdated: 0,
      },
    });
  });

  it('runs the export flow after choosing a target file', async () => {
    renderOperationsTab();

    expect(await screen.findByText('Activity Log')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Export Bundle' }));
    expect(await screen.findByText('Export Portable Bundle')).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Export password'), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Create Export' }));

    await waitFor(() => {
      expect(mockExportBundle).toHaveBeenCalledWith({
        filePath: 'C:\\exports\\bundle.applyron-export',
        password: 'secret-pass',
      });
    });
  });

  it('previews and applies an import bundle', async () => {
    renderOperationsTab();

    await userEvent.click(screen.getByRole('button', { name: 'Import Bundle' }));
    expect(await screen.findByText('Import Portable Bundle')).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Import password'), 'bundle-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Preview Import' }));

    expect(await screen.findByTestId('import-preview-summary')).toBeTruthy();
    expect(screen.getByText('Merge plan')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Apply Merge Import' }));

    await waitFor(() => {
      expect(mockApplyImportBundle).toHaveBeenCalledWith({ previewId: 'preview-1' });
    });
  });
});
