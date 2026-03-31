import { describe, expect, it } from 'vitest';

import i18n from '../../localization/i18n';

function flattenKeys(
  value: unknown,
  prefix: string[] = [],
  result: Set<string> = new Set(),
): Set<string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix.length > 0) {
      result.add(prefix.join('.'));
    }
    return result;
  }

  for (const [key, child] of Object.entries(value)) {
    flattenKeys(child, [...prefix, key], result);
  }

  return result;
}

describe('i18n coverage', () => {
  it('keeps English and Turkish translation key sets aligned', () => {
    const resources = i18n.options.resources ?? {};
    const englishKeys = flattenKeys(resources.en?.translation ?? {});
    const turkishKeys = flattenKeys(resources.tr?.translation ?? {});

    expect([...englishKeys].sort()).toEqual([...turkishKeys].sort());
  });
});
