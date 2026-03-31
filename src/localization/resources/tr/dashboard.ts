export const trDashboard = {
  dashboard: {
    eyebrow: 'Kontrol Merkezi',
    title: 'Dashboard',
    description:
      'Güncellemeleri, son duyuruları ve çalışma alanınızı şu anda besleyen hesapları tek ekranda izleyin.',
    stats: {
      activeAccounts: 'Aktif Hesaplar',
      announcements: 'Duyurular',
      currentVersion: 'Mevcut Sürüm',
    },
    update: {
      kicker: 'Güncelleme Durumu',
      title: 'Uygulama Güncellemeleri',
      description: 'Bu kurulumu en güncel Applyron Manager sürümüyle senkron tutun.',
      currentVersionLabel: 'Kurulu sürüm',
      latestVersionLabel: 'Son sürüm',
      lastCheckedLabel: 'Son kontrol',
      checkButton: 'Güncellemeleri kontrol et',
      restartButton: 'Yeniden başlat ve kur',
      laterButton: 'Daha sonra',
      downloadingTitle: 'Güncelleme indiriliyor',
      downloadingDescription:
        '{{version}} sürümü arka planda indiriliyor. İndirme tamamlandığında yeniden başlat seçeneği görünecek.',
      readyTitle: 'Güncelleme kurulmaya hazır',
      readyDescription:
        '{{version}} sürümü indirildi. Uygulamayı uygun olduğunuzda yeniden başlatıp güncellemeyi uygulayabilirsiniz.',
      status: {
        idle: 'Kontrole hazır',
        checking: 'Kontrol ediliyor',
        up_to_date: 'Güncel',
        update_available: 'Güncelleme hazır',
        ready_to_install: 'Kuruluma hazır',
        unsupported: 'Desteklenmiyor',
        error: 'İşlem gerekli',
      },
    },
    announcements: {
      kicker: 'Duyurular',
      title: 'Son Duyurular',
      description: 'Sürüm notları, bakım pencereleri ve önemli platform bildirimleri.',
      loading: 'Duyurular yükleniyor...',
      emptyTitle: 'Henüz duyuru yok',
      emptyDescription: 'Yeni güncellemeler ve bildirimler burada görünecek.',
      errorTitle: 'Duyurular şu anda alınamıyor',
      errorDescription: 'Dashboard uzak akışı şu anda yükleyemedi.',
      level: {
        info: 'Bilgi',
        success: 'Başarılı',
        warning: 'Uyarı',
        critical: 'Kritik',
      },
    },
    activeAccounts: {
      kicker: 'Aktif Hesaplar',
      title: 'Canlı Hesap Özeti',
      description: "Dashboard'dan ayrılmadan etkin Antigravity ve Codex hesaplarını görün.",
      goToAccounts: 'Hesaplara git',
      loading: 'Aktif hesaplar yükleniyor...',
      emptyTitle: 'Henüz aktif hesap yok',
      emptyDescription: 'Burada görmek için bir Antigravity veya Codex hesabını etkinleştirin.',
      emptyClassic: 'Etkin bir Antigravity hesabı seçili değil.',
      emptyCodex: 'Etkin bir Codex hesabı seçili değil.',
      sources: {
        classic: 'Antigravity',
        codex: 'Codex',
      },
      slots: {
        antigravity: 'Antigravity',
        codex: 'Codex',
      },
      classicQuotaSummary: '{{count}} görünür modelde ortalama %{{percentage}}',
      classicNoQuota: 'Henüz kota görüntüsü yok',
      primaryRemaining: 'Birincil %{{value}} kaldı',
      secondaryRemaining: 'İkincil %{{value}} kaldı',
      planType: 'Plan {{value}}',
      codexNoQuota: 'Henüz Codex kota görüntüsü yok',
    },
    health: {
      kicker: 'Sistem Sağlığı',
      description:
        'Yapılandırma, auth, proxy, güncelleme ve taşıma katmanı için canlı servis durumu.',
      lastUpdated: 'Güncellendi',
      states: {
        idle: 'Beklemede',
        starting: 'Başlıyor',
        ready: 'Hazır',
        degraded: 'Sınırlı',
        unsupported: 'Desteklenmiyor',
        error: 'Hata',
      },
      services: {
        config: 'Yapılandırma',
        security: 'Kimlik Depolama',
        updater: 'Güncelleyici',
        auth_server: 'Google Giriş',
        proxy_server: 'API Proxy',
        cloud_monitor: 'Antigravity Monitörü',
        codex_monitor: 'Codex Monitör',
        orpc_transport: 'ORPC Taşıma',
      },
    },
    operationalAlerts: {
      kicker: 'Operasyon Uyarıları',
      description:
        'Bağlantı, hesap durumu ve çalışma zamanı sağlığından toplanan proaktif uyarılar ve engeller.',
      emptyTitle: 'Etkin operasyon uyarısı yok',
      emptyDescription:
        'Mevcut oturum sağlıklı görünüyor. Yeni sorunlar engel haline gelmeden önce burada görünecek.',
      cta: {
        accounts: 'Hesapları Aç',
        proxy: "Proxy'yi Aç",
        settings: 'Ayarları Aç',
      },
      items: {
        offline: {
          title: 'Uygulama çevrimdışı',
          description:
            'Güncelleme kontrolü ve bulut yenileme gibi uzak işlemler bağlantı dönene kadar bekletiliyor.',
        },
        service: {
          title: '{{service}} dikkat istiyor',
          description: '{{service}} şu anda {{state}} durumunda. {{message}}',
          noMessage: 'Henüz ek ayrıntı yok.',
        },
        cloudTokenExpiring: {
          title: 'Bir bulut tokenının süresi dolmak üzere',
          description:
            '{{identity}} için kota veya proxy akışları bozulmadan önce yenileme yapılmalı.',
        },
        cloudExpired: {
          title: 'Bir bulut hesabının süresi doldu',
          description: '{{identity}} yenilenene veya değiştirilene kadar istek taşıyamaz.',
        },
        lowQuota: {
          title: "Görünür tüm bulut kotaları %10'un altında",
          description:
            'Kota görüntüsü olan tüm bulut hesapları neredeyse tükendi. Şimdi yenileme veya fallback planlayın.',
        },
        codexRequiresLogin: {
          title: 'Bir Codex hesabı yeniden giriş istiyor',
          description: '{{identity}} yeniden kullanılmadan önce taze bir giriş gerektiriyor.',
        },
        noReadyCodex: {
          title: 'Hazır durumda Codex hesabı yok',
          description: 'Codex havuzu mevcut ancak kayıtlı hesapların hiçbiri hazır durumda değil.',
        },
      },
    },
  },
} as const;
