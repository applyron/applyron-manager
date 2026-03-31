import { describe, expect, it } from 'vitest';
import { createDarwinStaticReleaseJson } from '@/utils/staticUpdateRelease';

describe('static update release helpers', () => {
  it('creates a Squirrel.Mac-compatible RELEASES.json payload', () => {
    expect(
      createDarwinStaticReleaseJson({
        version: '0.10.0',
        zipFileName: 'Applyron.Manager_0.10.0_x64.zip',
        publishedAt: '2026-03-31T00:00:00.000Z',
      }),
    ).toEqual({
      version: '0.10.0',
      url: 'Applyron.Manager_0.10.0_x64.zip',
      name: '0.10.0',
      notes: 'Update to version 0.10.0',
      pub_date: '2026-03-31T00:00:00.000Z',
    });
  });
});
