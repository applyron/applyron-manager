declare module 'react-i18next' {
  import type { ThirdPartyModule, i18n as I18nInstance } from 'i18next';

  export interface TFunction {
    (key: string): string;
    (key: string, defaultValue: string): string;
    (key: string, options: Record<string, unknown>): string;
    (key: string, defaultValue: string, options: Record<string, unknown>): string;
  }

  export interface UseTranslationResponse {
    t: TFunction;
    i18n: I18nInstance;
  }

  export function useTranslation(ns?: string | readonly string[]): UseTranslationResponse;
  export const initReactI18next: ThirdPartyModule;
}

declare module '@radix-ui/react-icons' {
  import type * as React from 'react';

  export interface IconProps extends React.SVGProps<SVGSVGElement> {
    color?: string;
  }

  export const Cross2Icon: React.ForwardRefExoticComponent<
    IconProps & React.RefAttributes<SVGSVGElement>
  >;
}

declare module 'axios' {
  export interface AxiosProxyConfig {
    protocol?: string;
    host: string;
    port: number;
    auth?: {
      username: string;
      password: string;
    };
  }

  export interface AxiosRequestConfig<D = any> {
    headers?: Record<string, string | undefined>;
    timeout?: number;
    responseType?: string;
    proxy?: AxiosProxyConfig | false;
    data?: D;
  }

  export interface AxiosResponse<T = any, D = any> {
    data: T;
    status: number;
    headers?: Record<string, string | string[] | undefined>;
    config: AxiosRequestConfig<D>;
  }

  export interface AxiosError<T = any, D = any> extends Error {
    response?: AxiosResponse<T, D>;
  }

  export interface AxiosInstance {
    get<T = any, D = any>(
      url: string,
      config?: AxiosRequestConfig<D>,
    ): Promise<AxiosResponse<T, D>>;
    post<T = any, D = any>(
      url: string,
      data?: D,
      config?: AxiosRequestConfig<D>,
    ): Promise<AxiosResponse<T, D>>;
  }

  export interface AxiosStatic extends AxiosInstance {
    create(config?: AxiosRequestConfig): AxiosInstance;
    isAxiosError<T = any, D = any>(error: unknown): error is AxiosError<T, D>;
  }

  const axios: AxiosStatic;
  export default axios;
}

declare module '@tanstack/router-plugin/vite' {
  import type { PluginOption } from 'vite';

  export interface TanStackRouterViteOptions {
    target?: 'react' | string;
    autoCodeSplitting?: boolean;
    [key: string]: unknown;
  }

  export function tanstackRouter(options?: TanStackRouterViteOptions): PluginOption;
}

declare module '@sentry/electron/main' {
  export interface Event {
    exception?: {
      values?: Array<{
        value?: string;
      }>;
    };
    [key: string]: unknown;
  }

  export interface Scope {
    setTag(key: string, value: string): void;
    setContext(key: string, context: Record<string, unknown>): void;
    setExtra(key: string, value: unknown): void;
  }

  export interface InitOptions {
    dsn?: string;
    release?: string;
    beforeSend?: (event: Event) => Event | null;
  }

  export type SeverityLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';

  export function init(options: InitOptions): void;
  export function withScope(callback: (scope: Scope) => void): void;
  export function captureException(error: unknown): void;
  export function captureMessage(message: string, level?: SeverityLevel): void;
}

declare module '@sentry/electron/renderer' {
  export interface InitOptions {
    dsn?: string;
  }

  export function init(options: InitOptions): void;
}
