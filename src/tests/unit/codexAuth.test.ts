import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { getCodexWorkspaceFromAuthFile } from '../../managedIde/codexAuth';

function createJwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

function createAuthFile(authClaims: Record<string, unknown>) {
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: createJwt({
        email: 'owner@example.com',
        'https://api.openai.com/auth': authClaims,
      }),
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      account_id: 'acc-1',
    },
    last_refresh: '2026-04-02T18:00:00.000Z',
  };
}

describe('getCodexWorkspaceFromAuthFile', () => {
  it('prefers non-personal organizations for team plans', () => {
    const workspace = getCodexWorkspaceFromAuthFile(
      createAuthFile({
        organizations: [
          { id: 'org-personal', title: 'Personal', role: 'owner', is_default: true },
          { id: 'org-vszone', title: 'VSZONE', role: 'member', is_default: false },
        ],
      }),
      { planType: 'team' },
    );

    expect(workspace).toEqual({
      id: 'org-vszone',
      title: 'VSZONE',
      role: 'member',
      isDefault: false,
    });
  });

  it('prefers explicit active organization hints when present', () => {
    const workspace = getCodexWorkspaceFromAuthFile(
      createAuthFile({
        active_organization_id: 'org-vszone-1',
        organizations: [
          { id: 'org-personal', title: 'Personal', role: 'owner', is_default: true },
          { id: 'org-vszone', title: 'VSZONE', role: 'member', is_default: false },
          { id: 'org-vszone-1', title: 'VSZONE1', role: 'member', is_default: false },
        ],
      }),
      { planType: 'team' },
    );

    expect(workspace).toEqual({
      id: 'org-vszone-1',
      title: 'VSZONE1',
      role: 'member',
      isDefault: false,
    });
  });

  it('falls back to name-style organization fields when title is missing', () => {
    const workspace = getCodexWorkspaceFromAuthFile(
      createAuthFile({
        organization: {
          organization_id: 'org-vszone',
          name: 'VSZONE',
          membership_role: 'owner',
        },
      }),
      { planType: 'team' },
    );

    expect(workspace).toEqual({
      id: 'org-vszone',
      title: 'VSZONE',
      role: 'owner',
      isDefault: false,
    });
  });
});
