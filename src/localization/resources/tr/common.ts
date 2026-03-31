export const trCommon = {
  appName: 'Applyron Manager',
  app: {
    alreadyRunning: {
      title: 'Applyron Manager zaten çalışıyor',
      description: 'İkinci bir kopya başlatmak yerine mevcut pencereye odaklanıldı.',
    },
    offline: {
      title: 'Çevrimdışı mod etkin',
      description:
        'Ağ gerektiren işlemler geçici olarak devre dışı. Yerel tanılama, ayarlar ve taşınabilirlik araçları kullanılabilir.',
    },
  },
  status: {
    checking: 'Durum kontrol ediliyor...',
    running: 'Yönetilen IDE arka planda çalışıyor',
    stopped: 'Yönetilen IDE hizmeti durdu',
    antigravityClosed: 'Antigravity şu anda kapalı',
  },
  statusBar: {
    toolsLabel: 'Araçlar',
    classicActionLabel: 'Gemini Uygulaması',
    classicShortLabel: 'Gemini',
    codexActionLabel: 'Codex Uygulaması',
    codexShortLabel: 'Codex',
    checking: 'Kontrol ediliyor',
    running: 'Çalışıyor',
    stopped: 'Durdu',
    toggleFailedTitle: 'Yönetilen IDE işlemi başarısız oldu',
    toggleFailedDescription: 'İstenen başlatma veya durdurma işlemi tamamlanamadı.',
  },
  action: {
    stop: 'Durdur',
    start: 'Başlat',
    switch: 'Değiştir',
    deleteBackup: 'Yedeği Sil',
    backupCurrent: 'Mevcut Hesabı Yedekle',
    retry: 'Tekrar Dene',
    openLogs: 'Günlük Klasörünü Aç',
  },
  a11y: {
    openMenu: 'Menüyü aç',
    menu: 'Menü',
    close: 'Kapat',
    expand: 'Genişlet',
    collapse: 'Daralt',
    expandAccount: '{{target}} hesabını genişlet',
    collapseAccount: '{{target}} hesabını daralt',
    selectAccount: '{{target}} hesabını seç',
    actionsFor: '{{target}} için işlemler',
    toggleProviderGroup: '{{provider}} grubunu aç veya kapat',
    minimize: 'Küçült',
    maximize: 'Büyüt',
  },
  error: {
    generic: 'Beklenmeyen bir hata oluştu.',
    offline: 'Şu anda çevrimdışısınız. Bu ağ işlemini sürdürmek için bağlantıyı geri getirin.',
    keychainUnavailable: 'Keychain kullanılamıyor.',
    keychainHint: {
      translocation:
        'macOS App Translocation algılandı. Uygulamayı /Applications klasörüne taşıyıp yeniden açın.',
      keychainDenied:
        'Keychain erişimi reddedildi. Uygulama imzasız olabilir; çözüm için README içindeki self-signing bölümüne bakın.',
      signNotarize: 'Mümkün olduğunda imzalı ve notarize edilmiş bir sürüm kullanın.',
    },
    dataMigrationFailed: 'Eski hesap verileri çözülemedi.',
    dataMigrationHint: {
      relogin: 'Lütfen yeniden giriş yapın veya hesaplarınızı yeniden ekleyin.',
      clearData: 'Sorun devam ederse yerel hesap verilerini temizleyip tekrar oturum açın.',
    },
  },
  consent: {
    eyebrow: 'Gizlilik Kurulumu',
    title: 'Anonim hata raporlarını açıp açmayacağınızı seçin',
    description:
      'Applyron Manager siz karar verene kadar anonim hata raporlamayı kapalı tutar. Bu tercihi daha sonra Ayarlar içinden değiştirebilirsiniz.',
    enableTitle: 'Anonim hata raporlarını aç',
    enableDescription:
      'Kişisel içerik göndermeden çökme ve açılış hatalarını paylaşın; üretim sorunlarını daha hızlı düzeltebilelim.',
    disableTitle: 'Hata raporlamayı kapalı tut',
    disableDescription:
      'Uygulama normal çalışmaya devam eder ancak anonim çökme raporu gönderilmez.',
    footer: 'İsterseniz pencereyi kapatabilirsiniz. Bir seçim kaydedilmeden ana uygulama açılmaz.',
    saving: 'Kaydediliyor',
  },
  nav: {
    dashboard: 'Dashboard',
    accounts: 'Hesaplar',
    proxy: 'API Proxy',
    settings: 'Ayarlar',
  },
  account: {
    current: 'Güncel',
    lastUsed: '{{time}} kullanıldı',
  },
  home: {
    title: 'Hesaplar',
    description: 'Antigravity Google Gemini hesaplarınızı yönetin.',
    noBackups: {
      title: 'Yedek bulunamadı',
      description: 'Başlamak için mevcut Antigravity hesabınızı yedekleyin.',
      action: 'Mevcut Hesabı Yedekle',
    },
  },
  toast: {
    backupSuccess: {
      title: 'Başarılı',
      description: 'Hesap yedeği başarıyla oluşturuldu.',
    },
    backupError: {
      title: 'Hata',
      description: 'Yedek oluşturulamadı: {{error}}',
    },
    switchSuccess: {
      title: 'Başarılı',
      description: 'Hesap başarıyla değiştirildi.',
    },
    switchError: {
      title: 'Hata',
      description: 'Hesap değiştirilemedi: {{error}}',
    },
    deleteSuccess: {
      title: 'Başarılı',
      description: 'Hesap yedeği başarıyla silindi.',
    },
    deleteError: {
      title: 'Hata',
      description: 'Yedek silinemedi: {{error}}',
    },
  },
} as const;
