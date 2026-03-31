import { installDownloadedUpdate } from '@/actions/app';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { APP_UPDATE_STATUS_QUERY_KEY, useAppUpdateStatus } from '@/hooks/useAppUpdateStatus';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getLocalizedErrorMessage } from '@/utils/errorMessages';

const UPDATE_POPUP_DISMISSED_STORAGE_KEY = 'applyron:update-popup-dismissed';

function getStoredDismissedStateKey(): string | null {
  try {
    return window.localStorage.getItem(UPDATE_POPUP_DISMISSED_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredDismissedStateKey(stateKey: string) {
  try {
    window.localStorage.setItem(UPDATE_POPUP_DISMISSED_STORAGE_KEY, stateKey);
  } catch {
    // Ignore storage failures and keep the current session responsive.
  }
}

export function UpdatePopup() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dismissedStateKey, setDismissedStateKey] = useState<string | null>(
    getStoredDismissedStateKey,
  );

  const updateStatusQuery = useAppUpdateStatus();

  const installMutation = useMutation({
    mutationFn: installDownloadedUpdate,
    onSuccess: (status) => {
      queryClient.setQueryData(APP_UPDATE_STATUS_QUERY_KEY, status);
    },
    onError: (error) => {
      toast({
        title: t('dashboard.update.title'),
        description: getLocalizedErrorMessage(error, t),
        variant: 'destructive',
      });
    },
  });

  const updateStatus = updateStatusQuery.data;
  const isDownloading = updateStatus?.status === 'update_available';
  const isReadyToInstall = updateStatus?.status === 'ready_to_install';
  const dialogStateKey = useMemo(
    () => `${updateStatus?.status ?? 'idle'}:${updateStatus?.latestVersion ?? ''}`,
    [updateStatus?.latestVersion, updateStatus?.status],
  );
  const dismissPopup = () => {
    setDismissedStateKey(dialogStateKey);
    setStoredDismissedStateKey(dialogStateKey);
  };

  if (!updateStatus || (!isDownloading && !isReadyToInstall)) {
    return null;
  }

  const isOpen = dismissedStateKey !== dialogStateKey;
  const versionText = updateStatus.latestVersion ?? updateStatus.currentVersion;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          dismissPopup();
        }
      }}
    >
      <DialogContent
        className="max-w-[420px]"
        style={{
          background: 'linear-gradient(180deg, var(--hud-panel), var(--hud-panel-alt))',
          borderColor: 'var(--hud-border-strong)',
          boxShadow: 'var(--hud-shadow)',
        }}
      >
        <DialogHeader>
          <DialogTitle
            className="text-foreground flex items-center gap-2"
            style={{ fontFamily: 'Tomorrow, sans-serif' }}
          >
            {isReadyToInstall ? (
              <Download className="h-4 w-4 text-emerald-500" />
            ) : (
              <RefreshCw className="h-4 w-4 animate-spin text-sky-500" />
            )}
            {isReadyToInstall
              ? t('dashboard.update.readyTitle')
              : t('dashboard.update.downloadingTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground leading-6">
            {isReadyToInstall
              ? t('dashboard.update.readyDescription', { version: versionText })
              : t('dashboard.update.downloadingDescription', { version: versionText })}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={dismissPopup}
            className="text-foreground hover:bg-accent/60 hover:text-primary border-[var(--hud-border-soft)] bg-transparent"
          >
            {t('dashboard.update.laterButton')}
          </Button>
          {isReadyToInstall ? (
            <Button
              type="button"
              onClick={() => installMutation.mutate()}
              disabled={installMutation.isPending}
              className="hud-success-cta border-none font-semibold shadow-lg shadow-emerald-500/20 transition-all hover:opacity-90"
            >
              {installMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {t('dashboard.update.restartButton')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
