import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockOpenExternal } = vi.hoisted(() => ({
  mockOpenExternal: vi.fn(),
}));

vi.mock('electron', () => ({
  shell: {
    openExternal: mockOpenExternal,
  },
}));

import { normalizeExternalNavigationUrl, openExternalWithPolicy } from '@/utils/externalNavigation';

describe('external navigation policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenExternal.mockResolvedValue(undefined);
  });

  it('allows announcement links for approved HTTPS hosts', () => {
    expect(normalizeExternalNavigationUrl('announcement', 'https://applyron.com/releases/1')).toBe(
      'https://applyron.com/releases/1',
    );
    expect(
      normalizeExternalNavigationUrl('announcement', 'https://updates.applyron.com/changelog'),
    ).toBe('https://updates.applyron.com/changelog');
  });

  it('rejects announcement links for disallowed hosts or protocols', () => {
    expect(() =>
      normalizeExternalNavigationUrl('announcement', 'http://applyron.com/releases/1'),
    ).toThrow('Announcement links must use HTTPS.');
    expect(() =>
      normalizeExternalNavigationUrl('announcement', 'https://evil.example/releases/1'),
    ).toThrow('Announcement host is not allowed.');
  });

  it('allows only Google auth URLs for the google_auth intent', () => {
    expect(
      normalizeExternalNavigationUrl(
        'google_auth',
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=test',
      ),
    ).toBe('https://accounts.google.com/o/oauth2/v2/auth?client_id=test');

    expect(() =>
      normalizeExternalNavigationUrl('google_auth', 'https://google.com/o/oauth2/v2/auth'),
    ).toThrow('Google auth links must target accounts.google.com over HTTPS.');
  });

  it('restricts Codex login navigation to approved OpenAI hosts over HTTPS', () => {
    expect(normalizeExternalNavigationUrl('codex_login', 'https://chatgpt.com/auth/login')).toBe(
      'https://chatgpt.com/auth/login',
    );
    expect(normalizeExternalNavigationUrl('codex_login', 'https://platform.openai.com/login')).toBe(
      'https://platform.openai.com/login',
    );

    expect(() =>
      normalizeExternalNavigationUrl('codex_login', 'http://chatgpt.com/auth/login'),
    ).toThrow('Codex login links must use HTTPS.');
    expect(() =>
      normalizeExternalNavigationUrl('codex_login', 'https://evil.example/login'),
    ).toThrow('Codex login host is not allowed.');
  });

  it('restricts VS Code command navigation to the reload command', async () => {
    await openExternalWithPolicy({
      intent: 'vscode_command',
      url: 'vscode://command/workbench.action.reloadWindow',
    });

    expect(mockOpenExternal).toHaveBeenCalledWith('vscode://command/workbench.action.reloadWindow');

    expect(() =>
      normalizeExternalNavigationUrl('vscode_command', 'vscode://command/workbench.action.close'),
    ).toThrow('Only the VS Code reload command is allowed.');
  });
});
