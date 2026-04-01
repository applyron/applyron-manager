import { describe, expect, it } from 'vitest';
import { ensureFreshCodexLoginUrl } from '@/managedIde/codexLoginUrl';

describe('ensureFreshCodexLoginUrl', () => {
  it('leaves modern auth.openai.com authorize urls free of forced prompt parameters', () => {
    const result = new URL(
      ensureFreshCodexLoginUrl(
        'https://auth.openai.com/oauth/authorize?prompt=%5Bselect_account%5D&max_age=3600&login_hint=test@example.com',
      ),
    );

    expect(result.searchParams.get('prompt')).toBeNull();
    expect(result.searchParams.getAll('prompt')).toEqual([]);
    expect(result.searchParams.get('max_age')).toBeNull();
    expect(result.searchParams.get('login_hint')).toBeNull();
  });

  it('forces account-selection parameters only for legacy chatgpt auth urls', () => {
    const result = new URL(
      ensureFreshCodexLoginUrl(
        'https://chatgpt.com/auth/login?prompt[]=select_account&max_age[]=3600&foo=bar',
      ),
    );

    expect(result.searchParams.get('prompt')).toBe('select_account');
    expect(result.searchParams.getAll('prompt[]')).toEqual([]);
    expect(result.searchParams.get('max_age')).toBe('0');
    expect(result.searchParams.getAll('max_age[]')).toEqual([]);
    expect(result.searchParams.get('foo')).toBe('bar');
  });
});
