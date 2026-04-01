import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isProcessRunning, startManagedIde, closeManagedIde } from '@/actions/process';
import { Button } from '@/components/ui/button';
import { Loader2, Power } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useManagedIdeStatus } from '@/hooks/useManagedIde';
import { useToast } from '@/components/ui/use-toast';
import { getLocalizedErrorMessage } from '@/utils/errorMessages';
import { getHudTone } from '@/utils/hudTone';

const CLASSIC_PROCESS_STATUS_REFETCH_INTERVAL_MS = 1000 * 30;
const CODEX_STATUS_REFETCH_INTERVAL_MS = 1000 * 60 * 5;

function QuickActionButton(props: {
  label: string;
  stateLabel: string;
  isRunning: boolean;
  isPending: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const tone = getHudTone(props.isRunning ? 'success' : 'danger');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={props.onClick}
          disabled={props.disabled || props.isPending}
          aria-label={props.label}
          title={props.label}
          className="h-11 w-11 rounded-xl border transition-opacity hover:opacity-90"
          style={{
            borderColor: tone.softBorder,
            background: tone.softBackground,
            color: tone.text,
          }}
        >
          {props.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Power className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-56">
        <p>{props.label}</p>
        <p className="text-muted-foreground text-xs">{props.stateLabel}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export const StatusBar: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: isClassicRunning, isLoading: isClassicLoading } = useQuery({
    queryKey: ['process', 'status', 'antigravity'],
    queryFn: () => isProcessRunning('antigravity'),
    staleTime: CLASSIC_PROCESS_STATUS_REFETCH_INTERVAL_MS,
    refetchInterval: CLASSIC_PROCESS_STATUS_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
  });
  const codexStatus = useManagedIdeStatus('vscode-codex', {
    enabled: true,
    refresh: false,
    refetchInterval: CODEX_STATUS_REFETCH_INTERVAL_MS,
  });

  const showToggleError = (error: unknown) => {
    toast({
      title: t('statusBar.toggleFailedTitle'),
      description: getLocalizedErrorMessage(error, t, {
        fallbackKey: 'statusBar.toggleFailedDescription',
      }),
      variant: 'destructive',
    });
  };

  const startClassicMutation = useMutation({
    mutationFn: () => startManagedIde('antigravity'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['process', 'status', 'antigravity'] });
    },
    onError: showToggleError,
  });

  const stopClassicMutation = useMutation({
    mutationFn: () => closeManagedIde('antigravity'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['process', 'status', 'antigravity'] });
    },
    onError: showToggleError,
  });

  const startCodexMutation = useMutation({
    mutationFn: () => startManagedIde('vscode-codex'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managedIde', 'status', 'vscode-codex'] });
      queryClient.invalidateQueries({ queryKey: ['managedIde', 'targets'] });
    },
    onError: showToggleError,
  });

  const stopCodexMutation = useMutation({
    mutationFn: () => closeManagedIde('vscode-codex'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managedIde', 'status', 'vscode-codex'] });
      queryClient.invalidateQueries({ queryKey: ['managedIde', 'targets'] });
    },
    onError: showToggleError,
  });

  const handleClassicToggle = () => {
    if (isClassicRunning) {
      stopClassicMutation.mutate();
    } else {
      startClassicMutation.mutate();
    }
  };

  const isCodexRunning = Boolean(codexStatus.data?.isProcessRunning);
  const handleCodexToggle = () => {
    if (isCodexRunning) {
      stopCodexMutation.mutate();
    } else {
      startCodexMutation.mutate();
    }
  };

  const isClassicPending = startClassicMutation.isPending || stopClassicMutation.isPending;
  const isCodexPending = startCodexMutation.isPending || stopCodexMutation.isPending;

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className="rounded-2xl border px-2 py-3"
        style={{
          background: 'var(--hud-panel)',
          borderColor: 'var(--hud-border-soft)',
        }}
      >
        <div className="hud-label text-center">{t('statusBar.toolsLabel')}</div>

        <div className="mt-3 flex flex-col items-center gap-2">
          <QuickActionButton
            label={t('statusBar.classicActionLabel')}
            stateLabel={
              isClassicLoading
                ? t('statusBar.checking')
                : isClassicRunning
                  ? t('statusBar.running')
                  : t('statusBar.stopped')
            }
            isRunning={Boolean(isClassicRunning)}
            isPending={isClassicPending}
            onClick={handleClassicToggle}
            disabled={isClassicLoading}
          />
          <QuickActionButton
            label={t('statusBar.codexActionLabel')}
            stateLabel={
              codexStatus.isLoading
                ? t('statusBar.checking')
                : isCodexRunning
                  ? t('statusBar.running')
                  : t('statusBar.stopped')
            }
            isRunning={isCodexRunning}
            isPending={isCodexPending}
            onClick={handleCodexToggle}
            disabled={codexStatus.isLoading}
          />
        </div>
      </div>
    </TooltipProvider>
  );
};
