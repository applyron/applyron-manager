export const enCommon = {
  appName: 'Applyron Manager',
  app: {
    alreadyRunning: {
      title: 'Applyron Manager is already running',
      description: 'The existing window was focused instead of starting a second instance.',
    },
    offline: {
      title: 'Offline mode is active',
      description:
        'Network-dependent actions are temporarily disabled. Local diagnostics, settings, and portability tools remain available.',
    },
  },
  status: {
    checking: 'Checking status...',
    running: 'Managed IDE is running in background',
    stopped: 'Managed IDE service stopped',
    antigravityClosed: 'Antigravity is currently closed',
  },
  statusBar: {
    toolsLabel: 'Tools',
    classicActionLabel: 'Gemini App',
    classicShortLabel: 'Gemini',
    codexActionLabel: 'Codex App',
    codexShortLabel: 'Codex',
    checking: 'Checking',
    running: 'Running',
    stopped: 'Stopped',
    toggleFailedTitle: 'Managed IDE action failed',
    toggleFailedDescription: 'The requested start or stop action could not be completed.',
  },
  action: {
    stop: 'Stop',
    start: 'Start',
    switch: 'Switch',
    deleteBackup: 'Delete Backup',
    backupCurrent: 'Backup Current',
    retry: 'Retry',
    openLogs: 'Open Log Directory',
  },
  a11y: {
    openMenu: 'Open menu',
    menu: 'Menu',
    close: 'Close',
    expand: 'Expand',
    collapse: 'Collapse',
    expandAccount: 'Expand {{target}}',
    collapseAccount: 'Collapse {{target}}',
    selectAccount: 'Select {{target}}',
    actionsFor: 'Actions for {{target}}',
    toggleProviderGroup: 'Toggle {{provider}} group',
    minimize: 'Minimize',
    maximize: 'Maximize',
  },
  error: {
    generic: 'An unexpected error occurred.',
    offline: "You're offline right now. Reconnect to continue this network action.",
    keychainUnavailable: 'Keychain is unavailable.',
    keychainHint: {
      translocation: 'Detected macOS App Translocation. Move the app to /Applications and reopen.',
      keychainDenied:
        'Keychain access denied. The app may be unsigned; see README for the self-signing workaround.',
      signNotarize: 'Please use a signed and notarized build when available.',
    },
    dataMigrationFailed: 'Unable to decrypt legacy account data.',
    dataMigrationHint: {
      relogin: 'Please re-login or re-add your accounts.',
      clearData: 'If the issue persists, clear local account data and sign in again.',
    },
  },
  nav: {
    dashboard: 'Dashboard',
    accounts: 'Accounts',
    proxy: 'API Proxy',
    settings: 'Settings',
  },
  account: {
    current: 'Current',
    lastUsed: 'Last used {{time}}',
  },
  home: {
    title: 'Accounts',
    description: 'Manage your Antigravity Google Gemini accounts.',
    noBackups: {
      title: 'No backups found',
      description: 'Create a backup of your current Antigravity account to get started.',
      action: 'Backup Current Account',
    },
  },
  toast: {
    backupSuccess: {
      title: 'Success',
      description: 'Account backup created successfully.',
    },
    backupError: {
      title: 'Error',
      description: 'Failed to create backup: {{error}}',
    },
    switchSuccess: {
      title: 'Success',
      description: 'Switched account successfully.',
    },
    switchError: {
      title: 'Error',
      description: 'Failed to switch account: {{error}}',
    },
    deleteSuccess: {
      title: 'Success',
      description: 'Account backup deleted successfully.',
    },
    deleteError: {
      title: 'Error',
      description: 'Failed to delete backup: {{error}}',
    },
  },
} as const;
