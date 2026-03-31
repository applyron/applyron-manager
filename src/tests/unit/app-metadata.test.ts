import { describe, expect, it } from 'vitest';

import {
  APP_DISPLAY_VERSION,
  APP_LICENSE_NAME,
  getPlatformDisplayName,
} from '../../config/appMetadata';

describe('app metadata', () => {
  it('exposes the configured display version and license labels', () => {
    expect(APP_DISPLAY_VERSION).toBe('V1.0 Beta');
    expect(APP_LICENSE_NAME).toBe('Applyron-001');
  });

  it('maps runtime platform ids to user-friendly labels', () => {
    expect(getPlatformDisplayName('win32')).toBe('Windows');
    expect(getPlatformDisplayName('darwin')).toBe('macOS');
    expect(getPlatformDisplayName('linux')).toBe('Linux');
    expect(getPlatformDisplayName('freebsd')).toBe('freebsd');
    expect(getPlatformDisplayName(null)).toBe('Unknown');
  });
});
