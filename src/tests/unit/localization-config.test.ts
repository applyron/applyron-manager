import { describe, expect, it } from 'vitest';

import i18n from '../../localization/i18n';
import { getTrayTexts } from '../../ipc/tray/i18n';
import { DEFAULT_APP_CONFIG } from '../../types/config';
import { getInstallNoticeText, resolveInstallNoticeLanguage } from '../../utils/installNotice';

describe('Localization configuration', () => {
  it('defaults the app language to Turkish', () => {
    expect(DEFAULT_APP_CONFIG.language).toBe('tr');
    expect(DEFAULT_APP_CONFIG.managed_ide_target).toBe('antigravity');
  });

  it('normalizes Turkish locale variants for install notice text', () => {
    expect(resolveInstallNoticeLanguage({ locale: 'tr-TR' })).toBe('tr');
    expect(getInstallNoticeText('tr').title).toContain('Başlat');
  });

  it('falls back removed locale variants to English', () => {
    expect(resolveInstallNoticeLanguage({ locale: 'zh-CN' })).toBe('en');
    expect(resolveInstallNoticeLanguage({ locale: 'ru-RU' })).toBe('en');
  });

  it('returns Turkish tray labels', () => {
    const texts = getTrayTexts('tr');

    expect(texts.switch_next).toBe('Sonraki hesaba geç');
    expect(texts.quit).toBe('Uygulamadan çık');
  });

  it('exposes Turkish translation resources', async () => {
    await i18n.changeLanguage('tr');

    expect(i18n.t('settings.language.turkish')).toBe('Türkçe');
    expect(i18n.t('cloud.toast.startAuthFailed')).toBe('Giriş akışı başlatılamadı');
    expect(i18n.t('managedIde.actions.openIde')).toBe('VS Code’u aç');
    expect(i18n.t('statusBar.toolsLabel')).toBe('Araçlar');
    expect(i18n.t('cloud.codex.actions.importCurrent')).toBe('Mevcut oturumu içe aktar');
    expect(i18n.t('settings.managedIde.antigravityDescription')).toBe(
      'Antigravity Gemini çalışma alanını varsayılan yönetilen hedef yapar.',
    );
  });
});
