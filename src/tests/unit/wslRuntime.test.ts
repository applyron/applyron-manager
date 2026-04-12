import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecSync, mockExistsSync, mockReadFileSync, mockGetWindowsUser, mockIsWsl } =
  vi.hoisted(() => ({
    mockExecSync: vi.fn(),
    mockExistsSync: vi.fn(),
    mockReadFileSync: vi.fn(),
    mockGetWindowsUser: vi.fn(),
    mockIsWsl: vi.fn(),
  }));

vi.mock('child_process', () => ({
  execFileSync: mockExecSync,
  default: {
    execFileSync: mockExecSync,
  },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  },
}));

vi.mock('../../utils/platformPaths', () => ({
  getWindowsUser: mockGetWindowsUser,
  isWsl: mockIsWsl,
}));

import {
  getActiveVsCodeWindowRuntimeId,
  getActiveVsCodeWslAuthority,
  getWslExecutableCommand,
  resolveWslRuntimeHome,
} from '../../utils/wslRuntime';

describe('wslRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    process.env.SystemRoot = 'C:\\Windows';
    mockGetWindowsUser.mockReturnValue('ahmet');
    mockIsWsl.mockReturnValue(false);
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation((command: string, args?: string[]) => {
      if (command === 'C:\\Windows\\System32\\wsl.exe' && args?.join(' ') === '-l -q') {
        return Buffer.from(
          'U\0b\0u\0n\0t\0u\0\r\0\n\0d\0o\0c\0k\0e\0r\0-\0d\0e\0s\0k\0t\0o\0p\0\r\0\n\0',
        );
      }

      if (
        command === 'C:\\Windows\\System32\\wsl.exe' &&
        args?.join('\0') === ['-d', 'Ubuntu', 'sh', '-lc', 'printf "%s" "$HOME"'].join('\0')
      ) {
        return Buffer.from('/home/ahmet');
      }

      return Buffer.from('');
    });
  });

  it('detects the active WSL runtime from lastActiveWindow.remoteAuthority when folder is absent', () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        windowsState: {
          lastActiveWindow: {
            remoteAuthority: 'wsl+Ubuntu',
          },
        },
      }),
    );

    expect(getActiveVsCodeWindowRuntimeId()).toBe('wsl-remote');
    expect(getActiveVsCodeWslAuthority()).toBe('ubuntu');
  });

  it('still detects a Windows-local active runtime from the last active folder uri', () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        windowsState: {
          lastActiveWindow: {
            folder: 'file:///c%3A/Users/ahmet/Desktop/ApplyronManager',
          },
        },
      }),
    );

    expect(getActiveVsCodeWindowRuntimeId()).toBe('windows-local');
    expect(getActiveVsCodeWslAuthority()).toBeNull();
  });

  it('uses the absolute Windows wsl.exe path when resolving the active WSL runtime home', () => {
    const runtimeHome = resolveWslRuntimeHome('ubuntu');

    expect(getWslExecutableCommand()).toBe('C:\\Windows\\System32\\wsl.exe');
    expect(runtimeHome).toEqual({
      authority: 'ubuntu',
      distroName: 'Ubuntu',
      linuxHomePath: '/home/ahmet',
      accessibleHomePath: '\\\\wsl$\\Ubuntu\\home\\ahmet',
    });
    expect(mockExecSync).toHaveBeenNthCalledWith(
      1,
      'C:\\Windows\\System32\\wsl.exe',
      ['-l', '-q'],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      'C:\\Windows\\System32\\wsl.exe',
      ['-l', '-q'],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      3,
      'C:\\Windows\\System32\\wsl.exe',
      ['-d', 'Ubuntu', 'sh', '-lc', 'printf "%s" "$HOME"'],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  });

  it('falls back to the VS Code authority hint when WSL distro listing is unavailable', () => {
    mockExecSync.mockImplementation((command: string, args?: string[]) => {
      if (command === 'C:\\Windows\\System32\\wsl.exe' && args?.join(' ') === '-l -q') {
        throw new Error('spawn wsl.exe ENOENT');
      }

      if (
        command === 'C:\\Windows\\System32\\wsl.exe' &&
        args?.join('\0') === ['-d', 'ubuntu', 'sh', '-lc', 'printf "%s" "$HOME"'].join('\0')
      ) {
        return Buffer.from('/home/ahmet');
      }

      return Buffer.from('');
    });

    const runtimeHome = resolveWslRuntimeHome('ubuntu');

    expect(runtimeHome).toEqual({
      authority: 'ubuntu',
      distroName: 'ubuntu',
      linuxHomePath: '/home/ahmet',
      accessibleHomePath: '\\\\wsl$\\ubuntu\\home\\ahmet',
    });
  });

  it('detects the VS Code-enabled distro when storage authority is unavailable', () => {
    mockExecSync.mockImplementation((command: string, args?: string[]) => {
      if (command === 'C:\\Windows\\System32\\wsl.exe' && args?.join(' ') === '-l -q') {
        return Buffer.from(
          'U\0b\0u\0n\0t\0u\0\r\0\n\0d\0o\0c\0k\0e\0r\0-\0d\0e\0s\0k\0t\0o\0p\0\r\0\n\0',
        );
      }

      if (
        command === 'C:\\Windows\\System32\\wsl.exe' &&
        args?.join('\0') === ['-d', 'Ubuntu', 'sh', '-lc', 'printf "%s" "$HOME"'].join('\0')
      ) {
        return Buffer.from('/home/ahmet');
      }

      if (
        command === 'C:\\Windows\\System32\\wsl.exe' &&
        args?.join('\0') === ['-d', 'docker-desktop', 'sh', '-lc', 'printf "%s" "$HOME"'].join('\0')
      ) {
        return Buffer.from('/home/docker');
      }

      return Buffer.from('');
    });
    mockExistsSync.mockImplementation(
      (filePath: string) =>
        filePath === '\\\\wsl$\\Ubuntu\\home\\ahmet\\.vscode-server\\extensions',
    );

    const runtimeHome = resolveWslRuntimeHome(null);

    expect(runtimeHome).toEqual({
      authority: 'ubuntu',
      distroName: 'Ubuntu',
      linuxHomePath: '/home/ahmet',
      accessibleHomePath: '\\\\wsl$\\Ubuntu\\home\\ahmet',
    });
  });
});
