export const trCloud = {
  cloud: {
    title: 'Hesaplar',
    description: 'Google Gemini hesap havuzunuzu yönetin.',
    descriptionCombined: 'Gemini ve Codex hesap havuzunuzu yönetin.',
    autoSwitch: 'Otomatik Geçiş',
    providerGroupings: 'Sağlayıcı Grupları',
    connectedIdentities: {
      title: 'Bağlı Yapay Zeka Kimlikleri',
      description: 'Sinir ağı entegrasyonlarınızı yönetin',
      addNew: 'Yeni Hesap Ekle',
    },
    addAccount: 'Hesap Ekle',
    syncFromIDE: "IDE'den Eşitle",
    checkQuota: 'Kotayı Şimdi Kontrol Et',
    polling: 'Yoklama tetiklendi',
    globalQuota: 'Genel Kota',
    tabs: {
      gemini: 'Gemini',
      codex: 'Codex',
    },
    codex: {
      description:
        'Codex hesap havuzunuzu yönetin ve etkin VS Code Codex oturumunu Applyron Manager içinden değiştirin.',
      badges: {
        runtimeMismatch: 'Runtime uyumsuzluğu',
        runtimeSelectionNeeded: 'Runtime seçimi gerekli',
      },
      source: 'Kaynak',
      remainingRequests: 'Kalan istek limiti',
      accountCardDescription:
        'Her hesap Applyron Manager içinde güvenli biçimde saklanır ve etkin VS Code Codex oturumu olarak uygulanabilir.',
      singleSessionNote:
        "Codex hesapları Applyron Manager içinde saklanır ve etkinleştirdiğiniz hesap VS Code'a otomatik uygulanır.",
      emptyTitle: 'Henüz Codex hesabı eklenmedi',
      emptyDescription:
        'Mevcut VS Code oturumunu içe aktarın veya yeni bir ChatGPT/Codex hesabı ekleyerek Codex havuzunuzu oluşturmaya başlayın.',
      stats: {
        ready: 'Hazır',
      },
      health: {
        ready: 'Sağlıklı',
        limited: 'Sınırlı',
        attention: 'İnceleme gerekli',
      },
      labels: {
        accountIdPrefix: 'Hesap kimliği: {{id}}',
        workspacePrefix: 'Çalışma alanı: {{name}}',
        plan: 'Plan',
        serviceTier: 'Servis katmanı',
        agentMode: 'Ajan modu',
        status: 'Durum',
        primaryQuota: 'Birincil pencere',
        secondaryQuota: 'İkincil pencere',
      },
      actions: {
        refreshAll: 'Tümünü yenile',
        importCurrent: 'Mevcut oturumu içe aktar',
        activate: 'Etkin yap',
        syncRuntime: 'WSL Sync',
      },
      runtime: {
        activeRuntime: 'Etkin runtime: {{name}}',
        selectionTitle: 'Codex hesap işlemlerinin hangi runtime tarafına gideceğini seçin.',
        selectionDescription:
          'Windows Local ve WSL Remote birlikte hazır, ancak etkin VS Code tarafı otomatik olarak net tespit edilemedi.',
        useWindowsLocal: 'Windows Local kullan',
        useWslRemote: 'WSL Remote kullan',
        stateSummary: '{{name}} · {{state}}',
      },
      pendingApply: {
        title: 'Codex hesap değişimi sıraya alındı',
        description:
          '{{account}} hesabı {{runtime}} için seçildi. Bu hesabı uygulamak için VS Code’u kapatın.',
      },
      confirmDelete: '{{target}} hesabı Codex havuzundan kaldırılsın mı?',
      windows: {
        fiveHours: '5 saatlik pencere',
        weekly: 'Haftalık pencere',
        generic: 'İstek penceresi',
      },
      values: {
        serviceTier: {
          fast: 'Hızlı',
          flex: 'Esnek',
          priority: 'Öncelikli',
          standard: 'Standart',
        },
        agentMode: {
          fullAccess: 'Tam erişim',
          readOnly: 'Salt okunur',
          workspaceWrite: 'Çalışma alanı yazma',
          dangerFullAccess: 'Tehlikeli tam erişim',
        },
      },
      toast: {
        addedTitle: 'Codex hesabı eklendi',
        addedDescription: 'Yeni bir ChatGPT/Codex hesabı Applyron havuzuna kaydedildi.',
        addedBatchDescription:
          'Consent ekranındaki {{count}} çalışma alanı ayrı Codex hesabı olarak havuza eklendi.',
        addFailedTitle: 'Codex hesabı eklenemedi',
        importedTitle: 'Codex oturumu içe aktarıldı',
        importedDescription:
          'Geçerli VS Code Codex oturumu Applyron havuzuna eklendi ve etkin hesap olarak ayarlandı.',
        importFailedTitle: 'Codex oturumu içe aktarılamadı',
        activatedTitle: 'Codex hesabı etkinleştirildi',
        activatedDescription: "Applyron Manager, VS Code Codex'i seçilen hesaba geçirdi.",
        deferredActivationTitle: 'Codex hesabı sıraya alındı',
        deferredActivationDescription:
          '{{account}} hesabı, VS Code kapandıktan sonra {{runtime}} tarafına uygulanacak.',
        activateFailedTitle: 'Codex hesabı etkinleştirilemedi',
        deletedTitle: 'Codex hesabı kaldırıldı',
        deletedDescription: 'Seçilen Codex hesabı Applyron havuzundan kaldırıldı.',
        deleteFailedTitle: 'Codex hesabı kaldırılamadı',
        loginRequiredTitle: 'Codex girişi gerekli',
        loginRequiredDescription:
          "Önce VS Code'u açıp resmi OpenAI eklentisinden giriş yapın, ardından tekrar deneyin.",
        runtimeSyncTitle: 'WSL runtime senkronu tamamlandı',
        runtimeSyncDescription: '{{source}} -> {{target}}',
        runtimeSyncFailedTitle: 'WSL runtime senkronu başarısız oldu',
        runtimeSyncWarningTitle: 'WSL runtime senkronu uyarılarla tamamlandı',
        runtimeSyncWarningDescription: '{{source}} -> {{target}}. {{warnings}}',
      },
    },
    stats: {
      total: 'Toplam Hesap',
      active: 'Etkin',
      rateLimited: 'Sınırlı',
    },
    layout: {
      auto: 'Otomatik',
      twoCol: '2 Sütun',
      threeCol: '3 Sütun',
      list: 'Liste',
    },
    authDialog: {
      title: 'Google Hesabı Ekle',
      description: 'Hesap eklemek için uygulamayı yetkilendirmeniz gerekir.',
      openLogin: 'Giriş Sayfasını Aç',
      offlineHint: 'Uygulama çevrimdışıyken giriş başlatılamaz.',
      startErrorTitle: 'Google giriş akışı başlatılamadı',
      authCode: 'Yetkilendirme Kodu',
      placeholder: '4/ ile başlayan kodu yapıştırın...',
      instruction:
        'Google girişi için varsayılan tarayıcı açılacak. localhost sayfasındaki kodu kopyalayıp buraya yapıştırın.',
      verify: 'Doğrula ve Ekle',
    },
    card: {
      active: 'Etkin',
      use: 'Kullan',
      rateLimited: 'Kota Sınırlı',
      expired: 'Süresi Doldu',
      left: 'kalan',
      used: 'Kullanıldı',
      unknown: 'Bilinmeyen Kullanıcı',
      actions: 'Eylemler',
      quotaUsage: 'KOTA KULLANIMI',
      useAccount: 'Hesabı Kullan',
      identityProfile: 'Kimlik Profili',
      refresh: 'Kotayı Yenile',
      delete: 'Hesabı Sil',
      noQuota: 'Kota verisi yok',
      rateLimitedQuota: 'Kota Sınırlı',
      resetPrefix: 'sıfırlama',
      resetTime: 'Sıfırlama zamanı',
      resetUnknown: 'Bilinmiyor',
      gemini3Ready: 'Gemini 3 Hazır',
      groupGoogleGemini: 'Google Gemini',
      groupAnthropicClaude: 'Anthropic Claude',
    },
    identity: {
      title: 'Kimlik Profili',
      loading: 'Yükleniyor...',
      generateAndBind: 'Oluştur ve Bağla',
      captureAndBind: 'Mevcut Olanı Yakala ve Bağla',
      restoreOriginal: 'Temel Profili Geri Yükle',
      openFolder: 'Kimlik Depolama Alanını Aç',
      previewTitle: 'Oluşturulan Kimlik Önizlemesi',
      confirm: 'Onayla',
      cancel: 'İptal',
      close: 'Kapat',
      currentStorage: 'Güncel Çalışma Kimliği',
      accountBinding: 'Hesaba Bağlı Kimlik',
      history: 'Kimlik Geçmişi',
      noHistory: 'Kimlik geçmişi yok',
      current: 'Etkin',
      restore: 'Geri Yükle',
      generateSuccess: 'Kimlik oluşturuldu ve bağlandı',
      captureSuccess: 'Mevcut kimlik yakalandı ve bağlandı',
      restoreOriginalSuccess: 'Temel kimlik geri yüklendi',
      restoreVersionSuccess: 'Geçmiş kimlik geri yüklendi',
      deleteVersionSuccess: 'Geçmiş kimlik silindi',
      openFolderSuccess: 'Kimlik depolama alanı açıldı',
      baseline: 'Temel Kimlik',
    },
    list: {
      noAccounts: 'Henüz bulut hesabı eklenmedi.',
      emptyDescription: 'Bir sağlayıcı bağlamak için "Yeni Hesap Ekle" butonuna tıklayın',
    },
    error: {
      loadFailed: 'Bulut hesapları yüklenemedi.',
    },
    errors: {
      googleOAuthNotConfigured:
        'Bu derlemede Google girişi yapılandırılmamış. APPLYRON_GOOGLE_CLIENT_ID ve APPLYRON_GOOGLE_CLIENT_SECRET ayarlarını tanımlayıp tekrar deneyin.',
      authPortInUse:
        'Google giriş akışı başlatılamadı çünkü yerel loopback portu zaten kullanımda.',
      authCodeRequired: 'Devam etmek için geçerli bir Google yetkilendirme kodu yapıştırın.',
      authCodeAlreadyUsed:
        'Bu Google yetkilendirme kodu zaten kullanıldı. Yeni bir giriş akışı başlatıp tekrar deneyin.',
      invalidAuthCode:
        'Bu Google yetkilendirme kodu geçersiz veya süresi dolmuş. Yeni bir giriş akışı başlatıp tekrar deneyin.',
      authFlowStartFailed: 'Google giriş akışı başlatılamadı. Lütfen tekrar deneyin.',
      codexIdeUnavailable:
        'VS Code Codex bu cihazda henüz kullanılamıyor. Kurulumu kontrol edip tekrar deneyin.',
      codexCurrentSessionUnavailable:
        'İçe aktarılabilecek etkin bir Codex oturumu bulunamadı. VS Code içinden giriş yapıp tekrar deneyin.',
      codexAuthFileNotFound: 'Seçilen Codex hesabının kimlik bilgileri bulunamadı.',
      codexAccountNotFound: 'Seçilen Codex hesabı bulunamadı.',
      codexAccountStoreUnavailable:
        'Codex hesap deposu henüz hazır değil. Lütfen biraz sonra tekrar deneyin.',
      codexAccountSaveFailed:
        'Codex hesabı yerel olarak kaydedilemedi. Yerel depolama erişimini kontrol edip tekrar deneyin.',
      codexAccountPoolUnavailable: 'Codex hesap havuzu şu anda okunamıyor. Lütfen tekrar deneyin.',
      codexAccountAlreadyExists:
        'Bu Codex hesabı zaten Applyron havuzunda var. Yeni kart oluşturmak için farklı bir hesapla giriş yapın.',
      codexAccountAlreadyExistsWithIdentity:
        'Geri dönen Codex hesabı zaten Applyron havuzunda var: {{identity}}. Yeni kart oluşturmak için farklı bir hesapla giriş yapın.',
      codexLoginTimeout:
        'Codex giriş süreci zaman aşımına uğradı. Tarayıcı girişini tamamlayıp tekrar deneyin.',
      codexLoginFailed: 'Codex girişi tamamlanamadı. Lütfen giriş akışını yeniden deneyin.',
      codexDeleteActiveBlocked:
        'Etkin Codex hesabı silinemez. Önce başka bir hesabı etkinleştirin.',
      codexRuntimeSelectionRequired:
        'Önce etkin Codex runtime tarafını seçin, ardından işlemi tekrar deneyin.',
      codexRuntimeSyncUnavailable:
        'WSL sync yalnızca Windows Local ve WSL Remote runtime birlikte kuruluysa kullanılabilir.',
      codexRuntimeSyncAuthFailed: 'Hedef runtime tarafındaki auth dosyası güncellenemedi.',
      codexRuntimeSyncStateFailed: 'Hedef runtime tarafındaki OpenAI uzantı durumu güncellenemedi.',
      codexRuntimeSyncAuthSkipped:
        'Kaynak veya hedef auth dosyası eksik olduğu için auth verisi atlandı.',
      codexRuntimeSyncStateSkipped:
        'Kaynak veya hedef state veritabanı eksik olduğu için uzantı durumu atlandı.',
      switch: {
        closeFailed: 'Hesap değişiminden önce yönetilen IDE güvenli şekilde kapatılamadı.',
        processExitTimeout: 'Yönetilen IDE zamanında kapanmadığı için hesap değişimi iptal edildi.',
        missingBoundProfile: 'Seçilen hesap için bağlı bir kimlik profili bulunmuyor.',
        applyFailed: 'Bağlı kimlik profili uygulanamadı.',
        switchFailed: 'Hesap değişimi güvenli şekilde tamamlanamadı.',
        startFailed: 'Değişim denemesinden sonra yönetilen IDE yeniden başlatılamadı.',
      },
    },
    toast: {
      syncSuccess: {
        title: 'Senkronizasyon Başarılı',
        description: "{{email}} IDE'den içe aktarıldı.",
      },
      syncFailed: {
        title: 'Senkronizasyon Başarısız',
        description: 'IDE veritabanında etkin hesap bulunamadı.',
      },
      addSuccess: 'Hesap başarıyla eklendi!',
      addFailed: {
        title: 'Hesap eklenemedi',
      },
      quotaRefreshed: 'Kota yenilendi',
      refreshFailed: 'Kota yenilenemedi',
      pollFailed: 'Tüm hesapların kotası sorgulanamadı',
      switched: {
        title: 'Hesap değiştirildi!',
        description: 'Yönetilen IDE yeniden başlatılıyor...',
      },
      switchFailed: 'Hesap değiştirilemedi',
      deleted: 'Hesap silindi',
      deleteFailed: 'Hesap silinemedi',
      deleteConfirm: 'Bu hesabı silmek istediğinize emin misiniz?',
      autoSwitchOn: 'Otomatik Geçiş Etkin',
      autoSwitchOff: 'Otomatik Geçiş Devre Dışı',
      updateSettingsFailed: 'Ayarlar güncellenemedi',
      startAuthFailed: 'Giriş akışı başlatılamadı',
    },
    batch: {
      selected: '{{count}} seçildi',
      delete: 'Seçilenleri Sil',
      refresh: 'Seçilenleri Yenile',
      selectAll: 'Tümünü Seç',
      clear: 'Seçimi Temizle',
      confirmDelete: '{{count}} hesabı silmek istediğinize emin misiniz?',
      refreshTriggered: '{{count}} hesap için yenileme başlatıldı.',
      deleted: '{{count}} hesap silindi.',
      partialDeleteTitle: 'Bazı hesaplar silinemedi',
      resultSummary: '{{deletedCount}} silindi / {{failedCount}} başarısız',
    },
  },
} as const;
