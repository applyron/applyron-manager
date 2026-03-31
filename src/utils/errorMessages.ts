const KEYCHAIN_ERROR_CODE = 'ERR_KEYCHAIN_UNAVAILABLE';
const KEYCHAIN_HINT_TRANSLOCATION = 'HINT_APP_TRANSLOCATION';
const KEYCHAIN_HINT_KEYCHAIN_DENIED = 'HINT_KEYCHAIN_DENIED';
const KEYCHAIN_HINT_SIGN_NOTARIZE = 'HINT_SIGN_NOTARIZE';
const DATA_MIGRATION_ERROR_CODE = 'ERR_DATA_MIGRATION_FAILED';
const DATA_MIGRATION_HINT_RELOGIN = 'HINT_RELOGIN';
const DATA_MIGRATION_HINT_CLEAR_DATA = 'HINT_CLEAR_DATA';
const GOOGLE_OAUTH_NOT_CONFIGURED = 'GOOGLE_OAUTH_NOT_CONFIGURED';
const AUTH_PORT_IN_USE = 'AUTH_PORT_IN_USE';
const PROXY_PORT_IN_USE = 'PROXY_PORT_IN_USE';
const INVALID_IMPORT_PASSWORD_OR_FILE = 'INVALID_IMPORT_PASSWORD_OR_FILE';
const IMPORT_PREVIEW_EXPIRED = 'IMPORT_PREVIEW_EXPIRED';
const EXPORT_PASSWORD_REQUIRED = 'EXPORT_PASSWORD_REQUIRED';
const IMPORT_PASSWORD_REQUIRED = 'IMPORT_PASSWORD_REQUIRED';
const SWITCH_ERROR_I18N_MAP: Record<string, string> = {
  close_failed: 'cloud.errors.switch.closeFailed',
  process_exit_timeout: 'cloud.errors.switch.processExitTimeout',
  missing_bound_profile: 'cloud.errors.switch.missingBoundProfile',
  apply_failed: 'cloud.errors.switch.applyFailed',
  switch_failed: 'cloud.errors.switch.switchFailed',
  start_failed: 'cloud.errors.switch.startFailed',
};
const CODEX_ERROR_I18N_MAP: Record<string, string> = {
  CODEX_IDE_UNAVAILABLE: 'cloud.errors.codexIdeUnavailable',
  CODEX_CURRENT_SESSION_NOT_AVAILABLE: 'cloud.errors.codexCurrentSessionUnavailable',
  CODEX_AUTH_FILE_NOT_FOUND: 'cloud.errors.codexAuthFileNotFound',
  CODEX_ACCOUNT_NOT_FOUND: 'cloud.errors.codexAccountNotFound',
  CODEX_ACCOUNT_STORE_UNAVAILABLE: 'cloud.errors.codexAccountStoreUnavailable',
  CODEX_ACCOUNT_SAVE_FAILED: 'cloud.errors.codexAccountSaveFailed',
  CODEX_ACCOUNT_POOL_UNAVAILABLE: 'cloud.errors.codexAccountPoolUnavailable',
  CODEX_ACCOUNT_ALREADY_EXISTS: 'cloud.errors.codexAccountAlreadyExists',
  CODEX_LOGIN_TIMEOUT: 'cloud.errors.codexLoginTimeout',
  CODEX_LOGIN_FAILED: 'cloud.errors.codexLoginFailed',
  ACTIVE_CODEX_ACCOUNT_DELETE_BLOCKED: 'cloud.errors.codexDeleteActiveBlocked',
};

type TranslateFn = {
  (key: string): string;
  (key: string, defaultValue: string): string;
  (key: string, options: Record<string, unknown>): string;
  (key: string, defaultValue: string, options: Record<string, unknown>): string;
};

type LocalizedErrorOptions = {
  fallbackKey?: string;
  fallbackOptions?: Record<string, unknown>;
};

const KEYCHAIN_HINT_I18N_MAP: Record<string, string> = {
  [KEYCHAIN_HINT_TRANSLOCATION]: 'error.keychainHint.translocation',
  [KEYCHAIN_HINT_KEYCHAIN_DENIED]: 'error.keychainHint.keychainDenied',
  [KEYCHAIN_HINT_SIGN_NOTARIZE]: 'error.keychainHint.signNotarize',
};

const DATA_MIGRATION_HINT_I18N_MAP: Record<string, string> = {
  [DATA_MIGRATION_HINT_RELOGIN]: 'error.dataMigrationHint.relogin',
  [DATA_MIGRATION_HINT_CLEAR_DATA]: 'error.dataMigrationHint.clearData',
};

function resolveKeychainMessage(hintCode: string | undefined, t: TranslateFn): string {
  const base = t('error.keychainUnavailable');
  if (!hintCode) {
    return base;
  }

  const hintKey = KEYCHAIN_HINT_I18N_MAP[hintCode];
  if (!hintKey) {
    return base;
  }

  return `${base} ${t(hintKey)}`;
}

function resolveDataMigrationMessage(hintCode: string | undefined, t: TranslateFn): string {
  const base = t('error.dataMigrationFailed');
  if (!hintCode) {
    return base;
  }

  const hintKey = DATA_MIGRATION_HINT_I18N_MAP[hintCode];
  if (!hintKey) {
    return base;
  }

  return `${base} ${t(hintKey)}`;
}

function resolveGoogleAuthMessage(rawMessage: string, t: TranslateFn): string | null {
  const normalized = rawMessage.toLowerCase();

  if (normalized.includes('authorization code is required')) {
    return t('cloud.errors.authCodeRequired');
  }

  if (
    normalized.includes('authorization code was already used') ||
    normalized.includes('this google authorization code was already used')
  ) {
    return t('cloud.errors.authCodeAlreadyUsed');
  }

  if (
    normalized.includes('token exchange failed') &&
    (normalized.includes('invalid_grant') ||
      normalized.includes('invalid_request') ||
      normalized.includes('bad request'))
  ) {
    return t('cloud.errors.invalidAuthCode');
  }

  return null;
}

function resolveOfflineLikeMessage(rawMessage: string, t: TranslateFn): string | null {
  const normalized = rawMessage.toLowerCase();
  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('network request failed') ||
    normalized.includes('internet disconnected') ||
    normalized.includes('net::err_internet_disconnected') ||
    normalized.includes('err_internet_disconnected') ||
    normalized.includes('offline')
  ) {
    return t('error.offline');
  }

  return null;
}

function resolveCodexMessage(rawMessage: string, t: TranslateFn): string | null {
  const [normalized, detail] = rawMessage.trim().split('|');
  const directKey = CODEX_ERROR_I18N_MAP[normalized];
  if (directKey) {
    if (normalized === 'CODEX_ACCOUNT_ALREADY_EXISTS' && detail) {
      return t('cloud.errors.codexAccountAlreadyExistsWithIdentity', { identity: detail });
    }
    return t(directKey);
  }

  if (normalized.includes('CODEX_LOGIN_TIMEOUT')) {
    return t('cloud.errors.codexLoginTimeout');
  }

  if (normalized.includes('CODEX_LOGIN_FAILED')) {
    return t('cloud.errors.codexLoginFailed');
  }

  return null;
}

function resolveSwitchMessage(rawMessage: string, t: TranslateFn): string | null {
  const [code] = rawMessage.trim().split('|');
  const i18nKey = SWITCH_ERROR_I18N_MAP[code];
  return i18nKey ? t(i18nKey) : null;
}

function extractRawMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }

  return '';
}

function resolveKnownMessage(rawMessage: string, t: TranslateFn): string | null {
  const [code, hint] = rawMessage.split('|');
  if (code === GOOGLE_OAUTH_NOT_CONFIGURED) {
    return t('cloud.errors.googleOAuthNotConfigured');
  }
  if (code === AUTH_PORT_IN_USE) {
    return t('cloud.errors.authPortInUse');
  }
  if (code === PROXY_PORT_IN_USE) {
    return t('proxy.errors.portInUse');
  }
  if (code === INVALID_IMPORT_PASSWORD_OR_FILE) {
    return t('settings.operations.import.invalidFileOrPassword');
  }
  if (code === IMPORT_PREVIEW_EXPIRED) {
    return t('settings.operations.import.previewExpired');
  }
  if (code === EXPORT_PASSWORD_REQUIRED) {
    return t('settings.operations.export.passwordRequired');
  }
  if (code === IMPORT_PASSWORD_REQUIRED) {
    return t('settings.operations.import.passwordRequired');
  }
  if (code === KEYCHAIN_ERROR_CODE) {
    return resolveKeychainMessage(hint, t);
  }
  if (code === DATA_MIGRATION_ERROR_CODE) {
    return resolveDataMigrationMessage(hint, t);
  }
  const authMessage = resolveGoogleAuthMessage(rawMessage, t);
  if (authMessage) {
    return authMessage;
  }
  const offlineMessage = resolveOfflineLikeMessage(rawMessage, t);
  if (offlineMessage) {
    return offlineMessage;
  }
  const codexMessage = resolveCodexMessage(rawMessage, t);
  if (codexMessage) {
    return codexMessage;
  }
  const switchMessage = resolveSwitchMessage(rawMessage, t);
  if (switchMessage) {
    return switchMessage;
  }

  return null;
}

export function getLocalizedErrorMessage(
  error: unknown,
  t: TranslateFn,
  options?: LocalizedErrorOptions,
): string {
  const rawMessage = extractRawMessage(error);
  if (rawMessage) {
    const knownMessage = resolveKnownMessage(rawMessage, t);
    if (knownMessage) {
      return knownMessage;
    }
  }

  const fallbackKey = options?.fallbackKey ?? 'error.generic';
  return options?.fallbackOptions ? t(fallbackKey, options.fallbackOptions) : t(fallbackKey);
}
