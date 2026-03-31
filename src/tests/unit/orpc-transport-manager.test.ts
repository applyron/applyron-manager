import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrpcTransportManager } from '../../ipc/orpcTransportManager';
import { ServiceHealthRegistry } from '../../services/ServiceHealthRegistry';

function createMockPort() {
  return {
    start: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    postMessage: vi.fn(),
  };
}

describe('OrpcTransportManager', () => {
  beforeEach(() => {
    ServiceHealthRegistry.resetForTesting();
  });

  it('replaces the transport when the same renderer reinitializes', () => {
    const manager = new OrpcTransportManager();
    const firstPort = createMockPort();
    const secondPort = createMockPort();
    const upgrade = vi.fn();

    expect(manager.attach({ senderId: 10, port: firstPort, upgrade })).toBe('attached');
    expect(manager.attach({ senderId: 10, port: secondPort, upgrade })).toBe('replaced');

    expect(firstPort.close).toHaveBeenCalledTimes(1);
    expect(secondPort.start).toHaveBeenCalledTimes(1);
    expect(upgrade).toHaveBeenCalledTimes(2);
    expect(manager.getOwnerSenderId()).toBe(10);
  });

  it('rejects duplicate init from a different renderer sender', () => {
    const manager = new OrpcTransportManager();
    const firstPort = createMockPort();
    const foreignPort = createMockPort();

    manager.attach({ senderId: 10, port: firstPort, upgrade: vi.fn() });

    expect(() => manager.attach({ senderId: 11, port: foreignPort, upgrade: vi.fn() })).toThrow(
      /Rejected duplicate ORPC init/,
    );
    expect(foreignPort.close).toHaveBeenCalledTimes(1);
    expect(
      ServiceHealthRegistry.getSummary().services.find((item) => item.id === 'orpc_transport')
        ?.state,
    ).toBe('error');
  });
});
