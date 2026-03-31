import path from 'path';
import { FALLBACK_APP_LANGUAGE, type AppLanguage, normalizeAppLanguage } from './language';

export type InstallNoticeLanguage = AppLanguage;

const installNoticeText: Record<
  InstallNoticeLanguage,
  {
    title: string;
    message: string;
    detailPrefix: string;
    buttons: [string, string];
  }
> = {
  en: {
    title: 'Please launch from the Start menu',
    message:
      'We detected the app is running from a non-install location. To ensure auto-updates work, launch it from the Start menu or desktop shortcut. If no shortcut exists, run the installer again.',
    detailPrefix: 'Install location: ',
    buttons: ['Open install folder', 'OK'],
  },
  tr: {
    title: 'Lütfen uygulamayı Başlat menüsünden açın',
    message:
      'Uygulamanın kurulum dışı bir konumdan çalıştığını algıladık. Otomatik güncellemelerin çalışması için uygulamayı Başlat menüsü veya masaüstü kısayolundan açın. Kısayol yoksa yükleyiciyi yeniden çalıştırın.',
    detailPrefix: 'Kurulum konumu: ',
    buttons: ['Klasörü aç', 'Tamam'],
  },
};

export function resolveInstallNoticeLanguage({
  configLanguage,
  locale,
}: {
  configLanguage?: string | null;
  locale?: string | null;
}): InstallNoticeLanguage {
  const rawLanguage = configLanguage || locale;
  return normalizeAppLanguage(rawLanguage, FALLBACK_APP_LANGUAGE);
}

export function getInstallNoticeText(language: InstallNoticeLanguage) {
  return installNoticeText[language] || installNoticeText.en;
}

function getPathApi(platform: string) {
  if (platform === 'win32') {
    return path.win32;
  }

  return path;
}

function normalizeWindowsInstallDirName(appName: string) {
  return appName
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

export function getExpectedInstallRoot({
  platform,
  localAppData,
  appName,
}: {
  platform: string;
  localAppData?: string | null;
  appName: string;
}) {
  if (platform !== 'win32') {
    return null;
  }

  if (!localAppData) {
    return null;
  }

  const pathApi = getPathApi(platform);
  const installDirName = normalizeWindowsInstallDirName(appName);
  return pathApi.resolve(pathApi.join(localAppData, installDirName));
}

export function isRunningFromExpectedInstallDir({
  platform,
  isPackaged,
  localAppData,
  appName,
  execPath,
}: {
  platform: string;
  isPackaged: boolean;
  localAppData?: string | null;
  appName: string;
  execPath: string;
}) {
  if (platform !== 'win32' || !isPackaged) {
    return true;
  }

  const expectedRoot = getExpectedInstallRoot({ platform, localAppData, appName });
  if (!expectedRoot) {
    return true;
  }

  const pathApi = getPathApi(platform);
  const normalizedExecPath = pathApi.resolve(execPath);

  return normalizedExecPath.toLowerCase().startsWith(expectedRoot.toLowerCase() + pathApi.sep);
}
