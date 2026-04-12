import type { CodexRuntimeId, ManagedIdeInstallationStatus } from '../types';

export interface CodexGlobalStateHints {
  codexCloudAccess: string | null;
  defaultServiceTier: string | null;
  agentMode: string | null;
}

export interface CodexGlobalStateSnapshot extends CodexGlobalStateHints {
  rawValue: string | null;
  updatedAt: number | null;
}

export interface CodexGlobalStateMutationResult {
  ok: boolean;
  reason: 'success' | 'missing' | 'locked' | 'error';
}

export interface CodexRuntimeEnvironment {
  id: CodexRuntimeId;
  displayName: string;
  installation: ManagedIdeInstallationStatus;
  authFilePath: string | null;
  stateDbPath: string | null;
  storagePath: string | null;
  authLastUpdatedAt: number | null;
  extensionStateUpdatedAt: number | null;
  codexCliExecutionPath: string | null;
  wslDistroName?: string | null;
  wslLinuxHomePath?: string | null;
}

export interface CodexResolvedRuntimeSelection {
  runtimes: CodexRuntimeEnvironment[];
  activeRuntimeId: CodexRuntimeId | null;
  requiresRuntimeSelection: boolean;
}

export type CodexLiveApplyResult = {
  runtimeId: CodexRuntimeId;
  didRestartIde: boolean;
  deferredUntilIdeRestart: boolean;
};

export interface DeferredCodexRuntimeApply {
  runtimeId: CodexRuntimeId;
  recordId: string;
  requestedAt: number;
}

export interface DeferredRuntimeApplyStateBag {
  deferredRuntimeApply: DeferredCodexRuntimeApply | null;
  deferredRuntimeApplyTimer: ReturnType<typeof setTimeout> | null;
  deferredRuntimeApplyInFlight: boolean;
}
