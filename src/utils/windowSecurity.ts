export interface MainWindowNavigationOptions {
  devServerUrl?: string;
  isPackaged: boolean;
}

export function isAllowedMainWindowNavigation(
  targetUrl: string,
  options: MainWindowNavigationOptions,
): boolean {
  try {
    const parsedTargetUrl = new URL(targetUrl);

    if (options.isPackaged) {
      return parsedTargetUrl.protocol === 'file:';
    }

    if (!options.devServerUrl) {
      return parsedTargetUrl.protocol === 'file:';
    }

    return parsedTargetUrl.origin === new URL(options.devServerUrl).origin;
  } catch {
    return false;
  }
}

export function getDeniedWindowOpenHandlerResponse() {
  return { action: 'deny' as const };
}
