import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, FolderOpen, Loader2, ShieldEllipsis, Upload } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  applyImportBundle,
  exportBundle,
  listActivityEvents,
  pickExportBundlePath,
  pickImportBundleFile,
  previewImportBundle,
} from '@/actions/operations';
import { openLogDirectory } from '@/actions/system';
import type {
  ActivityEvent,
  ActivityEventCategory,
  ImportApplyResult,
  ImportPreviewSummary,
} from '@/types/operations';
import { getLocalizedErrorMessage } from '@/utils/errorMessages';

const ACTIVITY_QUERY_KEY = ['operations', 'activity'] as const;
const ACTIVITY_PAGE_SIZE = 50;

type ActivityFilter = 'all' | ActivityEventCategory;

function formatTimestamp(timestamp: number, language: string): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

function getOutcomeVariant(
  outcome: ActivityEvent['outcome'],
): 'default' | 'secondary' | 'destructive' {
  if (outcome === 'failure') {
    return 'destructive';
  }

  return outcome === 'success' ? 'default' : 'secondary';
}

function getCategoryLabel(
  t: ReturnType<typeof useTranslation>['t'],
  category: ActivityEventCategory,
): string {
  return t(`settings.operations.activity.categories.${category}`);
}

function getCodexImportRestoreSummary(
  result: ImportApplyResult,
  t: ReturnType<typeof useTranslation>['t'],
): string | null {
  const codexImported = result.imported.codexCreated + result.imported.codexUpdated;
  if (codexImported === 0) {
    return null;
  }

  switch (result.codexRestore.status) {
    case 'applied':
      return t('settings.operations.import.restoreApplied', {
        runtime:
          result.codexRestore.appliedRuntimeId === 'wsl-remote'
            ? t('managedIde.runtimes.wslRemote')
            : t('managedIde.runtimes.windowsLocal'),
      });
    case 'stored_only_runtime_selection_required':
      return t('settings.operations.import.restoreStoredOnlyRuntimeSelectionRequired');
    case 'stored_only_runtime_unavailable':
      return t('settings.operations.import.restoreStoredOnlyRuntimeUnavailable');
    case 'skipped_no_active_codex':
      return t('settings.operations.import.restoreSkippedNoActiveCodex');
    default:
      return null;
  }
}

function getCodexImportRestoreWarnings(
  result: ImportApplyResult,
  t: ReturnType<typeof useTranslation>['t'],
): string[] {
  return result.codexRestore.warnings.map((warning) => {
    if (warning === 'CODEX_IMPORT_MULTIPLE_ACTIVE_IMPORTED_ACCOUNTS') {
      return t('settings.operations.import.restoreWarningMultipleActive');
    }

    return warning;
  });
}

export function OperationsSettingsTab({
  defaultExportPath,
}: {
  defaultExportPath: string | null | undefined;
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activityLimit, setActivityLimit] = useState(ACTIVITY_PAGE_SIZE);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [exportPassword, setExportPassword] = useState('');
  const [exportTargetPath, setExportTargetPath] = useState<string | null>(null);
  const [importPassword, setImportPassword] = useState('');
  const [importFilePath, setImportFilePath] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreviewSummary | null>(null);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);

  const selectedCategories = useMemo<ActivityEventCategory[] | undefined>(
    () => (activityFilter === 'all' ? undefined : [activityFilter]),
    [activityFilter],
  );

  const activityQuery = useQuery({
    queryKey: [...ACTIVITY_QUERY_KEY, activityLimit, activityFilter],
    queryFn: () =>
      listActivityEvents({
        limit: activityLimit,
        categories: selectedCategories,
      }),
    staleTime: 5_000,
  });

  const exportMutation = useMutation({
    mutationFn: exportBundle,
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ACTIVITY_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['appConfig'] }),
      ]);
      toast({
        title: t('settings.operations.export.successTitle'),
        description: t('settings.operations.export.successDescription', {
          legacy: result.counts.legacy,
          cloud: result.counts.cloud,
          codex: result.counts.codex,
        }),
      });
      setIsExportDialogOpen(false);
      setExportPassword('');
      setExportTargetPath(null);
    },
    onError: (error) => {
      toast({
        title: t('settings.operations.export.failedTitle'),
        description: getLocalizedErrorMessage(error, t, {
          fallbackKey: 'settings.operations.export.failedDescription',
        }),
        variant: 'destructive',
      });
    },
  });

  const previewImportMutation = useMutation({
    mutationFn: previewImportBundle,
    onSuccess: (preview) => {
      setImportPreview(preview);
    },
    onError: (error) => {
      toast({
        title: t('settings.operations.import.previewFailedTitle'),
        description: getLocalizedErrorMessage(error, t, {
          fallbackKey: 'settings.operations.import.previewFailedDescription',
        }),
        variant: 'destructive',
      });
    },
  });

  const applyImportMutation = useMutation({
    mutationFn: applyImportBundle,
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ACTIVITY_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['appConfig'] }),
        queryClient.invalidateQueries({ queryKey: ['cloudAccounts'] }),
        queryClient.invalidateQueries({ queryKey: ['managedIde', 'codexAccounts'] }),
      ]);
      toast({
        title: t('settings.operations.import.successTitle'),
        description: [
          t('settings.operations.import.successDescription', {
            legacy: result.imported.legacyCreated + result.imported.legacyUpdated,
            cloud: result.imported.cloudCreated + result.imported.cloudUpdated,
            codex: result.imported.codexCreated + result.imported.codexUpdated,
          }),
          getCodexImportRestoreSummary(result, t),
          ...getCodexImportRestoreWarnings(result, t),
        ]
          .filter((message): message is string => Boolean(message))
          .join(' '),
      });
      closeImportDialog();
    },
    onError: (error) => {
      toast({
        title: t('settings.operations.import.failedTitle'),
        description: getLocalizedErrorMessage(error, t, {
          fallbackKey: 'settings.operations.import.failedDescription',
        }),
        variant: 'destructive',
      });
    },
  });

  const closeImportDialog = () => {
    setIsImportDialogOpen(false);
    setImportPassword('');
    setImportFilePath(null);
    setImportPreview(null);
    previewImportMutation.reset();
    applyImportMutation.reset();
  };

  const openExportFlow = async () => {
    const result = await pickExportBundlePath({
      defaultDirectory: defaultExportPath ?? null,
    });
    if (result.canceled || !result.filePath) {
      return;
    }

    setExportTargetPath(result.filePath);
    setExportPassword('');
    setIsExportDialogOpen(true);
  };

  const openImportFlow = async () => {
    const result = await pickImportBundleFile({
      defaultDirectory: defaultExportPath ?? null,
    });
    if (result.canceled || !result.filePath) {
      return;
    }

    setImportFilePath(result.filePath);
    setImportPassword('');
    setImportPreview(null);
    previewImportMutation.reset();
    applyImportMutation.reset();
    setIsImportDialogOpen(true);
  };

  const handleOpenLogs = async () => {
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

  const handleExportConfirm = () => {
    if (!exportTargetPath) {
      return;
    }

    exportMutation.mutate({
      filePath: exportTargetPath,
      password: exportPassword,
    });
  };

  const handleImportPreview = () => {
    if (!importFilePath) {
      return;
    }

    previewImportMutation.mutate({
      filePath: importFilePath,
      password: importPassword,
    });
  };

  const handleImportApply = () => {
    if (!importPreview) {
      return;
    }

    applyImportMutation.mutate({ previewId: importPreview.previewId });
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.operations.dataPortability.title')}</CardTitle>
          <CardDescription>{t('settings.operations.dataPortability.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border px-4 py-3">
            <div className="text-muted-foreground text-xs font-medium">
              {t('settings.operations.dataPortability.lastDirectory')}
            </div>
            <div className="text-foreground mt-1 text-sm break-all">
              {defaultExportPath || t('settings.operations.dataPortability.noDirectory')}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => {
                void openExportFlow();
              }}
            >
              <Download className="h-4 w-4" />
              {t('settings.operations.dataPortability.exportButton')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void openImportFlow();
              }}
            >
              <Upload className="h-4 w-4" />
              {t('settings.operations.dataPortability.importButton')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.operations.activity.title')}</CardTitle>
          <CardDescription>{t('settings.operations.activity.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(['all', 'cloud', 'codex', 'proxy', 'update', 'operations'] as const).map((filter) => (
              <Button
                key={filter}
                variant={activityFilter === filter ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => {
                  setActivityFilter(filter);
                  setActivityLimit(ACTIVITY_PAGE_SIZE);
                }}
              >
                {filter === 'all'
                  ? t('settings.operations.activity.categories.all')
                  : getCategoryLabel(t, filter)}
              </Button>
            ))}

            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => void handleOpenLogs()}
            >
              <FolderOpen className="h-4 w-4" />
              {t('action.openLogs')}
            </Button>
          </div>

          {activityQuery.isLoading ? (
            <div className="text-muted-foreground flex items-center rounded-lg border px-4 py-5 text-sm">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('settings.operations.activity.loading')}
            </div>
          ) : null}

          {!activityQuery.isLoading && (activityQuery.data?.events.length ?? 0) === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-sm">
              {t('settings.operations.activity.empty')}
            </div>
          ) : null}

          <div className="space-y-3">
            {(activityQuery.data?.events ?? []).map((event) => (
              <div
                key={event.id}
                className="rounded-lg border px-4 py-3"
                data-testid={`activity-event-${event.id}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{getCategoryLabel(t, event.category)}</Badge>
                  <Badge variant={getOutcomeVariant(event.outcome)}>
                    {t(`settings.operations.activity.outcomes.${event.outcome}`)}
                  </Badge>
                  <div className="text-muted-foreground ml-auto text-xs">
                    {formatTimestamp(event.occurredAt, i18n.language)}
                  </div>
                </div>
                <div className="text-foreground mt-3 text-sm font-medium">{event.message}</div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {t('settings.operations.activity.actionLine', {
                    action: event.action,
                    target: event.target ?? t('settings.operations.activity.noTarget'),
                  })}
                </div>
              </div>
            ))}
          </div>

          {activityQuery.data?.nextOffset !== null ? (
            <Button
              variant="outline"
              onClick={() => setActivityLimit((current) => current + ACTIVITY_PAGE_SIZE)}
            >
              {t('settings.operations.activity.loadMore')}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={isExportDialogOpen}
        onOpenChange={(open) => {
          setIsExportDialogOpen(open);
          if (!open) {
            setExportPassword('');
            setExportTargetPath(null);
            exportMutation.reset();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.operations.export.title')}</DialogTitle>
            <DialogDescription>{t('settings.operations.export.description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border px-4 py-3 text-sm">
              <div className="text-muted-foreground text-xs">
                {t('settings.operations.export.targetFile')}
              </div>
              <div className="text-foreground mt-1 break-all">{exportTargetPath}</div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="export-password">{t('settings.operations.export.password')}</Label>
              <Input
                id="export-password"
                type="password"
                value={exportPassword}
                onChange={(event) => setExportPassword(event.target.value)}
                placeholder={t('settings.operations.export.passwordPlaceholder')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsExportDialogOpen(false)}>
              {t('settings.operations.shared.cancel')}
            </Button>
            <Button onClick={handleExportConfirm} disabled={exportMutation.isPending}>
              {exportMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldEllipsis className="h-4 w-4" />
              )}
              {t('settings.operations.export.confirmButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isImportDialogOpen}
        onOpenChange={(open) => (!open ? closeImportDialog() : setIsImportDialogOpen(true))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.operations.import.title')}</DialogTitle>
            <DialogDescription>{t('settings.operations.import.description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border px-4 py-3 text-sm">
              <div className="text-muted-foreground text-xs">
                {t('settings.operations.import.sourceFile')}
              </div>
              <div className="text-foreground mt-1 break-all">{importFilePath}</div>
            </div>

            {!importPreview ? (
              <div className="space-y-2">
                <Label htmlFor="import-password">{t('settings.operations.import.password')}</Label>
                <Input
                  id="import-password"
                  type="password"
                  value={importPassword}
                  onChange={(event) => setImportPassword(event.target.value)}
                  placeholder={t('settings.operations.import.passwordPlaceholder')}
                />
              </div>
            ) : (
              <div className="space-y-4" data-testid="import-preview-summary">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border px-3 py-3">
                    <div className="text-muted-foreground text-xs">
                      {t('settings.operations.shared.legacy')}
                    </div>
                    <div className="text-foreground mt-1 text-lg font-semibold">
                      {importPreview.counts.legacy}
                    </div>
                  </div>
                  <div className="rounded-lg border px-3 py-3">
                    <div className="text-muted-foreground text-xs">
                      {t('settings.operations.shared.cloud')}
                    </div>
                    <div className="text-foreground mt-1 text-lg font-semibold">
                      {importPreview.counts.cloud}
                    </div>
                  </div>
                  <div className="rounded-lg border px-3 py-3">
                    <div className="text-muted-foreground text-xs">
                      {t('settings.operations.shared.codex')}
                    </div>
                    <div className="text-foreground mt-1 text-lg font-semibold">
                      {importPreview.counts.codex}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border px-4 py-3 text-sm">
                  <div className="text-foreground font-medium">
                    {t('settings.operations.import.mergeSummary')}
                  </div>
                  <div className="text-muted-foreground mt-2 space-y-1">
                    <div>
                      {t('settings.operations.import.mergeLine', {
                        label: t('settings.operations.shared.legacy'),
                        created: importPreview.applyPlan.legacyCreate,
                        updated: importPreview.applyPlan.legacyUpdate,
                      })}
                    </div>
                    <div>
                      {t('settings.operations.import.mergeLine', {
                        label: t('settings.operations.shared.cloud'),
                        created: importPreview.applyPlan.cloudCreate,
                        updated: importPreview.applyPlan.cloudUpdate,
                      })}
                    </div>
                    <div>
                      {t('settings.operations.import.mergeLine', {
                        label: t('settings.operations.shared.codex'),
                        created: importPreview.applyPlan.codexCreate,
                        updated: importPreview.applyPlan.codexUpdate,
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeImportDialog}>
              {t('settings.operations.shared.cancel')}
            </Button>
            {!importPreview ? (
              <Button onClick={handleImportPreview} disabled={previewImportMutation.isPending}>
                {previewImportMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {t('settings.operations.import.previewButton')}
              </Button>
            ) : (
              <Button onClick={handleImportApply} disabled={applyImportMutation.isPending}>
                {applyImportMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldEllipsis className="h-4 w-4" />
                )}
                {t('settings.operations.import.applyButton')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
