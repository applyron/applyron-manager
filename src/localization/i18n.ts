import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import {
  DEFAULT_APP_LANGUAGE,
  FALLBACK_APP_LANGUAGE,
  SUPPORTED_APP_LANGUAGES,
  normalizeAppLanguage,
} from '@/utils/language';
import { enTranslation } from './resources/en';
import { trTranslation } from './resources/tr';

const LANGUAGE_STORAGE_KEY = 'lang';

const initialLanguage =
  typeof window === 'undefined'
    ? DEFAULT_APP_LANGUAGE
    : normalizeAppLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY), DEFAULT_APP_LANGUAGE);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    lng: initialLanguage,
    fallbackLng: FALLBACK_APP_LANGUAGE,
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      convertDetectedLanguage: (language) => normalizeAppLanguage(language, FALLBACK_APP_LANGUAGE),
    },
    supportedLngs: [...SUPPORTED_APP_LANGUAGES],
    load: 'currentOnly',
    resources: {
      en: {
        translation: enTranslation,
      },
      tr: {
        translation: trTranslation,
      },
    },
  });

export default i18n;
