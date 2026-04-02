import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getCodexChromeWorkspaceLabel,
  resetCodexChromeWorkspaceHintCacheForTests,
} from '../../managedIde/codexChromeWorkspaceHints';

describe('codexChromeWorkspaceHints', () => {
  const originalLocalAppData = process.env.LOCALAPPDATA;
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'applyron-codex-chrome-'));
    process.env.LOCALAPPDATA = tempRoot;
    resetCodexChromeWorkspaceHintCacheForTests();
  });

  afterEach(() => {
    resetCodexChromeWorkspaceHintCacheForTests();
    if (originalLocalAppData) {
      process.env.LOCALAPPDATA = originalLocalAppData;
    } else {
      delete process.env.LOCALAPPDATA;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('resolves team workspace labels from Chrome History invite URLs', () => {
    const profileDir = path.join(tempRoot, 'Google', 'Chrome', 'User Data', 'Profile 1');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(profileDir, 'History'),
      [
        'noise-before',
        'https://chatgpt.com/auth/login?inv_ws_name=VSZONE&inv_email=ahmetfarukturkogluyedek%40gmail.com&wId=acc-team-1&accept_wId=acc-team-1',
        'noise-after',
      ].join('\u0000'),
      'latin1',
    );

    expect(getCodexChromeWorkspaceLabel('acc-team-1', 'ahmetfarukturkogluyedek@gmail.com')).toBe(
      'VSZONE',
    );
  });

  it('prefers the most frequent label when the same account appears multiple times', () => {
    const profileDir = path.join(tempRoot, 'Google', 'Chrome', 'User Data', 'Default');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(profileDir, 'Favicons'),
      [
        'https://chatgpt.com/auth/login?inv_ws_name=VSZONE&wId=acc-team-2&accept_wId=acc-team-2',
        'https://chatgpt.com/auth/login?inv_ws_name=VSZONE&wId=acc-team-2&accept_wId=acc-team-2',
        'https://chatgpt.com/auth/login?inv_ws_name=Applyron&wId=acc-team-2&accept_wId=acc-team-2',
      ].join('\u0000'),
      'latin1',
    );

    expect(getCodexChromeWorkspaceLabel('acc-team-2')).toBe('VSZONE');
  });
});
