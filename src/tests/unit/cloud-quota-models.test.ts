import { describe, expect, it } from 'vitest';

import {
  GEMINI_PRO_COMBINED_MODEL_ID,
  getCanonicalVisibleQuotaModels,
  summarizeCanonicalQuotaModels,
} from '@/utils/cloud-quota-models';
import { groupVisibleModelsByProvider } from '@/utils/provider-grouping';

describe('cloud quota model normalization', () => {
  it('keeps grouped and ungrouped quota summaries aligned', () => {
    const canonicalModels = getCanonicalVisibleQuotaModels(
      {
        'gemini-3.1-pro-low': { percentage: 72, resetTime: '2026-02-16T10:00:00Z' },
        'gemini-3.1-pro-high': { percentage: 58, resetTime: '2026-02-16T08:00:00Z' },
        'gemini-3-flash': { percentage: 44, resetTime: '2026-02-16T07:00:00Z' },
        'claude-sonnet-4-6': { percentage: 20, resetTime: '2026-02-16T06:00:00Z' },
        'gemini-1.5-pro': { percentage: 99, resetTime: '2026-02-16T05:00:00Z' },
      },
      {},
    );

    const summary = summarizeCanonicalQuotaModels(canonicalModels);
    const grouped = groupVisibleModelsByProvider(canonicalModels);

    expect(canonicalModels).toHaveLength(3);
    expect(canonicalModels.map((model) => model.id)).toContain(GEMINI_PRO_COMBINED_MODEL_ID);
    expect(canonicalModels.map((model) => model.id)).not.toContain('gemini-3.1-pro-low');
    expect(canonicalModels.map((model) => model.id)).not.toContain('gemini-3.1-pro-high');
    expect(canonicalModels.map((model) => model.id)).not.toContain('gemini-1.5-pro');
    expect(summary.visibleModelCount).toBe(grouped.visibleModels);
    expect(summary.overallPercentage).toBe(grouped.overallPercentage);
  });

  it('prefers API display_name and keeps fallback formatting', () => {
    const canonicalModels = getCanonicalVisibleQuotaModels(
      {
        'claude-sonnet-4-6': {
          percentage: 60,
          resetTime: '2026-02-16T09:00:00Z',
          display_name: 'Claude 4.6 Sonnet Custom',
        },
        'gemini-3-flash': {
          percentage: 50,
          resetTime: '2026-02-16T10:00:00Z',
        },
      },
      {},
    );

    expect(canonicalModels[0].displayName).toBe('Claude 4.6 Sonnet Custom');
    expect(canonicalModels[1].displayName).toBe('Gemini 3 Flash');
  });
});
