export function shouldDisableHardwareAcceleration(options: {
  disableGpuEnv: string | undefined;
  isPackagedE2E: boolean;
}): boolean {
  return options.disableGpuEnv === '1' || options.isPackagedE2E;
}
