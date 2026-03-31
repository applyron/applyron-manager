import type { i18n } from 'i18next';
import { normalizeAppLanguage } from '@/utils/language';

export function setAppLanguage(lang: string, i18n: i18n) {
  const normalizedLanguage = normalizeAppLanguage(lang);
  i18n
    .changeLanguage(normalizedLanguage)
    .then(() => {
      localStorage.setItem('lang', normalizedLanguage);
      document.documentElement.lang = normalizedLanguage;
      if (window.electron?.changeLanguage) {
        window.electron.changeLanguage(normalizedLanguage);
      }
    })
    .catch((err) => {
      console.error('[Language] Failed to change language:', err);
    });
}

export function updateAppLanguage(i18n: i18n) {
  document.documentElement.lang = i18n.language;
}
