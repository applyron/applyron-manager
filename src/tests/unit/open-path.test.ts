import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockOpenPath } = vi.hoisted(() => ({
  mockOpenPath: vi.fn(),
}));

vi.mock('electron', () => ({
  shell: {
    openPath: mockOpenPath,
  },
}));

import { OpenPathError, openPathOrThrow } from '@/utils/openPath';

describe('openPathOrThrow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves when Electron reports success', async () => {
    mockOpenPath.mockResolvedValue('');

    await expect(openPathOrThrow('C:\\logs', 'log directory')).resolves.toBeUndefined();
    expect(mockOpenPath).toHaveBeenCalledWith('C:\\logs');
  });

  it('throws a structured error when Electron reports failure text', async () => {
    mockOpenPath.mockResolvedValue('no handler');

    await expect(openPathOrThrow('C:\\logs', 'log directory')).rejects.toEqual(
      expect.objectContaining<Partial<OpenPathError>>({
        name: 'OpenPathError',
        context: 'log directory',
        detail: 'no handler',
      }),
    );
  });
});
