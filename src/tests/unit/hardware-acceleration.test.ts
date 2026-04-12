import { describe, expect, it } from 'vitest';

import { shouldDisableHardwareAcceleration } from '../../main/hardwareAcceleration';

describe('shouldDisableHardwareAcceleration', () => {
  it('keeps GPU acceleration enabled by default', () => {
    expect(
      shouldDisableHardwareAcceleration({
        disableGpuEnv: undefined,
        isPackagedE2E: false,
      }),
    ).toBe(false);
  });

  it('disables GPU acceleration when explicitly opted out', () => {
    expect(
      shouldDisableHardwareAcceleration({
        disableGpuEnv: '1',
        isPackagedE2E: false,
      }),
    ).toBe(true);
  });

  it('disables GPU acceleration during packaged E2E runs', () => {
    expect(
      shouldDisableHardwareAcceleration({
        disableGpuEnv: undefined,
        isPackagedE2E: true,
      }),
    ).toBe(true);
  });
});
