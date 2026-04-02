import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger';
import { isCodexPersonalWorkspace, isCodexTeamPlan } from './codexIdentity';
import type { CodexAuthFile, CodexWorkspaceSummary } from './types';
import { CodexAuthFileSchema } from './schemas';

export function getCodexHomePath(): string {
  const override = process.env.CODEX_HOME?.trim();
  return override && override.length > 0 ? override : path.join(os.homedir(), '.codex');
}

export function getCodexAuthFilePath(codexHome = getCodexHomePath()): string {
  return path.join(codexHome, 'auth.json');
}

export function readCodexAuthFile(filePath = getCodexAuthFilePath()): CodexAuthFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    const result = CodexAuthFileSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function writeCodexAuthFile(
  authFile: CodexAuthFile,
  filePath = getCodexAuthFilePath(),
): void {
  const targetDir = path.dirname(filePath);
  fs.mkdirSync(targetDir, { recursive: true });
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;

  try {
    fs.writeFileSync(tempPath, JSON.stringify(authFile, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Ignore temp cleanup failures.
    }
    throw error;
  }
}

export function removeCodexAuthFile(filePath = getCodexAuthFilePath()): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch (error) {
    logger.warn('Failed to remove Codex auth file', error);
  }
}

export function decodeJwtClaims(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) {
    return null;
  }

  const segments = token.split('.');
  if (segments.length < 2) {
    return null;
  }

  try {
    const base64 = segments[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(segments[1].length / 4) * 4, '=');
    const payload = Buffer.from(base64, 'base64').toString('utf8');
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function getCodexAuthClaims(authFile: CodexAuthFile | null): Record<string, unknown> | null {
  if (!authFile?.tokens) {
    return null;
  }

  const idTokenClaims = decodeJwtClaims(authFile.tokens.id_token);
  const authClaims = idTokenClaims?.['https://api.openai.com/auth'];
  return authClaims && typeof authClaims === 'object'
    ? (authClaims as Record<string, unknown>)
    : null;
}

function getNormalizedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWorkspaceCandidate(candidate: unknown): CodexWorkspaceSummary | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const value = candidate as Record<string, unknown>;
  const id =
    getNormalizedString(value.id) ??
    getNormalizedString(value.organization_id) ??
    getNormalizedString(value.organizationId) ??
    getNormalizedString(value.org_id) ??
    getNormalizedString(value.orgId) ??
    getNormalizedString(value.workspace_id) ??
    getNormalizedString(value.workspaceId) ??
    '';
  if (!id) {
    return null;
  }

  return {
    id,
    title:
      getNormalizedString(value.title) ??
      getNormalizedString(value.name) ??
      getNormalizedString(value.display_name) ??
      getNormalizedString(value.displayName) ??
      getNormalizedString(value.workspace_name) ??
      getNormalizedString(value.workspaceName) ??
      getNormalizedString(value.slug),
    role:
      getNormalizedString(value.role) ??
      getNormalizedString(value.membership_role) ??
      getNormalizedString(value.membershipRole),
    isDefault: value.is_default === true || value.isDefault === true || value.default === true,
  };
}

function getWorkspaceIdHints(authClaims: Record<string, unknown> | null): string[] {
  if (!authClaims) {
    return [];
  }

  return [
    authClaims.active_organization_id,
    authClaims.activeOrganizationId,
    authClaims.organization_id,
    authClaims.organizationId,
    authClaims.current_organization_id,
    authClaims.currentOrganizationId,
    authClaims.workspace_id,
    authClaims.workspaceId,
    authClaims.default_organization_id,
    authClaims.defaultOrganizationId,
  ]
    .map(getNormalizedString)
    .filter((value): value is string => value !== null);
}

function getWorkspaceCandidates(
  authClaims: Record<string, unknown> | null,
): CodexWorkspaceSummary[] {
  if (!authClaims) {
    return [];
  }

  const candidates = [
    authClaims.active_organization,
    authClaims.activeOrganization,
    authClaims.organization,
    authClaims.current_organization,
    authClaims.currentOrganization,
    authClaims.workspace,
    ...(Array.isArray(authClaims.organizations) ? authClaims.organizations : []),
  ]
    .map(normalizeWorkspaceCandidate)
    .filter((workspace): workspace is CodexWorkspaceSummary => workspace !== null);

  const deduped = new Map<string, CodexWorkspaceSummary>();
  for (const workspace of candidates) {
    const existing = deduped.get(workspace.id);
    if (
      !existing ||
      (!existing.title && workspace.title) ||
      (!existing.isDefault && workspace.isDefault)
    ) {
      deduped.set(workspace.id, workspace);
    }
  }

  return Array.from(deduped.values());
}

export function getCodexWorkspaceFromAuthFile(
  authFile: CodexAuthFile | null,
  options?: {
    planType?: string | null;
  },
): CodexWorkspaceSummary | null {
  const authClaims = getCodexAuthClaims(authFile);
  const organizations = getWorkspaceCandidates(authClaims);

  if (organizations.length === 0) {
    return null;
  }

  const hintedWorkspace = getWorkspaceIdHints(authClaims)
    .map((workspaceId) => organizations.find((workspace) => workspace.id === workspaceId) ?? null)
    .find((workspace): workspace is CodexWorkspaceSummary => workspace !== null);
  if (hintedWorkspace) {
    return hintedWorkspace;
  }

  if (isCodexTeamPlan(options?.planType)) {
    const teamWorkspace =
      organizations.find(
        (workspace) => workspace.isDefault && !isCodexPersonalWorkspace(workspace),
      ) ?? organizations.find((workspace) => !isCodexPersonalWorkspace(workspace));
    if (teamWorkspace) {
      return teamWorkspace;
    }
  }

  const defaultWorkspace = organizations.find((workspace) => workspace.isDefault);
  if (defaultWorkspace) {
    return defaultWorkspace;
  }

  if (organizations.length === 1) {
    return organizations[0];
  }

  logger.warn('Codex workspace could not be resolved from auth token organizations', {
    organizationsCount: organizations.length,
    planType: options?.planType ?? null,
  });
  return organizations[0] ?? null;
}

export function getCodexEmailHint(authFile: CodexAuthFile | null): string | null {
  if (!authFile?.tokens) {
    return null;
  }

  const idTokenClaims = decodeJwtClaims(authFile.tokens.id_token);
  if (typeof idTokenClaims?.email === 'string' && idTokenClaims.email.trim().length > 0) {
    return idTokenClaims.email.trim();
  }

  const accessTokenClaims = decodeJwtClaims(authFile.tokens.access_token);
  if (typeof accessTokenClaims?.email === 'string' && accessTokenClaims.email.trim().length > 0) {
    return accessTokenClaims.email.trim();
  }

  return null;
}
