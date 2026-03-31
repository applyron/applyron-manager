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
  await shell.openExternal(normalizeExternalNavigationUrl(input.intent, input.url));
}
