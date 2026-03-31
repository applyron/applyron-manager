import type { CloudQuotaData } from '../types/cloudAccount';

function normalizeBoolean(value: boolean | undefined): string {
  return value ? '1' : '0';
}

function normalizeString(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePercentage(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  return String(Math.floor(value));
}

export function buildOperationalQuotaFingerprint(quota: CloudQuotaData | undefined): string {
  if (!quota) {
    return 'quota:none';
  }

  const modelEntries = Object.entries(quota.models ?? {})
    .map(([modelName, info]) => {
      return `${normalizeString(modelName)}:${normalizePercentage(info?.percentage)}:${normalizeString(
        info?.resetTime,
      )}`;
    })
    .filter((entry) => entry !== '::')
    .sort();

  const forwardingRules = Object.entries(quota.model_forwarding_rules ?? {})
    .map(
      ([sourceModel, targetModel]) =>
        `${normalizeString(sourceModel)}:${normalizeString(targetModel)}`,
    )
    .filter((entry) => entry !== ':')
    .sort();

  return [
    `tier=${normalizeString(quota.subscription_tier)}`,
    `forbidden=${normalizeBoolean(quota.is_forbidden ?? quota.isForbidden)}`,
    `models=${modelEntries.join('|')}`,
    `rules=${forwardingRules.join('|')}`,
  ].join(';');
}

export function hasOperationalQuotaChange(
  previousQuota: CloudQuotaData | undefined,
  nextQuota: CloudQuotaData | undefined,
): boolean {
  return (
    buildOperationalQuotaFingerprint(previousQuota) !== buildOperationalQuotaFingerprint(nextQuota)
  );
}
