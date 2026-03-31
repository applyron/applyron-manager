import { sortCodexAccounts } from './codexAccounts';
import type { CodexAccountRecord } from './types';

export type CodexHealthState = 'ready' | 'limited' | 'attention';

export function getCodexHealthState(account: CodexAccountRecord): CodexHealthState {
  const primary = account.snapshot?.quota?.primary?.usedPercent ?? 0;
  const secondary = account.snapshot?.quota?.secondary?.usedPercent ?? 0;

  if (primary >= 90 || secondary >= 90) {
    return 'limited';
  }

  if (account.snapshot?.session.state !== 'ready') {
    return 'attention';
  }

  return 'ready';
}

export function findBestCodexAutoSwitchCandidate(
  accounts: CodexAccountRecord[],
  activeAccountId: string,
): CodexAccountRecord | null {
  const candidates = accounts.filter(
    (account) => account.id !== activeAccountId && getCodexHealthState(account) === 'ready',
  );

  return sortCodexAccounts(candidates)[0] ?? null;
}
