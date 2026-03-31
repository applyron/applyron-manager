import { describe, expect, it } from 'vitest';
import {
  getCodexRemainingRequestPercent,
  getCodexWindowKind,
  normalizeCodexAgentMode,
  normalizeCodexServiceTier,
  prettifyCodexValue,
} from '../../managedIde/codexMetadata';

describe('codexMetadata', () => {
  it('calculates remaining request percentage from usedPercent', () => {
    expect(getCodexRemainingRequestPercent(92)).toBe(8);
    expect(getCodexRemainingRequestPercent(81)).toBe(19);
    expect(getCodexRemainingRequestPercent(null)).toBeNull();
  });

  it('normalizes service tier and agent mode aliases', () => {
    expect(normalizeCodexServiceTier(' FAST ')).toBe('fast');
    expect(normalizeCodexServiceTier('standard')).toBe('standard');
    expect(normalizeCodexAgentMode('full_access')).toBe('full-access');
    expect(normalizeCodexAgentMode('read only')).toBe('read-only');
    expect(normalizeCodexAgentMode('workspacewrite')).toBe('workspace-write');
  });

  it('maps quota windows to known buckets', () => {
    expect(getCodexWindowKind(300)).toBe('fiveHours');
    expect(getCodexWindowKind(10080)).toBe('weekly');
    expect(getCodexWindowKind(60)).toBe('generic');
  });

  it('prettifies unknown normalized values for display fallbacks', () => {
    expect(prettifyCodexValue('danger-full-access')).toBe('Danger Full Access');
    expect(prettifyCodexValue('custom-tier')).toBe('Custom Tier');
  });
});
