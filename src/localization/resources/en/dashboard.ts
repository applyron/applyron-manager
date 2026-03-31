export const enDashboard = {
  dashboard: {
    eyebrow: 'Mission Control',
    title: 'Dashboard',
    description:
      'Track updates, recent announcements, and the accounts currently powering your workspace.',
    stats: {
      activeAccounts: 'Active Accounts',
      announcements: 'Announcements',
      currentVersion: 'Current Build',
    },
    update: {
      kicker: 'Update Status',
      title: 'Application Updates',
      description: 'Keep this installation aligned with the latest Applyron Manager release.',
      currentVersionLabel: 'Installed version',
      latestVersionLabel: 'Latest version',
      lastCheckedLabel: 'Last checked',
      checkButton: 'Check for updates',
      restartButton: 'Restart and install',
      laterButton: 'Later',
      downloadingTitle: 'Update downloading',
      downloadingDescription:
        'Version {{version}} is downloading in the background. Restart will be available when the download completes.',
      readyTitle: 'Update ready to install',
      readyDescription:
        'Version {{version}} has been downloaded. Restart the app when you are ready to apply it.',
      status: {
        idle: 'Ready to check',
        checking: 'Checking now',
        up_to_date: 'Up to date',
        update_available: 'Update available',
        ready_to_install: 'Ready to install',
        unsupported: 'Unsupported',
        error: 'Action required',
      },
    },
    announcements: {
      kicker: 'Announcements',
      title: 'Latest Announcements',
      description: 'Release notes, maintenance windows, and important platform notices.',
      loading: 'Loading announcements...',
      emptyTitle: 'No announcements yet',
      emptyDescription: 'New updates and notices will appear here.',
      errorTitle: 'Announcements are temporarily unavailable',
      errorDescription: 'The dashboard could not load the remote feed right now.',
      level: {
        info: 'Info',
        success: 'Success',
        warning: 'Warning',
        critical: 'Critical',
      },
    },
    activeAccounts: {
      kicker: 'Active Accounts',
      title: 'Live Account Snapshot',
      description:
        'See which Antigravity and Codex accounts are currently active without leaving the dashboard.',
      goToAccounts: 'Go to Accounts',
      loading: 'Loading active accounts...',
      emptyTitle: 'No active account yet',
      emptyDescription: 'Activate an Antigravity or Codex account to see it here.',
      emptyClassic: 'No active Antigravity account selected.',
      emptyCodex: 'No active Codex account selected.',
      sources: {
        classic: 'Antigravity',
        codex: 'Codex',
      },
      slots: {
        antigravity: 'Antigravity',
        codex: 'Codex',
      },
      classicQuotaSummary: '{{percentage}}% avg across {{count}} visible models',
      classicNoQuota: 'No quota snapshot yet',
      primaryRemaining: 'Primary {{value}}% left',
      secondaryRemaining: 'Secondary {{value}}% left',
      planType: 'Plan {{value}}',
      codexNoQuota: 'No Codex quota snapshot yet',
    },
    health: {
      kicker: 'System Health',
      description: 'Live service state for config, auth, proxy, update, and transport layers.',
      lastUpdated: 'Updated',
      states: {
        idle: 'Idle',
        starting: 'Starting',
        ready: 'Ready',
        degraded: 'Degraded',
        unsupported: 'Unsupported',
        error: 'Error',
      },
      services: {
        config: 'Config',
        security: 'Credential Storage',
        updater: 'Updater',
        auth_server: 'Google Auth',
        proxy_server: 'API Proxy',
        cloud_monitor: 'Antigravity Monitor',
        codex_monitor: 'Codex Monitor',
        orpc_transport: 'ORPC Transport',
      },
    },
    operationalAlerts: {
      kicker: 'Operational Alerts',
      description:
        'Proactive warnings and blockers gathered from connectivity, account state, and runtime health.',
      emptyTitle: 'No active operational alerts',
      emptyDescription:
        'The current session looks healthy. New issues will surface here before they become blockers.',
      cta: {
        accounts: 'Open Accounts',
        proxy: 'Open Proxy',
        settings: 'Open Settings',
      },
      items: {
        offline: {
          title: 'The app is offline',
          description:
            'Remote operations like update checks and cloud refresh are paused until connectivity returns.',
        },
        service: {
          title: '{{service}} needs attention',
          description: '{{service}} is reporting {{state}}. {{message}}',
          noMessage: 'No additional detail is available yet.',
        },
        cloudTokenExpiring: {
          title: 'A cloud token is close to expiring',
          description: '{{identity}} should be refreshed before quota or proxy actions degrade.',
        },
        cloudExpired: {
          title: 'A cloud account has expired',
          description:
            '{{identity}} can no longer serve requests until it is refreshed or replaced.',
        },
        lowQuota: {
          title: 'All visible cloud quotas are under 10%',
          description:
            'Every cloud account with a quota snapshot is nearly exhausted. Plan a refresh or fallback now.',
        },
        codexRequiresLogin: {
          title: 'A Codex account needs sign-in',
          description: '{{identity}} requires a fresh login before it can be used again.',
        },
        noReadyCodex: {
          title: 'No Codex account is currently ready',
          description:
            'The Codex pool exists, but none of the saved accounts are in a ready state.',
        },
      },
    },
  },
} as const;
