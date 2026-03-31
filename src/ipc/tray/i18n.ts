export type TrayTexts = {
  current: string;
  target: string;
  quota: string;
  gemini_high: string;
  gemini_image: string;
  claude45: string;
  switch_next: string;
  refresh_current: string;
  refresh_status: string;
  show_window: string;
  open_ide: string;
  open_login: string;
  quit: string;
  no_account: string;
  no_session: string;
  unknown_quota: string;
  forbidden: string;
  service_tier: string;
  agent_mode: string;
  remaining_requests: string;
  five_hour_window: string;
  weekly_window: string;
  generic_window: string;
  credits: string;
  fast: string;
  flex: string;
  priority: string;
  standard: string;
  full_access: string;
  read_only: string;
  workspace_write: string;
  danger_full_access: string;
  update_status: string;
  checking_updates: string;
  downloading_update: string;
  update_ready: string;
  restart_and_install: string;
  update_error: string;
};

const en: TrayTexts = {
  current: 'Current',
  target: 'Target',
  quota: 'Quota',
  gemini_high: 'Gemini High',
  gemini_image: 'Gemini Image',
  claude45: 'Claude 4.5',
  switch_next: 'Switch to Next Account',
  refresh_current: 'Refresh Current Quota',
  refresh_status: 'Refresh Status',
  show_window: 'Show Main Window',
  open_ide: 'Open VS Code',
  open_login: 'Open Codex Login',
  quit: 'Quit Application',
  no_account: 'No Account',
  no_session: 'Not Signed In',
  unknown_quota: 'Unknown',
  forbidden: 'Account Forbidden',
  service_tier: 'Service Tier',
  agent_mode: 'Agent Mode',
  remaining_requests: 'Remaining request limit',
  five_hour_window: '5-hour window',
  weekly_window: 'Weekly window',
  generic_window: 'Request window',
  credits: 'Credits',
  fast: 'Fast',
  flex: 'Flex',
  priority: 'Priority',
  standard: 'Standard',
  full_access: 'Full access',
  read_only: 'Read only',
  workspace_write: 'Workspace write',
  danger_full_access: 'Danger full access',
  update_status: 'Update',
  checking_updates: 'Checking for updates...',
  downloading_update: 'Downloading update',
  update_ready: 'Ready to install',
  restart_and_install: 'Restart and install',
  update_error: 'Update error',
};

const tr: TrayTexts = {
  current: 'Güncel hesap',
  target: 'Hedef',
  quota: 'Kota',
  gemini_high: 'Gemini Yüksek',
  gemini_image: 'Gemini Görsel',
  claude45: 'Claude 4.5',
  switch_next: 'Sonraki hesaba geç',
  refresh_current: 'Güncel kotayı yenile',
  refresh_status: 'Durumu yenile',
  show_window: 'Ana pencereyi göster',
  open_ide: 'VS Code’u aç',
  open_login: 'Codex girişini aç',
  quit: 'Uygulamadan çık',
  no_account: 'Hesap yok',
  no_session: 'Oturum açık değil',
  unknown_quota: 'Bilinmiyor',
  forbidden: 'Hesap yasaklı',
  service_tier: 'Servis katmanı',
  agent_mode: 'Ajan modu',
  remaining_requests: 'Kalan istek limiti',
  five_hour_window: '5 saatlik pencere',
  weekly_window: 'Haftalık pencere',
  generic_window: 'İstek penceresi',
  credits: 'Krediler',
  fast: 'Hızlı',
  flex: 'Esnek',
  priority: 'Öncelikli',
  standard: 'Standart',
  full_access: 'Tam erişim',
  read_only: 'Salt okunur',
  workspace_write: 'Çalışma alanı yazma',
  danger_full_access: 'Tehlikeli tam erişim',
  update_status: 'Güncelleme',
  checking_updates: 'Güncellemeler kontrol ediliyor...',
  downloading_update: 'Güncelleme indiriliyor',
  update_ready: 'Kuruluma hazır',
  restart_and_install: 'Yeniden başlat ve kur',
  update_error: 'Güncelleme hatası',
};

export function getTrayTexts(lang: string = 'en'): TrayTexts {
  if (lang.startsWith('tr')) {
    return tr;
  }
  return en;
}
