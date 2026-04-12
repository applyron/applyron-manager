import { getCodexEmailHint, getCodexWorkspaceFromAuthFile } from '../codexAuth';
import { getCodexChromeWorkspaceLabel } from '../codexChromeWorkspaceHints';
import {
  getCodexWorkspaceLabel,
  isCodexPersonalWorkspace,
  isCodexTeamPlan,
} from '../codexIdentity';
import type { CodexAuthFile, CodexWorkspaceSummary } from '../types';

export function getPreferredCodexEmail(
  authFile: CodexAuthFile,
  fallbackEmail?: string | null,
): string | null {
  return getCodexEmailHint(authFile) ?? fallbackEmail ?? null;
}

export function getResolvedCodexWorkspace(
  authFile: CodexAuthFile,
  planType?: string | null,
  fallbackEmail?: string | null,
): CodexWorkspaceSummary | null {
  const derivedWorkspace = getCodexWorkspaceFromAuthFile(authFile, { planType });
  if (!isCodexTeamPlan(planType)) {
    return derivedWorkspace;
  }

  const workspaceHint = getCodexChromeWorkspaceLabel(
    authFile.tokens?.account_id,
    getPreferredCodexEmail(authFile, fallbackEmail),
  );
  if (!workspaceHint || isCodexPersonalWorkspace({ id: workspaceHint, title: workspaceHint })) {
    return derivedWorkspace;
  }

  if (!derivedWorkspace) {
    return {
      id: authFile.tokens?.account_id ?? workspaceHint,
      title: workspaceHint,
      role: null,
      isDefault: false,
    };
  }

  if (derivedWorkspace.title === workspaceHint) {
    return derivedWorkspace;
  }

  return {
    ...derivedWorkspace,
    title: workspaceHint,
  };
}

function getWorkspaceSummaryFromSelection(input: {
  id: string;
  label: string;
  derivedWorkspace?: CodexWorkspaceSummary | null;
}): CodexWorkspaceSummary {
  return {
    id: input.id,
    title: input.label,
    role: input.derivedWorkspace?.role ?? null,
    isDefault:
      input.derivedWorkspace?.isDefault ??
      isCodexPersonalWorkspace({
        id: input.id,
        title: input.label,
      }),
  };
}

export function getPreferredPersistedWorkspace(input: {
  derivedWorkspace: CodexWorkspaceSummary | null;
  existingWorkspace?: CodexWorkspaceSummary | null;
  selectedWorkspace?: { id: string; label: string } | null;
}): CodexWorkspaceSummary | null {
  if (input.selectedWorkspace) {
    return getWorkspaceSummaryFromSelection({
      id: input.selectedWorkspace.id,
      label: input.selectedWorkspace.label,
      derivedWorkspace: input.derivedWorkspace,
    });
  }

  if (
    input.existingWorkspace &&
    !isCodexPersonalWorkspace(input.existingWorkspace) &&
    (!input.derivedWorkspace ||
      isCodexPersonalWorkspace(input.derivedWorkspace) ||
      !input.derivedWorkspace.title)
  ) {
    return input.existingWorkspace;
  }

  return input.derivedWorkspace ?? input.existingWorkspace ?? null;
}

export function hasCodexWorkspaceChanged(
  currentWorkspace: CodexWorkspaceSummary | null,
  nextWorkspace: CodexWorkspaceSummary | null,
): boolean {
  if (!currentWorkspace && !nextWorkspace) {
    return false;
  }

  if (!currentWorkspace || !nextWorkspace) {
    return true;
  }

  return (
    currentWorkspace.id !== nextWorkspace.id ||
    currentWorkspace.title !== nextWorkspace.title ||
    currentWorkspace.role !== nextWorkspace.role ||
    currentWorkspace.isDefault !== nextWorkspace.isDefault
  );
}

export function getCodexDuplicateIdentityDetail(
  authFile: CodexAuthFile,
  fallbackEmail?: string | null,
  planType?: string | null,
  workspace?: CodexWorkspaceSummary | null,
): string {
  const email = getPreferredCodexEmail(authFile, fallbackEmail);
  const workspaceLabel = getCodexWorkspaceLabel(
    workspace ?? getResolvedCodexWorkspace(authFile, planType, fallbackEmail),
  );

  if (email && workspaceLabel) {
    return `${email} (${workspaceLabel})`;
  }

  return email ?? workspaceLabel ?? authFile.tokens?.account_id ?? 'unknown';
}
