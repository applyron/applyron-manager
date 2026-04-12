export const enCloud = {
  cloud: {
    title: 'Accounts',
    description: 'Manage your Google Gemini account pool.',
    descriptionCombined: 'Manage your Gemini and Codex account pool.',
    autoSwitch: 'Auto-Switch',
    providerGroupings: 'Provider Groupings',
    connectedIdentities: {
      title: 'Connected AI Identities',
      description: 'Manage your neural network integrations',
      addNew: 'Add New Account',
    },
    addAccount: 'Add Account',
    syncFromIDE: 'Sync from IDE',
    checkQuota: 'Check Quota Now',
    polling: 'Polling triggered',
    globalQuota: 'Global Quota',
    tabs: {
      gemini: 'Gemini',
      codex: 'Codex',
    },
    codex: {
      description:
        'Manage your Codex account pool and switch the active VS Code Codex session from Applyron Manager.',
      badges: {
        runtimeMismatch: 'Runtime mismatch',
        runtimeSelectionNeeded: 'Runtime selection needed',
      },
      source: 'Source',
      remainingRequests: 'Remaining request limit',
      accountCardDescription:
        'Each account is stored securely by Applyron Manager and can become the active VS Code Codex session.',
      singleSessionNote:
        'Codex accounts are stored in Applyron Manager and applied to VS Code automatically when you activate one.',
      emptyTitle: 'No Codex account added yet',
      emptyDescription:
        'Import your current VS Code session or add a new ChatGPT/Codex account to start building your Codex pool.',
      stats: {
        ready: 'Ready',
      },
      health: {
        ready: 'Healthy',
        limited: 'Limited',
        attention: 'Needs attention',
      },
      labels: {
        accountIdPrefix: 'Account ID: {{id}}',
        workspacePrefix: 'Workspace: {{name}}',
        plan: 'Plan',
        serviceTier: 'Service tier',
        agentMode: 'Agent mode',
        status: 'Status',
        primaryQuota: 'Primary window',
        secondaryQuota: 'Secondary window',
      },
      actions: {
        refreshAll: 'Refresh All',
        importCurrent: 'Import Current Session',
        activate: 'Activate',
        syncRuntime: 'WSL Sync',
      },
      runtime: {
        activeRuntime: 'Active runtime: {{name}}',
        selectionTitle: 'Choose which runtime should receive Codex account actions.',
        selectionDescription:
          'Windows Local and WSL Remote are both available, but the active VS Code side could not be detected automatically.',
        useWindowsLocal: 'Use Windows Local',
        useWslRemote: 'Use WSL Remote',
        stateSummary: '{{name}} · {{state}}',
      },
      pendingApply: {
        title: 'Codex account change is queued',
        description:
          '{{account}} is selected for {{runtime}}. Reload or close VS Code to apply this account.',
        reloadAction: 'Reload VS Code',
      },
      confirmDelete: 'Remove {{target}} from the Codex pool?',
      windows: {
        fiveHours: '5-hour window',
        weekly: 'Weekly window',
        generic: 'Request window',
      },
      values: {
        serviceTier: {
          fast: 'Fast',
          flex: 'Flex',
          priority: 'Priority',
          standard: 'Standard',
        },
        agentMode: {
          fullAccess: 'Full access',
          readOnly: 'Read only',
          workspaceWrite: 'Workspace write',
          dangerFullAccess: 'Danger full access',
        },
      },
      toast: {
        addedTitle: 'Codex account added',
        addedDescription: 'A new ChatGPT/Codex account is now stored in your Applyron pool.',
        addedBatchDescription:
          '{{count}} workspaces from the consent screen were added as separate Codex accounts.',
        addFailedTitle: 'Failed to add Codex account',
        importedTitle: 'Codex session imported',
        importedDescription:
          'The current VS Code Codex session was added to your Applyron pool and set as active.',
        importFailedTitle: 'Failed to import Codex session',
        activatedTitle: 'Codex account activated',
        activatedDescription: 'Applyron Manager switched VS Code Codex to the selected account.',
        deferredActivationTitle: 'Codex account queued',
        deferredActivationDescription:
          '{{account}} will be applied to {{runtime}} after you reload or close VS Code.',
        activateFailedTitle: 'Failed to activate Codex account',
        deletedTitle: 'Codex account removed',
        deletedDescription: 'The selected Codex account was removed from your Applyron pool.',
        deleteFailedTitle: 'Failed to remove Codex account',
        loginRequiredTitle: 'Codex sign-in required',
        loginRequiredDescription:
          'Open VS Code and sign in from the official OpenAI extension, then try again.',
        runtimeSyncTitle: 'WSL runtime sync completed',
        runtimeSyncDescription: '{{source}} -> {{target}}',
        runtimeSyncFailedTitle: 'WSL runtime sync failed',
        runtimeSyncWarningTitle: 'WSL runtime sync completed with warnings',
        runtimeSyncWarningDescription: '{{source}} -> {{target}}. {{warnings}}',
      },
    },
    stats: {
      total: 'Total Accounts',
      active: 'Active',
      rateLimited: 'Rate Limited',
    },
    layout: {
      auto: 'Auto',
      twoCol: '2 Columns',
      threeCol: '3 Columns',
      list: 'List',
    },
    authDialog: {
      title: 'Add Google Account',
      description: 'To add an account, you need to authorize the application.',
      openLogin: 'Open Login Page',
      offlineHint: 'Sign-in start is unavailable while the app is offline.',
      startErrorTitle: 'Google sign-in could not be started',
      authCode: 'Authorization Code',
      placeholder: 'Paste the code starting with 4/...',
      instruction:
        'Will open default browser for Google login. Copy the code from localhost page and paste here.',
      verify: 'Verify & Add',
    },
    card: {
      active: 'Active',
      use: 'Use',
      rateLimited: 'Rate Limited',
      expired: 'Expired',
      left: 'left',
      used: 'Used',
      unknown: 'Unknown User',
      actions: 'Actions',
      quotaUsage: 'QUOTA USAGE',
      useAccount: 'Use Account',
      identityProfile: 'Identity Profile',
      refresh: 'Refresh Quota',
      delete: 'Delete Account',
      noQuota: 'No quota data',
      rateLimitedQuota: 'Rate Limited',
      resetPrefix: 'reset',
      resetTime: 'Reset time',
      resetUnknown: 'Unknown',
      gemini3Ready: 'Gemini 3 Ready',
      groupGoogleGemini: 'Google Gemini',
      groupAnthropicClaude: 'Anthropic Claude',
    },
    identity: {
      title: 'Identity Profile',
      loading: 'Loading...',
      generateAndBind: 'Create and Bind',
      captureAndBind: 'Capture and Bind Current',
      restoreOriginal: 'Restore Baseline',
      openFolder: 'Open Identity Storage',
      previewTitle: 'Generated Identity Preview',
      confirm: 'Confirm',
      cancel: 'Cancel',
      close: 'Close',
      currentStorage: 'Current Runtime Identity',
      accountBinding: 'Bound Account Identity',
      history: 'Identity History',
      noHistory: 'No identity history',
      current: 'Active',
      restore: 'Restore',
      generateSuccess: 'Identity created and bound',
      captureSuccess: 'Current identity captured and bound',
      restoreOriginalSuccess: 'Baseline identity restored',
      restoreVersionSuccess: 'Historical identity restored',
      deleteVersionSuccess: 'Historical identity deleted',
      openFolderSuccess: 'Identity storage opened',
      baseline: 'Baseline Identity',
    },
    list: {
      noAccounts: 'No cloud accounts added yet.',
      emptyDescription: 'Click "Add New Account" to connect a provider',
    },
    error: {
      loadFailed: 'Failed to load cloud accounts.',
    },
    errors: {
      googleOAuthNotConfigured:
        'Google sign-in is not configured for this build. Set APPLYRON_GOOGLE_CLIENT_ID and APPLYRON_GOOGLE_CLIENT_SECRET, then try again.',
      authPortInUse:
        'Google sign-in could not start because the local loopback port is already in use.',
      authCodeRequired: 'Paste a valid Google authorization code to continue.',
      authCodeAlreadyUsed:
        'This Google authorization code was already used. Start a new login flow and try again.',
      invalidAuthCode:
        'This Google authorization code is invalid or expired. Start a new login flow and try again.',
      authFlowStartFailed: 'Google sign-in could not be started. Please try again.',
      codexIdeUnavailable:
        'VS Code Codex is not available on this device yet. Check the installation and try again.',
      codexCurrentSessionUnavailable:
        'No active Codex session could be imported. Sign in from VS Code and try again.',
      codexAuthFileNotFound: 'The selected Codex account credentials could not be found.',
      codexAccountNotFound: 'The selected Codex account was not found.',
      codexAccountStoreUnavailable:
        'Codex account storage is not ready yet. Please try again in a moment.',
      codexAccountSaveFailed:
        'The Codex account could not be saved locally. Check local storage access and try again.',
      codexAccountPoolUnavailable:
        'The Codex account pool could not be read right now. Please try again.',
      codexAccountAlreadyExists:
        'This Codex account is already in your Applyron pool. Sign in with a different account to create a new card.',
      codexAccountAlreadyExistsWithIdentity:
        'The returned Codex account is already in your Applyron pool: {{identity}}. Sign in with a different account to create a new card.',
      codexLoginTimeout:
        'Codex sign-in timed out before completion. Finish the browser login and try again.',
      codexLoginFailed: 'Codex sign-in could not be completed. Please try the login flow again.',
      codexDeleteActiveBlocked:
        'The active Codex account cannot be deleted. Activate another account first.',
      codexRuntimeSelectionRequired:
        'Choose the active Codex runtime first, then try the action again.',
      codexRuntimeSyncUnavailable:
        'WSL sync is only available when both Windows Local and WSL Remote runtimes are installed.',
      codexRuntimeSyncAuthFailed: 'The target runtime auth file could not be updated.',
      codexRuntimeSyncStateFailed:
        'The target runtime OpenAI extension state could not be updated.',
      codexRuntimeSyncAuthSkipped:
        'Auth data was skipped because the source or target auth file was missing.',
      codexRuntimeSyncStateSkipped:
        'Extension state was skipped because the source or target state database was missing.',
      switch: {
        closeFailed: 'The managed IDE could not be closed before switching accounts.',
        processExitTimeout:
          'The managed IDE did not stop in time, so the account switch was aborted.',
        missingBoundProfile: 'The selected account has no bound identity profile.',
        applyFailed: 'The bound identity profile could not be applied.',
        switchFailed: 'The account switch could not be completed safely.',
        startFailed: 'The managed IDE failed to restart after the switch attempt.',
      },
    },
    toast: {
      syncSuccess: {
        title: 'Sync Successful',
        description: 'Imported {{email}} from IDE.',
      },
      syncFailed: {
        title: 'Sync Failed',
        description: 'No active account found in IDE database.',
      },
      addSuccess: 'Account added successfully!',
      addFailed: {
        title: 'Failed to add account',
      },
      quotaRefreshed: 'Quota refreshed',
      refreshFailed: 'Failed to refresh quota',
      pollFailed: 'Failed to poll quota for all accounts',
      switched: {
        title: 'Account switched!',
        description: 'Restarting managed IDE...',
      },
      switchFailed: 'Failed to switch account',
      deleted: 'Account deleted',
      deleteFailed: 'Failed to delete account',
      deleteConfirm: 'Are you sure you want to delete this account?',
      autoSwitchOn: 'Auto-Switch Enabled',
      autoSwitchOff: 'Auto-Switch Disabled',
      updateSettingsFailed: 'Failed to update settings',
      startAuthFailed: 'Failed to start sign-in flow',
    },
    batch: {
      selected: 'Selected {{count}}',
      delete: 'Delete Selected',
      refresh: 'Refresh Selected',
      selectAll: 'Select All',
      clear: 'Clear Selection',
      confirmDelete: 'Are you sure you want to delete {{count}} accounts?',
      refreshTriggered: 'Triggered refresh for {{count}} accounts.',
      deleted: 'Deleted {{count}} accounts.',
      partialDeleteTitle: 'Some accounts could not be deleted',
      resultSummary: '{{deletedCount}} deleted / {{failedCount}} failed',
    },
  },
} as const;
