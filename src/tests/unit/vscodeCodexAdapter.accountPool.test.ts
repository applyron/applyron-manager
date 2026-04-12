import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetCodexWorkspaceFromAuthFile,
  mockGetCodexChromeWorkspaceLabel,
  mockIsCodexTeamPlan,
  mockIsCodexPersonalWorkspace,
} = vi.hoisted(() => ({
  mockGetCodexWorkspaceFromAuthFile: vi.fn(),
  mockGetCodexChromeWorkspaceLabel: vi.fn(),
  mockIsCodexTeamPlan: vi.fn(),
  mockIsCodexPersonalWorkspace: vi.fn(),
}));

vi.mock('../../ipc/database/cloudHandler', () => ({
  isCloudStorageUnavailableError: vi.fn(() => false),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../utils/externalNavigation', () => ({
  openExternalWithPolicy: vi.fn(),
}));

vi.mock('../../managedIde/codexAccountStore', () => ({
  CodexAccountStore: {
    upsertAccount: vi.fn(),
    listAccounts: vi.fn(),
    readAuthFile: vi.fn(),
    getByIdentityKey: vi.fn(),
    getAccount: vi.fn(),
    updateSnapshot: vi.fn(),
    setHydrationState: vi.fn(),
  },
}));

vi.mock('../../managedIde/codexAuth', () => ({
  getCodexEmailHint: vi.fn(() => 'ahmet@example.com'),
  getCodexPlanTypeHint: vi.fn(() => 'team'),
  getCodexWorkspaceFromAuthFile: mockGetCodexWorkspaceFromAuthFile,
}));

vi.mock('../../managedIde/codexChromeWorkspaceHints', () => ({
  getCodexChromeWorkspaceLabel: mockGetCodexChromeWorkspaceLabel,
}));

vi.mock('../../managedIde/codexIdentity', () => ({
  getCodexIdentityKey: vi.fn(),
  getCodexWorkspaceLabel: vi.fn((workspace) => workspace?.title ?? null),
  isCodexPersonalWorkspace: mockIsCodexPersonalWorkspace,
  isCodexTeamPlan: mockIsCodexTeamPlan,
}));

vi.mock('../../managedIde/codexLoginUrl', () => ({
  ensureFreshCodexLoginUrl: vi.fn((url: string) => url),
}));

vi.mock('../../managedIde/vscodeCodexAdapter/status', () => ({
  buildRuntimeStatusFromAuthFile: vi.fn(),
  createCodexClient: vi.fn(),
  createCurrentStatusFromRuntimes: vi.fn(),
  normalizeManagedIdeAuthMode: vi.fn((value: string | null) => value),
  waitForAuthFile: vi.fn(),
  withTemporaryCodexHome: vi.fn(),
}));

describe('vscodeCodexAdapter/accountPool', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetCodexWorkspaceFromAuthFile.mockReset();
    mockGetCodexChromeWorkspaceLabel.mockReset();
    mockIsCodexTeamPlan.mockReset();
    mockIsCodexPersonalWorkspace.mockReset();
    mockIsCodexTeamPlan.mockReturnValue(true);
    mockIsCodexPersonalWorkspace.mockImplementation(
      (workspace) => workspace?.title === 'Personal workspace',
    );
  });

  it('prefers Chrome workspace labels for team accounts when the auth payload only exposes a personal workspace', async () => {
    mockGetCodexWorkspaceFromAuthFile.mockReturnValue({
      id: 'acct-1',
      title: 'Personal workspace',
      role: null,
      isDefault: true,
    });
    mockGetCodexChromeWorkspaceLabel.mockReturnValue('Applyron Team');

    const { getResolvedCodexWorkspace } =
      await import('../../managedIde/vscodeCodexAdapter/accountPool');

    const workspace = getResolvedCodexWorkspace(
      {
        OPENAI_API_KEY: null,
        last_refresh: null,
        auth_mode: 'chatgpt',
        tokens: {
          account_id: 'acct-1',
          id_token: 'id-token',
          access_token: 'access-token',
          refresh_token: 'refresh-token',
        },
      },
      'team',
      'ahmet@example.com',
    );

    expect(workspace?.title).toBe('Applyron Team');
    expect(workspace?.id).toBe('acct-1');
  });

  it('builds a re-login snapshot while preserving known account metadata', async () => {
    const { createReloginRequiredSnapshot } =
      await import('../../managedIde/vscodeCodexAdapter/accountPool');

    const snapshot = createReloginRequiredSnapshot({
      id: 'acct-1',
      accountId: 'acct-1',
      label: 'Main',
      email: 'ahmet@example.com',
      authMode: 'chatgpt',
      isActive: true,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 2,
      lastRefreshedAt: 3,
      workspace: null,
      snapshot: {
        session: {
          state: 'ready',
          accountType: 'chatgpt',
          authMode: 'chatgpt',
          email: 'ahmet@example.com',
          planType: 'team',
          requiresOpenaiAuth: false,
          serviceTier: 'flex',
          agentMode: 'full-auto',
          lastUpdatedAt: 3,
        },
        quota: null,
        quotaByLimitId: null,
        lastUpdatedAt: 3,
      },
    });

    expect(snapshot.session.state).toBe('requires_login');
    expect(snapshot.session.email).toBe('ahmet@example.com');
    expect(snapshot.session.authMode).toBe('chatgpt');
    expect(snapshot.session.serviceTier).toBe('flex');
  });
});
