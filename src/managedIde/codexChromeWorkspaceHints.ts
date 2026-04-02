import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

interface CodexChromeWorkspaceInvite {
  accountId: string;
  workspaceLabel: string;
  invitedEmail: string | null;
}

interface CodexChromeWorkspaceHintCache {
  expiresAt: number;
  invites: CodexChromeWorkspaceInvite[];
}

const CHROME_HINT_CACHE_TTL_MS = 60_000;
const CHATGPT_WORKSPACE_INVITE_URL_PREFIX = 'https://chatgpt.com/auth/login?';

let cachedChromeWorkspaceHints: CodexChromeWorkspaceHintCache | null = null;

function normalizeHintText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getChromeUserDataRoot(): string | null {
  const localAppData = normalizeHintText(process.env.LOCALAPPDATA);
  if (!localAppData) {
    return null;
  }

  const chromeUserDataRoot = path.join(localAppData, 'Google', 'Chrome', 'User Data');
  return fs.existsSync(chromeUserDataRoot) ? chromeUserDataRoot : null;
}

function listChromeProfileDirectories(chromeUserDataRoot: string): string[] {
  try {
    return fs
      .readdirSync(chromeUserDataRoot, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && (entry.name === 'Default' || /^Profile \d+$/u.test(entry.name)),
      )
      .map((entry) => path.join(chromeUserDataRoot, entry.name));
  } catch (error) {
    logger.debug(`Failed to enumerate Chrome profiles for Codex workspace hints: ${String(error)}`);
    return [];
  }
}

function readWorkspaceInviteUrls(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(filePath);
    const content = Buffer.isBuffer(raw) ? raw.toString('latin1') : String(raw);
    const urls: string[] = [];
    let searchStart = 0;

    while (searchStart < content.length) {
      const matchStart = content.indexOf(CHATGPT_WORKSPACE_INVITE_URL_PREFIX, searchStart);
      if (matchStart === -1) {
        break;
      }

      let matchEnd = matchStart + CHATGPT_WORKSPACE_INVITE_URL_PREFIX.length;
      while (matchEnd < content.length) {
        const currentCharacter = content[matchEnd];
        const codePoint = currentCharacter.codePointAt(0) ?? 0;
        if (
          codePoint <= 0x20 ||
          currentCharacter === '"' ||
          currentCharacter === "'" ||
          currentCharacter === '`' ||
          currentCharacter === '<' ||
          currentCharacter === '>'
        ) {
          break;
        }
        matchEnd += 1;
      }

      urls.push(content.slice(matchStart, matchEnd));
      searchStart = matchEnd;
    }

    return urls;
  } catch (error) {
    logger.debug(`Failed to read Chrome workspace hint file ${filePath}: ${String(error)}`);
    return [];
  }
}

function parseWorkspaceInviteUrl(urlValue: string): CodexChromeWorkspaceInvite | null {
  try {
    const parsed = new URL(urlValue);
    if (parsed.hostname !== 'chatgpt.com' || parsed.pathname !== '/auth/login') {
      return null;
    }

    const workspaceLabel = normalizeHintText(parsed.searchParams.get('inv_ws_name'));
    const accountId =
      normalizeHintText(parsed.searchParams.get('wId')) ??
      normalizeHintText(parsed.searchParams.get('accept_wId'));

    if (!workspaceLabel || !accountId) {
      return null;
    }

    return {
      accountId,
      workspaceLabel,
      invitedEmail: normalizeHintText(parsed.searchParams.get('inv_email'))?.toLowerCase() ?? null,
    };
  } catch {
    return null;
  }
}

function scanChromeWorkspaceInvites(): CodexChromeWorkspaceInvite[] {
  const chromeUserDataRoot = getChromeUserDataRoot();
  if (!chromeUserDataRoot) {
    return [];
  }

  const profileDirectories = listChromeProfileDirectories(chromeUserDataRoot);
  const invites: CodexChromeWorkspaceInvite[] = [];

  for (const profileDirectory of profileDirectories) {
    for (const fileName of ['History', 'Favicons']) {
      const filePath = path.join(profileDirectory, fileName);
      for (const urlValue of readWorkspaceInviteUrls(filePath)) {
        const invite = parseWorkspaceInviteUrl(urlValue);
        if (invite) {
          invites.push(invite);
        }
      }
    }
  }

  return invites;
}

function getCachedChromeWorkspaceInvites(): CodexChromeWorkspaceInvite[] {
  const now = Date.now();
  if (cachedChromeWorkspaceHints && cachedChromeWorkspaceHints.expiresAt > now) {
    return cachedChromeWorkspaceHints.invites;
  }

  const invites = scanChromeWorkspaceInvites();
  cachedChromeWorkspaceHints = {
    invites,
    expiresAt: now + CHROME_HINT_CACHE_TTL_MS,
  };
  return invites;
}

export function getCodexChromeWorkspaceLabel(
  accountId: string | null | undefined,
  email?: string | null,
): string | null {
  const normalizedAccountId = normalizeHintText(accountId);
  if (!normalizedAccountId) {
    return null;
  }

  const normalizedEmail = normalizeHintText(email)?.toLowerCase() ?? null;
  const candidates = getCachedChromeWorkspaceInvites().filter(
    (invite) => invite.accountId === normalizedAccountId,
  );
  if (candidates.length === 0) {
    return null;
  }

  const labelStats = new Map<
    string,
    {
      exactEmailMatches: number;
      totalMatches: number;
    }
  >();

  for (const candidate of candidates) {
    const current = labelStats.get(candidate.workspaceLabel) ?? {
      exactEmailMatches: 0,
      totalMatches: 0,
    };
    current.totalMatches += 1;
    if (normalizedEmail && candidate.invitedEmail === normalizedEmail) {
      current.exactEmailMatches += 1;
    }
    labelStats.set(candidate.workspaceLabel, current);
  }

  return (
    [...labelStats.entries()]
      .sort((left, right) => {
        const exactEmailDiff = right[1].exactEmailMatches - left[1].exactEmailMatches;
        if (exactEmailDiff !== 0) {
          return exactEmailDiff;
        }

        const totalMatchDiff = right[1].totalMatches - left[1].totalMatches;
        if (totalMatchDiff !== 0) {
          return totalMatchDiff;
        }

        return left[0].localeCompare(right[0]);
      })
      .at(0)?.[0] ?? null
  );
}

export function resetCodexChromeWorkspaceHintCacheForTests(): void {
  cachedChromeWorkspaceHints = null;
}
