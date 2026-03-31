export const DEFAULT_APP_LANGUAGE = 'tr' as const;
export const FALLBACK_APP_LANGUAGE = 'en' as const;
export const SUPPORTED_APP_LANGUAGES = ['en', 'tr'] as const;

export type AppLanguage = (typeof SUPPORTED_APP_LANGUAGES)[number];

export function normalizeAppLanguage(
  language?: string | null,
  fallback: AppLanguage = FALLBACK_APP_LANGUAGE,
): AppLanguage {
  if (!language) {
    return fallback;
  }

  const normalized = language.toLowerCase();
  if (normalized.startsWith('tr')) {
    return 'tr';
  }

  if (normalized.startsWith('en')) {
    return 'en';
  }

  return fallback;
}
