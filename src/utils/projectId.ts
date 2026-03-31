import { LEGACY_DEFAULT_PROJECT_ID } from '../types/config';

export function normalizeProjectId(projectId: string | null | undefined): string | undefined {
  if (typeof projectId !== 'string') {
    return undefined;
  }

  const trimmedProjectId = projectId.trim();
  if (trimmedProjectId === '' || /^cloud-code-\d+$/i.test(trimmedProjectId)) {
    return undefined;
  }

  if (/^projects(?:\/.*)?$/i.test(trimmedProjectId)) {
    return undefined;
  }

  return trimmedProjectId;
}

export function resolveDefaultProjectId(
  configuredProjectId: string | null | undefined,
  envProjectId: string | null | undefined = process.env.APPLYRON_DEFAULT_PROJECT_ID,
  fallbackProjectId = LEGACY_DEFAULT_PROJECT_ID,
): string {
  return (
    normalizeProjectId(configuredProjectId) ?? normalizeProjectId(envProjectId) ?? fallbackProjectId
  );
}
