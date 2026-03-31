import { describe, expect, it } from 'vitest';

import {
  getCodexWeeklyRemainingPercent,
  normalizeCodexAccounts,
  sortCodexAccounts,
} from '../../managedIde/codexAccounts';
import type { CodexAccountRecord } from '../../managedIde/types';

function createDefaultSnapshot(
  accountId: string,
  email: string,
  lastUpdatedAt: number,
): NonNullable<CodexAccountRecord['snapshot']> {
  return {
    session: {
      state: 'ready',
      accountType: 'chatgpt',
      authMode: 'chatgpt',
      email,
      planType: 'team',
      requiresOpenaiAuth: false,
      serviceTier: 'flex',
      agentMode: 'full-access',
      lastUpdatedAt,
    },
    quota: {
      limitId: accountId,
      limitName: null,
      planType: 'team',
      primary: {
        usedPercent: 10,
        resetsAt: null,
        windowDurationMins: 300,
      },
      secondary: {
        usedPercent: 50,
        resetsAt: null,
        windowDurationMins: 10080,
      },
      credits: null,
    },
    quotaByLimitId: null,
    lastUpdatedAt,
  };
}

function createAccount(
  overrides: Partial<CodexAccountRecord> & Pick<CodexAccountRecord, 'id' | 'accountId'>,
): CodexAccountRecord {
  const createdAt = overrides.createdAt ?? 1;
  const email = overrides.email ?? `${overrides.accountId}@example.com`;
  return {
    id: overrides.id,
    email,
    label: overrides.label ?? null,
    accountId: overrides.accountId,
    authMode: overrides.authMode ?? 'chatgpt',
    isActive: overrides.isActive ?? false,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    lastRefreshedAt: overrides.lastRefreshedAt ?? createdAt,
    snapshot:
      overrides.snapshot ??
      createDefaultSnapshot(overrides.accountId, email, overrides.lastRefreshedAt ?? createdAt),
  };
}

describe('codexAccounts', () => {
  it('sorts active accounts first and then by weekly remaining percent', () => {
    const active = createAccount({
      id: 'active',
      accountId: 'acc-active',
      isActive: true,
      lastRefreshedAt: 10,
      createdAt: 10,
    });
    const highWeekly = createAccount({
      id: 'high',
      accountId: 'acc-high',
      lastRefreshedAt: 20,
      createdAt: 20,
      snapshot: {
        ...active.snapshot!,
        quota: {
          ...active.snapshot!.quota!,
          secondary: {
            usedPercent: 5,
            resetsAt: null,
            windowDurationMins: 10080,
          },
        },
        lastUpdatedAt: 20,
      },
    });
    const lowWeekly = createAccount({
      id: 'low',
      accountId: 'acc-low',
      lastRefreshedAt: 30,
      createdAt: 30,
      snapshot: {
        ...active.snapshot!,
        quota: {
          ...active.snapshot!.quota!,
          secondary: {
            usedPercent: 60,
            resetsAt: null,
            windowDurationMins: 10080,
          },
        },
        lastUpdatedAt: 30,
      },
    });

    expect(sortCodexAccounts([lowWeekly, highWeekly, active]).map((account) => account.id)).toEqual(
      ['active', 'high', 'low'],
    );
  });

  it('pushes accounts without weekly quota below those with weekly quota', () => {
    const withoutWeekly = createAccount({
      id: 'no-weekly',
      accountId: 'acc-noweekly',
      lastRefreshedAt: 100,
      snapshot: {
        ...createDefaultSnapshot('acc-noweekly', 'acc-noweekly@example.com', 100),
        quota: {
          ...createDefaultSnapshot('acc-noweekly', 'acc-noweekly@example.com', 100).quota!,
          secondary: null,
        },
        lastUpdatedAt: 100,
      },
    });
    const withWeekly = createAccount({
      id: 'with-weekly',
      accountId: 'acc-weekly',
      lastRefreshedAt: 50,
    });

    expect(sortCodexAccounts([withoutWeekly, withWeekly]).map((account) => account.id)).toEqual([
      'with-weekly',
      'no-weekly',
    ]);
    expect(getCodexWeeklyRemainingPercent(withoutWeekly)).toBeNull();
  });

  it('deduplicates duplicated account ids and keeps only the freshest active record', () => {
    const staleDuplicate = createAccount({
      id: 'dup-old',
      accountId: 'acc-duplicate',
      email: 'active@example.com',
      isActive: false,
      createdAt: 10,
      updatedAt: 10,
      lastRefreshedAt: 10,
    });
    const freshDuplicate = createAccount({
      id: 'dup-new',
      accountId: 'acc-duplicate',
      email: 'active@example.com',
      isActive: true,
      createdAt: 20,
      updatedAt: 30,
      lastRefreshedAt: 30,
    });
    const inactiveDifferentAccount = createAccount({
      id: 'other',
      accountId: 'acc-other',
      email: 'other@example.com',
      isActive: true,
      createdAt: 15,
      updatedAt: 15,
      lastRefreshedAt: 15,
    });

    const normalized = normalizeCodexAccounts([
      staleDuplicate,
      freshDuplicate,
      inactiveDifferentAccount,
    ]);

    expect(normalized).toHaveLength(2);
    expect(normalized.filter((account) => account.accountId === 'acc-duplicate')).toHaveLength(1);
    expect(normalized.find((account) => account.id === 'dup-new')?.isActive).toBe(true);
    expect(normalized.find((account) => account.id === 'other')?.isActive).toBe(false);
  });
});
