import { getCodexRemainingRequestPercent, getCodexWindowKind } from './codexMetadata';
import { getCodexRecordIdentityKey } from './codexIdentity';
import type { CodexAccountRecord, ManagedIdeQuotaWindow } from './types';

function getWeeklyQuotaWindow(account: CodexAccountRecord): ManagedIdeQuotaWindow | null {
  const windows = [account.snapshot?.quota?.primary, account.snapshot?.quota?.secondary];

  for (const window of windows) {
    if (window && getCodexWindowKind(window.windowDurationMins) === 'weekly') {
      return window;
    }
  }

  return null;
}

export function getCodexWeeklyRemainingPercent(account: CodexAccountRecord): number | null {
  return getCodexRemainingRequestPercent(getWeeklyQuotaWindow(account)?.usedPercent);
}

function getSortTimestamp(account: CodexAccountRecord): number {
  return account.lastRefreshedAt ?? account.snapshot?.lastUpdatedAt ?? account.createdAt;
}

function compareCodexAccountFreshness(left: CodexAccountRecord, right: CodexAccountRecord): number {
  if (left.isActive !== right.isActive) {
    return left.isActive ? -1 : 1;
  }

  const updatedAtDiff = right.updatedAt - left.updatedAt;
  if (updatedAtDiff !== 0) {
    return updatedAtDiff;
  }

  const refreshedAtDiff =
    (right.lastRefreshedAt ?? right.snapshot?.lastUpdatedAt ?? 0) -
    (left.lastRefreshedAt ?? left.snapshot?.lastUpdatedAt ?? 0);
  if (refreshedAtDiff !== 0) {
    return refreshedAtDiff;
  }

  const createdAtDiff = right.createdAt - left.createdAt;
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return left.id.localeCompare(right.id);
}

export function normalizeCodexAccounts(accounts: CodexAccountRecord[]): CodexAccountRecord[] {
  const preferredByIdentityKey = new Map<string, CodexAccountRecord>();

  for (const account of accounts) {
    const identityKey = getCodexRecordIdentityKey(account);
    const existing = preferredByIdentityKey.get(identityKey);
    if (!existing || compareCodexAccountFreshness(account, existing) < 0) {
      preferredByIdentityKey.set(identityKey, account);
    }
  }

  const deduped = Array.from(preferredByIdentityKey.values());
  const activeAccounts = deduped
    .filter((account) => account.isActive)
    .sort(compareCodexAccountFreshness);
  const activeId = activeAccounts[0]?.id ?? null;

  return deduped.map((account) => ({
    ...account,
    isActive: activeId ? account.id === activeId : account.isActive,
  }));
}

export function compareCodexAccounts(left: CodexAccountRecord, right: CodexAccountRecord): number {
  if (left.isActive !== right.isActive) {
    return left.isActive ? -1 : 1;
  }

  const leftWeeklyRemaining = getCodexWeeklyRemainingPercent(left);
  const rightWeeklyRemaining = getCodexWeeklyRemainingPercent(right);

  if (leftWeeklyRemaining !== rightWeeklyRemaining) {
    if (leftWeeklyRemaining === null) {
      return 1;
    }
    if (rightWeeklyRemaining === null) {
      return -1;
    }
    return rightWeeklyRemaining - leftWeeklyRemaining;
  }

  const timestampDiff = getSortTimestamp(right) - getSortTimestamp(left);
  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  return right.createdAt - left.createdAt;
}

export function sortCodexAccounts(accounts: CodexAccountRecord[]): CodexAccountRecord[] {
  return [...accounts].sort(compareCodexAccounts);
}

export function resolveLiveCodexAccount(
  accounts: CodexAccountRecord[],
  liveAccountIdentityKey: string | null | undefined,
): CodexAccountRecord | null {
  if (liveAccountIdentityKey) {
    const liveAccount =
      accounts.find((account) => getCodexRecordIdentityKey(account) === liveAccountIdentityKey) ??
      null;
    if (liveAccount) {
      return liveAccount;
    }
  }

  return accounts.find((account) => account.isActive) ?? null;
}

export function reconcileCodexAccountsWithLiveIdentity(
  accounts: CodexAccountRecord[],
  liveAccountIdentityKey: string | null | undefined,
): CodexAccountRecord[] {
  const activeAccount = resolveLiveCodexAccount(accounts, liveAccountIdentityKey);
  if (!activeAccount) {
    return accounts;
  }

  return accounts.map((account) => ({
    ...account,
    isActive: account.id === activeAccount.id,
  }));
}
