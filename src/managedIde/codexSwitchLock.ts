let codexSwitchQueue: Promise<void> = Promise.resolve();
let codexSwitchLockDepth = 0;

export function runWithCodexSwitchLock<T>(action: () => Promise<T>): Promise<T> {
  const runAction = async () => {
    codexSwitchLockDepth += 1;
    try {
      return await action();
    } finally {
      codexSwitchLockDepth -= 1;
    }
  };

  if (codexSwitchLockDepth > 0) {
    return runAction();
  }

  const result = codexSwitchQueue.catch(() => undefined).then(runAction);
  codexSwitchQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function resetCodexSwitchLockForTesting(): void {
  codexSwitchQueue = Promise.resolve();
  codexSwitchLockDepth = 0;
}
