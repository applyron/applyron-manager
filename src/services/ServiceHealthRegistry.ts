import type {
  ServiceHealthId,
  ServiceHealthItem,
  ServiceHealthState,
  ServiceHealthSummary,
} from '../types/dashboard';

const SERVICE_LABELS: Record<ServiceHealthId, string> = {
  config: 'Config',
  security: 'Credential Storage',
  monitoring: 'Monitoring',
  updater: 'Updater',
  auth_server: 'Google Auth',
  proxy_server: 'API Proxy',
  cloud_monitor: 'Antigravity Monitor',
  codex_monitor: 'Codex Monitor',
  orpc_transport: 'ORPC Transport',
};

function createDefaultItem(id: ServiceHealthId): ServiceHealthItem {
  return {
    id,
    label: SERVICE_LABELS[id],
    state: 'idle',
    message: null,
    updatedAt: Date.now(),
  };
}

export class ServiceHealthRegistry {
  private static services = new Map<ServiceHealthId, ServiceHealthItem>(
    (Object.keys(SERVICE_LABELS) as ServiceHealthId[]).map((id) => [id, createDefaultItem(id)]),
  );

  static getItem(id: ServiceHealthId): ServiceHealthItem {
    const item = this.services.get(id);
    if (item) {
      return item;
    }

    const fallback = createDefaultItem(id);
    this.services.set(id, fallback);
    return fallback;
  }

  static update(
    id: ServiceHealthId,
    input: {
      state: ServiceHealthState;
      message?: string | null;
      label?: string;
      updatedAt?: number;
    },
  ): ServiceHealthItem {
    const previous = this.getItem(id);
    const next: ServiceHealthItem = {
      ...previous,
      label: input.label ?? previous.label,
      state: input.state,
      message: input.message ?? null,
      updatedAt: input.updatedAt ?? Date.now(),
    };

    this.services.set(id, next);
    return next;
  }

  static markIdle(id: ServiceHealthId, message?: string | null): ServiceHealthItem {
    return this.update(id, { state: 'idle', message });
  }

  static markStarting(id: ServiceHealthId, message?: string | null): ServiceHealthItem {
    return this.update(id, { state: 'starting', message });
  }

  static markReady(id: ServiceHealthId, message?: string | null): ServiceHealthItem {
    return this.update(id, { state: 'ready', message });
  }

  static markError(id: ServiceHealthId, message?: string | null): ServiceHealthItem {
    return this.update(id, { state: 'error', message });
  }

  static markDegraded(id: ServiceHealthId, message?: string | null): ServiceHealthItem {
    return this.update(id, { state: 'degraded', message });
  }

  static markUnsupported(id: ServiceHealthId, message?: string | null): ServiceHealthItem {
    return this.update(id, { state: 'unsupported', message });
  }

  static getSummary(): ServiceHealthSummary {
    const services = Array.from(this.services.values());
    const updatedAt =
      services.length > 0
        ? services.reduce((max, item) => Math.max(max, item.updatedAt), services[0].updatedAt)
        : null;

    return {
      services,
      hasErrors: services.some((item) => item.state === 'error'),
      updatedAt,
    };
  }

  static resetForTesting(): void {
    this.services = new Map<ServiceHealthId, ServiceHealthItem>(
      (Object.keys(SERVICE_LABELS) as ServiceHealthId[]).map((id) => [id, createDefaultItem(id)]),
    );
  }
}
