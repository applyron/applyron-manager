import { beforeEach, describe, expect, it } from 'vitest';

import { ServiceHealthRegistry } from '../../services/ServiceHealthRegistry';

describe('ServiceHealthRegistry', () => {
  beforeEach(() => {
    ServiceHealthRegistry.resetForTesting();
  });

  it('tracks service state updates in the summary', () => {
    ServiceHealthRegistry.markReady('config');
    ServiceHealthRegistry.markError('proxy_server', 'Port is already in use.');

    const summary = ServiceHealthRegistry.getSummary();
    const config = summary.services.find((item) => item.id === 'config');
    const proxy = summary.services.find((item) => item.id === 'proxy_server');

    expect(config?.state).toBe('ready');
    expect(proxy?.state).toBe('error');
    expect(proxy?.message).toBe('Port is already in use.');
    expect(summary.hasErrors).toBe(true);
  });
});
