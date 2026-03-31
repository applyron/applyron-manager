export function isErrorReportingEnabled(
  config:
    | {
        error_reporting_enabled?: boolean;
        privacy_consent_asked?: boolean;
      }
    | null
    | undefined,
): boolean {
  return config?.privacy_consent_asked === true && config.error_reporting_enabled === true;
}
