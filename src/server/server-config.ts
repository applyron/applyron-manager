import { ConfigManager } from '../ipc/config/manager';
import { DEFAULT_APP_CONFIG, ProxyConfig } from '../types/config';
import { resolveDefaultProjectId } from '../utils/projectId';

type ServerConfigListener = (config: Readonly<ProxyConfig> | null) => void;
type ServerConfigUpdate =
  | Partial<ProxyConfig>
  | ((current: Readonly<ProxyConfig> | null) => ProxyConfig | Partial<ProxyConfig>);

function cloneConfig(config: ProxyConfig): ProxyConfig {
  return structuredClone(config);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  Object.values(value as Record<string, unknown>).forEach((child) => {
    deepFreeze(child);
  });
  return value;
}

function mergeProxyConfig(baseConfig: ProxyConfig, patch: Partial<ProxyConfig>): ProxyConfig {
  return {
    ...baseConfig,
    ...patch,
    upstream_proxy: {
      ...baseConfig.upstream_proxy,
      ...(patch.upstream_proxy ?? {}),
    },
    custom_mapping: {
      ...baseConfig.custom_mapping,
      ...(patch.custom_mapping ?? {}),
    },
    anthropic_mapping: {
      ...baseConfig.anthropic_mapping,
      ...(patch.anthropic_mapping ?? {}),
    },
  };
}

export class ServerConfigStore {
  private snapshot: ProxyConfig | null = null;
  private readonly listeners = new Set<ServerConfigListener>();

  getSnapshot(): Readonly<ProxyConfig> | null {
    if (!this.snapshot) {
      return null;
    }

    return deepFreeze(cloneConfig(this.snapshot));
  }

  setSnapshot(config: ProxyConfig): Readonly<ProxyConfig> {
    this.snapshot = cloneConfig(config);
    const nextSnapshot = this.getSnapshot();
    this.notify(nextSnapshot);
    return nextSnapshot as Readonly<ProxyConfig>;
  }

  update(update: ServerConfigUpdate): Readonly<ProxyConfig> {
    const currentSnapshot = this.getSnapshot();
    const nextValue = typeof update === 'function' ? update(currentSnapshot) : update;
    const currentBase = this.snapshot
      ? cloneConfig(this.snapshot)
      : cloneConfig(DEFAULT_APP_CONFIG.proxy);
    const merged = mergeProxyConfig(currentBase, nextValue);
    return this.setSnapshot(merged);
  }

  subscribe(listener: ServerConfigListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(config: Readonly<ProxyConfig> | null): void {
    for (const listener of this.listeners) {
      listener(config);
    }
  }
}

export const serverConfigStore = new ServerConfigStore();

export function setServerConfig(config: ProxyConfig): Readonly<ProxyConfig> {
  return serverConfigStore.setSnapshot(config);
}

export function getServerConfig(): Readonly<ProxyConfig> | null {
  return serverConfigStore.getSnapshot();
}

export function updateServerConfig(update: ServerConfigUpdate): Readonly<ProxyConfig> {
  return serverConfigStore.update(update);
}

export function subscribeServerConfig(listener: ServerConfigListener): () => void {
  return serverConfigStore.subscribe(listener);
}

export function resolveServerDefaultProjectId(): string {
  const runtimeSnapshot = serverConfigStore.getSnapshot();
  if (runtimeSnapshot?.default_project_id) {
    return resolveDefaultProjectId(runtimeSnapshot.default_project_id);
  }

  const cachedConfig = ConfigManager.getCachedConfig();
  if (cachedConfig?.proxy.default_project_id) {
    return resolveDefaultProjectId(cachedConfig.proxy.default_project_id);
  }

  return resolveDefaultProjectId(
    undefined,
    process.env.APPLYRON_DEFAULT_PROJECT_ID,
    DEFAULT_APP_CONFIG.proxy.default_project_id,
  );
}
