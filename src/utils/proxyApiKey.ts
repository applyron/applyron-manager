import type { AppConfig, ProxyConfig } from '@/types/config';
import { randomUUID } from 'crypto';

export function hasProxyApiKey(apiKey: string | null | undefined): apiKey is string {
  return typeof apiKey === 'string' && apiKey.trim() !== '';
}

export function generateProxyApiKey(): string {
  return `sk-${randomUUID().replace(/-/g, '')}`;
}

export function ensureProxyApiKeyInProxyConfig<T extends ProxyConfig>(proxyConfig: T): T {
  if (hasProxyApiKey(proxyConfig.api_key)) {
    return proxyConfig;
  }

  return {
    ...proxyConfig,
    api_key: generateProxyApiKey(),
  };
}

export function ensureProxyApiKeyInAppConfig<T extends AppConfig>(config: T): T {
  const nextProxyConfig = ensureProxyApiKeyInProxyConfig(config.proxy);
  if (nextProxyConfig === config.proxy) {
    return config;
  }

  return {
    ...config,
    proxy: nextProxyConfig,
  };
}
