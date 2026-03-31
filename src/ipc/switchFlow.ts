import { type DeviceProfile } from '../types/account';
import { logger } from '../utils/logger';
import { closeAntigravity, startAntigravity, _waitForProcessExit } from './process/handler';
import { applyDeviceProfile } from './device/handler';
import {
  type SwitchFailureReason,
  recordSwitchFailure,
  recordSwitchRollback,
  recordSwitchSuccess,
} from './switchMetrics';

export interface SwitchFlowOptions {
  scope: 'local' | 'cloud';
  targetProfile: DeviceProfile | null;
  applyFingerprint: boolean;
  processExitTimeoutMs: number;
  performSwitch: () => Promise<void>;
}

export type SwitchFlowErrorCode =
  | 'close_failed'
  | 'process_exit_timeout'
  | 'missing_bound_profile'
  | 'apply_failed'
  | 'switch_failed'
  | 'start_failed';

export class SwitchFlowError extends Error {
  constructor(
    readonly code: SwitchFlowErrorCode,
    userMessage: string,
    cause?: unknown,
  ) {
    super(`${code}|${userMessage}`);
    this.name = 'SwitchFlowError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        configurable: true,
        enumerable: false,
        value: cause,
      });
    }
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function toSwitchFailureReason(error: unknown): SwitchFailureReason {
  if (error instanceof SwitchFlowError) {
    return error.code;
  }
  if (error instanceof Error && error.message.includes('missing bound device profile')) {
    return 'missing_bound_profile';
  }
  if (error instanceof Error && error.message.includes('device_apply_failed')) {
    return 'apply_failed';
  }
  return 'unknown';
}

async function attemptSwitchRecovery(scope: 'local' | 'cloud', stage: 'switch' | 'start') {
  try {
    await startAntigravity();
    recordSwitchRollback(scope, true);
    logger.warn(`Recovered managed IDE process after ${stage} stage failure.`);
  } catch (recoveryError) {
    recordSwitchRollback(scope, false);
    logger.error(
      `Failed to recover managed IDE process after ${stage} stage failure`,
      recoveryError,
    );
  }
}

export async function executeSwitchFlow(options: SwitchFlowOptions): Promise<void> {
  const { scope, targetProfile, applyFingerprint, processExitTimeoutMs, performSwitch } = options;

  try {
    try {
      await closeAntigravity();
    } catch (error) {
      throw new SwitchFlowError(
        'close_failed',
        'Managed IDE could not be closed before switching.',
        error,
      );
    }

    try {
      await _waitForProcessExit(processExitTimeoutMs);
    } catch (error) {
      throw new SwitchFlowError(
        'process_exit_timeout',
        'Managed IDE did not stop within the expected timeout.',
        error,
      );
    }

    if (applyFingerprint) {
      if (!targetProfile) {
        throw new SwitchFlowError(
          'missing_bound_profile',
          'Account has no bound identity profile.',
        );
      }
      try {
        applyDeviceProfile(targetProfile);
      } catch (error) {
        throw new SwitchFlowError(
          'apply_failed',
          'Failed to apply the bound identity profile.',
          error,
        );
      }
    } else {
      logger.warn('Identity profile apply is disabled by environment override.');
    }

    try {
      await performSwitch();
    } catch (error) {
      await attemptSwitchRecovery(scope, 'switch');
      throw new SwitchFlowError('switch_failed', 'Failed to apply the requested switch.', error);
    }

    try {
      await startAntigravity();
    } catch (error) {
      await attemptSwitchRecovery(scope, 'start');
      throw new SwitchFlowError(
        'start_failed',
        'Managed IDE failed to restart after switching.',
        error,
      );
    }

    recordSwitchSuccess(scope);
  } catch (error) {
    const reason = toSwitchFailureReason(error);
    const message = getErrorMessage(error);
    recordSwitchFailure(scope, reason, message);
    throw error;
  }
}
