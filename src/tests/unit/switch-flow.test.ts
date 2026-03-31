import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCloseAntigravity = vi.fn();
const mockStartAntigravity = vi.fn();
const mockWaitForProcessExit = vi.fn();
const mockApplyDeviceProfile = vi.fn();
const mockRecordSwitchFailure = vi.fn();
const mockRecordSwitchRollback = vi.fn();
const mockRecordSwitchSuccess = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('../../ipc/process/handler', () => ({
  closeAntigravity: mockCloseAntigravity,
  startAntigravity: mockStartAntigravity,
  _waitForProcessExit: mockWaitForProcessExit,
}));

vi.mock('../../ipc/device/handler', () => ({
  applyDeviceProfile: mockApplyDeviceProfile,
}));

vi.mock('../../ipc/switchMetrics', () => ({
  recordSwitchFailure: mockRecordSwitchFailure,
  recordSwitchRollback: mockRecordSwitchRollback,
  recordSwitchSuccess: mockRecordSwitchSuccess,
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  },
}));

describe('executeSwitchFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCloseAntigravity.mockResolvedValue(undefined);
    mockStartAntigravity.mockResolvedValue(undefined);
    mockWaitForProcessExit.mockResolvedValue(undefined);
  });

  it('fails fast when the managed IDE does not exit before the timeout', async () => {
    const performSwitch = vi.fn();
    mockWaitForProcessExit.mockRejectedValueOnce(new Error('timeout'));

    const { executeSwitchFlow } = await import('../../ipc/switchFlow');

    await expect(
      executeSwitchFlow({
        scope: 'cloud',
        targetProfile: {
          machineId: 'm',
          macMachineId: 'mac',
          devDeviceId: 'dev',
          sqmId: 'sqm',
        },
        applyFingerprint: true,
        processExitTimeoutMs: 500,
        performSwitch,
      }),
    ).rejects.toThrow('process_exit_timeout|Managed IDE did not stop within the expected timeout.');

    expect(performSwitch).not.toHaveBeenCalled();
    expect(mockStartAntigravity).not.toHaveBeenCalled();
    expect(mockRecordSwitchFailure).toHaveBeenCalledWith(
      'cloud',
      'process_exit_timeout',
      expect.stringContaining('process_exit_timeout|'),
    );
  });

  it('attempts a single recovery start when performSwitch fails', async () => {
    const performSwitch = vi.fn(async () => {
      throw new Error('inject_failed');
    });

    const { executeSwitchFlow } = await import('../../ipc/switchFlow');

    await expect(
      executeSwitchFlow({
        scope: 'cloud',
        targetProfile: {
          machineId: 'm',
          macMachineId: 'mac',
          devDeviceId: 'dev',
          sqmId: 'sqm',
        },
        applyFingerprint: true,
        processExitTimeoutMs: 500,
        performSwitch,
      }),
    ).rejects.toThrow('switch_failed|Failed to apply the requested switch.');

    expect(mockStartAntigravity).toHaveBeenCalledTimes(1);
    expect(mockRecordSwitchRollback).toHaveBeenCalledWith('cloud', true);
    expect(mockRecordSwitchFailure).toHaveBeenCalledWith(
      'cloud',
      'switch_failed',
      expect.stringContaining('switch_failed|'),
    );
    expect(mockRecordSwitchSuccess).not.toHaveBeenCalled();
  });

  it('attempts one recovery restart if the post-switch start fails', async () => {
    mockStartAntigravity
      .mockRejectedValueOnce(new Error('boot_failed'))
      .mockResolvedValueOnce(undefined);
    const performSwitch = vi.fn(async () => undefined);

    const { executeSwitchFlow } = await import('../../ipc/switchFlow');

    await expect(
      executeSwitchFlow({
        scope: 'local',
        targetProfile: {
          machineId: 'm',
          macMachineId: 'mac',
          devDeviceId: 'dev',
          sqmId: 'sqm',
        },
        applyFingerprint: true,
        processExitTimeoutMs: 500,
        performSwitch,
      }),
    ).rejects.toThrow('start_failed|Managed IDE failed to restart after switching.');

    expect(mockStartAntigravity).toHaveBeenCalledTimes(2);
    expect(mockRecordSwitchRollback).toHaveBeenCalledWith('local', true);
    expect(mockRecordSwitchFailure).toHaveBeenCalledWith(
      'local',
      'start_failed',
      expect.stringContaining('start_failed|'),
    );
  });

  it('keeps user-facing switch warnings free of internal CRACK_* markers', async () => {
    const performSwitch = vi.fn(async () => undefined);

    const { executeSwitchFlow } = await import('../../ipc/switchFlow');

    await expect(
      executeSwitchFlow({
        scope: 'local',
        targetProfile: null,
        applyFingerprint: false,
        processExitTimeoutMs: 500,
        performSwitch,
      }),
    ).resolves.toBeUndefined();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Identity profile apply is disabled by environment override.',
    );
    for (const [message] of mockLoggerWarn.mock.calls) {
      expect(String(message)).not.toContain('CRACK_');
    }
  });
});
