import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { shell } from 'electron';

export const EXTERNAL_NAVIGATION_INTENTS = [
  'announcement',
  'google_auth',
  'codex_login',
  'vscode_command',
] as const;

export type ExternalNavigationIntent = (typeof EXTERNAL_NAVIGATION_INTENTS)[number];

const ANNOUNCEMENT_ALLOWED_HOSTS = new Set([
  'applyron.com',
  'www.applyron.com',
  'updates.applyron.com',
  'github.com',
]);
const GOOGLE_AUTH_HOST = 'accounts.google.com';
const VSCODE_RELOAD_WINDOW_URI = 'vscode://command/workbench.action.reloadWindow';
const CODEX_LOGIN_ALLOWED_HOSTS = new Set([
  'chatgpt.com',
  'chat.openai.com',
  'auth.openai.com',
  'openai.com',
  'platform.openai.com',
]);

function getChromeExecutablePath(): string | null {
  if (process.platform !== 'win32') {
    return null;
  }

  const candidates = [
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.env['PROGRAMFILES(X86)']
      ? path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.env.PROGRAMW6432
      ? path.join(process.env.PROGRAMW6432, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function openCodexLoginUrl(url: string): Promise<void> {
  const chromeExecutablePath = getChromeExecutablePath();
  if (chromeExecutablePath) {
    const child = spawn(chromeExecutablePath, [url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }

  await shell.openExternal(url);
}

function parseUrl(rawUrl: string): URL {
  try {
    return new URL(rawUrl);
  } catch {
    throw new Error('Invalid external URL.');
  }
}

export function normalizeExternalNavigationUrl(
  intent: ExternalNavigationIntent,
  rawUrl: string,
): string {
  const targetUrl = parseUrl(rawUrl);
  const hostname = targetUrl.hostname.toLowerCase();

  switch (intent) {
    case 'announcement':
      if (targetUrl.protocol !== 'https:') {
        throw new Error('Announcement links must use HTTPS.');
      }
      if (!ANNOUNCEMENT_ALLOWED_HOSTS.has(hostname)) {
        throw new Error('Announcement host is not allowed.');
      }
      return targetUrl.toString();
    case 'google_auth':
      if (targetUrl.protocol !== 'https:' || hostname !== GOOGLE_AUTH_HOST) {
        throw new Error('Google auth links must target accounts.google.com over HTTPS.');
      }
      return targetUrl.toString();
    case 'codex_login':
      if (targetUrl.protocol !== 'https:') {
        throw new Error('Codex login links must use HTTPS.');
      }
      if (!CODEX_LOGIN_ALLOWED_HOSTS.has(hostname)) {
        throw new Error('Codex login host is not allowed.');
      }
      return targetUrl.toString();
    case 'vscode_command':
      if (targetUrl.toString() !== VSCODE_RELOAD_WINDOW_URI) {
        throw new Error('Only the VS Code reload command is allowed.');
      }
      return targetUrl.toString();
    default:
      throw new Error('Unsupported external navigation intent.');
  }
}

export async function openExternalWithPolicy(input: {
  intent: ExternalNavigationIntent;
  url: string;
}): Promise<void> {
  const normalizedUrl = normalizeExternalNavigationUrl(input.intent, input.url);
  if (input.intent === 'codex_login') {
    await openCodexLoginUrl(normalizedUrl);
    return;
  }

  await shell.openExternal(normalizedUrl);
}
