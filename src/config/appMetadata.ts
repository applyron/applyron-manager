export const APP_DISPLAY_VERSION = 'V1.0 Beta';
export const APP_LICENSE_NAME = 'Applyron-001';

export function getPlatformDisplayName(platform: string | null | undefined): string {
  switch (platform) {
    case 'win32':
      return 'Windows';
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    default:
      return platform || 'Unknown';
  }
}
