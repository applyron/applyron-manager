export const enManagedIde = {
  managedIde: {
    title: 'VS Code Codex',
    description:
      'Monitor Windows Local and Remote-WSL Codex runtimes through the official OpenAI VS Code extension.',
    badges: {
      cached: 'Cached',
      running: 'Running',
    },
    actions: {
      refresh: 'Refresh Status',
      openIde: 'Open VS Code',
      openLogin: 'Open Codex Login',
    },
    availability: {
      ready: 'Ready',
      unsupported_platform:
        'This integration is available on Windows and WSL when paired with Windows VS Code.',
      ide_not_found: 'VS Code stable installation was not found.',
      extension_not_found: 'The official OpenAI VS Code extension was not found.',
      codex_cli_not_found: 'The bundled Codex CLI could not be found.',
      app_server_unavailable: 'Codex app-server is currently unavailable.',
      not_signed_in: 'Sign in to Codex from VS Code to continue.',
    },
    session: {
      ready: 'Signed in',
      requires_login: 'Sign-in required',
      unavailable: 'Unavailable',
    },
    installation: {
      ready: 'Ready',
      needsAttention: 'Needs attention',
      unavailableTitle: 'Installation unavailable',
    },
    sections: {
      installation: 'Installation',
      installationDescription:
        'Detect the stable VS Code installation and official OpenAI extension.',
      session: 'Session',
      sessionDescription: 'Read-only session snapshot collected from Codex app-server.',
      quota: 'Rate Limits',
      quotaDescription: 'Live Codex quota and credits summary.',
    },
    labels: {
      installation: 'Installation',
      session: 'Session',
      plan: 'Plan',
      serviceTier: 'Service tier',
      agentMode: 'Agent mode',
      lastUpdated: 'Last updated',
      ideVersion: 'VS Code version',
      extensionVersion: 'Extension version',
      idePath: 'VS Code path',
      extensionPath: 'Extension path',
      accountType: 'Account type',
      authMode: 'Auth mode',
      activeRuntime: 'Active runtime',
      requiresOpenaiAuth: 'Requires OpenAI auth',
      primaryWindow: 'Primary window',
      secondaryWindow: 'Secondary window',
      credits: 'Credits',
      limitName: 'Current limit',
      resetsAt: 'Resets at',
      additionalLimits: 'Additional limits',
    },
    runtimes: {
      windowsLocal: 'Windows Local',
      wslRemote: 'WSL Remote',
    },
    empty: {
      noAccount: 'No signed-in account detected',
      unknown: 'Unknown',
      unavailable: 'Unavailable',
      noQuota: 'No live rate limit snapshot is available yet.',
    },
    values: {
      yes: 'Yes',
      no: 'No',
      unlimited: 'Unlimited',
      creditsAvailable: 'Credits available',
      noCredits: 'No credits',
    },
    toast: {
      refreshFailedTitle: 'Failed to refresh Codex status',
      openIdeFailedTitle: 'Failed to open VS Code',
      openLoginFailedTitle: 'Failed to open Codex login',
    },
  },
} as const;
