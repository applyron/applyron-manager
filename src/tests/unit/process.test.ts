import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock find-process module
vi.mock('find-process', () => ({
  default: vi.fn(),
}));

const { mockExecSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execSync: mockExecSync,
  default: {
    exec: vi.fn(),
    execSync: mockExecSync,
  },
}));

// Mock logger to avoid console output during tests
vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock paths module to avoid child_process issues
vi.mock('../../utils/paths', () => ({
  getManagedIdeExecutablePath: vi.fn(() => '/path/to/antigravity'),
  isWsl: vi.fn(() => false),
}));

// Import after mocks are set up
import {
  isManagedIdeProcessRunning,
  isProcessRunning,
  closeAntigravity,
  startAntigravity,
} from '../../ipc/process/handler';
import findProcess from 'find-process';

describe('Process Handler', () => {
  const mockFindProcess = findProcess as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReset();
  });

  describe('isProcessRunning', () => {
    it('should return true when Antigravity main process is found on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      Object.defineProperty(process, 'pid', { value: 1000, configurable: true });

      mockFindProcess.mockResolvedValue([
        {
          pid: 12345,
          name: 'Antigravity',
          cmd: '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
        },
      ]);

      const result = await isProcessRunning();
      expect(result).toBe(true);
      expect(mockFindProcess).toHaveBeenCalledWith('name', 'Antigravity', true);
    });

    it('should return false when only helper processes are found', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      Object.defineProperty(process, 'pid', { value: 1000, configurable: true });

      mockFindProcess.mockResolvedValue([
        {
          pid: 12346,
          name: 'Antigravity Helper (Renderer)',
          cmd: '/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper (Renderer).app --type=renderer',
        },
        {
          pid: 12347,
          name: 'Antigravity Helper (GPU)',
          cmd: '/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper (GPU).app --type=gpu-process',
        },
      ]);

      const result = await isProcessRunning();
      expect(result).toBe(false);
    });

    it('should return false when only manager process is found', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      Object.defineProperty(process, 'pid', { value: 1000, configurable: true });

      mockFindProcess.mockResolvedValue([
        {
          pid: 12348,
          name: 'Antigravity Manager',
          cmd: '/Applications/Antigravity Manager.app/Contents/MacOS/Antigravity Manager',
        },
      ]);

      const result = await isProcessRunning();
      expect(result).toBe(false);
    });

    it('should return false when no processes are found', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      Object.defineProperty(process, 'pid', { value: 1000, configurable: true });

      mockFindProcess.mockResolvedValue([]);

      const result = await isProcessRunning();
      expect(result).toBe(false);
    });

    it('should skip self process', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      Object.defineProperty(process, 'pid', { value: 12345, configurable: true });

      mockFindProcess.mockResolvedValue([
        {
          pid: 12345, // Same as current PID
          name: 'Antigravity',
          cmd: '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
        },
      ]);

      const result = await isProcessRunning();
      expect(result).toBe(false);
    });

    it('should return true when Antigravity.exe is found on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      Object.defineProperty(process, 'pid', { value: 1000, configurable: true });

      mockFindProcess.mockResolvedValue([
        {
          pid: 12345,
          name: 'Antigravity.exe',
          cmd: 'C:\\Program Files\\Antigravity\\Antigravity.exe',
        },
      ]);

      const result = await isProcessRunning();
      expect(result).toBe(true);
    });

    it('should return true when antigravity is found on Linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      Object.defineProperty(process, 'pid', { value: 1000, configurable: true });

      mockFindProcess.mockResolvedValue([
        {
          pid: 12345,
          name: 'antigravity',
          cmd: '/usr/bin/antigravity',
        },
      ]);

      const result = await isProcessRunning();
      expect(result).toBe(true);
    });

    it('should handle find-process errors gracefully', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      Object.defineProperty(process, 'pid', { value: 1000, configurable: true });

      mockFindProcess.mockRejectedValue(new Error('Process enumeration failed'));

      const result = await isProcessRunning();
      expect(result).toBe(false);
    });

    it('should exclude processes with --type= argument', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      Object.defineProperty(process, 'pid', { value: 1000, configurable: true });

      mockFindProcess.mockResolvedValue([
        {
          pid: 12345,
          name: 'Antigravity',
          cmd: '/Applications/Antigravity.app/Contents/MacOS/Antigravity --type=utility',
        },
      ]);

      const result = await isProcessRunning();
      expect(result).toBe(false);
    });

    it('should only treat the main Code.exe process as running for VS Code Codex on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      Object.defineProperty(process, 'pid', { value: 1000, configurable: true });
      mockExecSync.mockReturnValue('22345\r\n');

      const result = await isManagedIdeProcessRunning('vscode-codex');
      expect(result).toBe(true);
      expect(mockFindProcess).not.toHaveBeenCalled();
    });

    it('should ignore updater and helper-like Code.exe processes for VS Code Codex on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      Object.defineProperty(process, 'pid', { value: 1000, configurable: true });
      mockExecSync.mockReturnValue('');

      const result = await isManagedIdeProcessRunning('vscode-codex');
      expect(result).toBe(false);
      expect(mockFindProcess).not.toHaveBeenCalled();
    });
  });

  describe('Module exports', () => {
    it('should export all required functions', () => {
      expect(isProcessRunning).toBeDefined();
      expect(closeAntigravity).toBeDefined();
      expect(startAntigravity).toBeDefined();
    });
  });
});
