export function getCodexRemainingRequestPercent(
  usedPercent: number | null | undefined,
): number | null {
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
}

function normalizeCodexEnumValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.toLowerCase().replace(/[_\s]+/g, '-');
}

export function normalizeCodexServiceTier(value: string | null | undefined): string | null {
  const normalized = normalizeCodexEnumValue(value);
  if (!normalized) {
    return null;
  }

  switch (normalized) {
    case 'fast':
    case 'flex':
    case 'priority':
    case 'standard':
    case 'default':
      return normalized;
    default:
      return normalized;
  }
}

export function normalizeCodexAgentMode(value: string | null | undefined): string | null {
  const normalized = normalizeCodexEnumValue(value);
  if (!normalized) {
    return null;
  }

  switch (normalized) {
    case 'fullaccess':
      return 'full-access';
    case 'readonly':
      return 'read-only';
    case 'workspacewrite':
      return 'workspace-write';
    case 'dangerfullaccess':
      return 'danger-full-access';
    default:
      return normalized;
  }
}

export function getCodexWindowKind(
  windowDurationMins: number | null | undefined,
): 'fiveHours' | 'weekly' | 'generic' {
  if (windowDurationMins === 300) {
    return 'fiveHours';
  }

  if (windowDurationMins === 10080) {
    return 'weekly';
  }

  return 'generic';
}

export function prettifyCodexValue(value: string | null | undefined): string | null {
  const normalized = normalizeCodexEnumValue(value);
  if (!normalized) {
    return null;
  }

  return normalized
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}
