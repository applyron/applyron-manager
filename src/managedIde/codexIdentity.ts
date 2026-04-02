import type { CodexAccountRecord, CodexWorkspaceSummary } from './types';

type CodexWorkspaceLike =
  | (Pick<CodexWorkspaceSummary, 'id'> & Partial<Omit<CodexWorkspaceSummary, 'id'>>)
  | null
  | undefined;

function normalizeCodexText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isKnownPersonalWorkspaceLabel(value: string | null | undefined): boolean {
  const normalized = normalizeCodexText(value)?.toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized === 'personal' || normalized === 'personal account' || normalized === 'kişisel hesap'
  );
}

export function normalizeCodexPlanType(planType: string | null | undefined): string | null {
  return normalizeCodexText(planType)?.toLowerCase() ?? null;
}

export function isCodexTeamPlan(planType: string | null | undefined): boolean {
  const normalized = normalizeCodexPlanType(planType);
  return normalized === 'team' || normalized === 'business' || normalized === 'enterprise';
}

export function getCodexIdentityKey(input: {
  accountId: string;
  workspace?: CodexWorkspaceLike;
}): string {
  const workspaceId = input.workspace?.id?.trim();
  return workspaceId ? `${input.accountId}::${workspaceId}` : input.accountId;
}

export function getCodexRecordIdentityKey(
  account: Pick<CodexAccountRecord, 'accountId'> & {
    workspace?: CodexWorkspaceLike;
  },
): string {
  return getCodexIdentityKey(account);
}

export function getCodexWorkspaceLabel(workspace: CodexWorkspaceLike): string | null {
  return normalizeCodexText(workspace?.title) ?? normalizeCodexText(workspace?.id) ?? null;
}

export function isCodexPersonalWorkspace(workspace: CodexWorkspaceLike): boolean {
  return (
    isKnownPersonalWorkspaceLabel(getCodexWorkspaceLabel(workspace)) ||
    isKnownPersonalWorkspaceLabel(workspace?.id)
  );
}

export function getCodexAccountDisplayIdentity(
  account: Pick<CodexAccountRecord, 'label' | 'email' | 'accountId'> & {
    workspace?: CodexWorkspaceLike;
    planType?: string | null;
  },
): string {
  const label = normalizeCodexText(account.label);
  if (label) {
    return label;
  }

  const workspaceLabel = getCodexWorkspaceLabel(account.workspace);
  if (
    isCodexTeamPlan(account.planType) &&
    workspaceLabel &&
    !isCodexPersonalWorkspace(account.workspace)
  ) {
    return workspaceLabel;
  }

  return normalizeCodexText(account.email) || workspaceLabel || account.accountId;
}
