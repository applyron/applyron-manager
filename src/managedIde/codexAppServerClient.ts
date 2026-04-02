import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'child_process';
import readline from 'readline';
import { logger } from '../utils/logger';

type RequestId = string;

interface JsonRpcError {
  code?: number;
  message?: string;
}

interface JsonRpcResponse<T = unknown> {
  id: RequestId | number;
  result?: T;
  error?: JsonRpcError;
}

interface JsonRpcNotification<T = unknown> {
  method: string;
  params?: T;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface PendingLoginCompletion {
  resolve: (value: void) => void;
  reject: (error: Error) => void;
}

interface CodexAccountResponse {
  account?: {
    type: 'chatgpt' | 'apiKey';
    email?: string;
    planType?: string;
  } | null;
  requiresOpenaiAuth: boolean;
}

interface CodexRateLimitWindow {
  usedPercent: number;
  resetsAt?: number | null;
  windowDurationMins?: number | null;
}

interface CodexRateLimitSnapshot {
  limitId?: string | null;
  limitName?: string | null;
  planType?: string | null;
  primary?: CodexRateLimitWindow | null;
  secondary?: CodexRateLimitWindow | null;
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance?: string | null;
  } | null;
}

interface CodexRateLimitsResponse {
  rateLimits: CodexRateLimitSnapshot;
  rateLimitsByLimitId?: Record<string, CodexRateLimitSnapshot> | null;
}

interface CodexAccountUpdatedNotification {
  authMode?: 'chatgpt' | 'apikey' | 'chatgptAuthTokens' | null;
  planType?: string | null;
}

interface CodexRateLimitsUpdatedNotification {
  rateLimits: CodexRateLimitSnapshot;
}

interface CodexAuthStatusResponse {
  authMethod: 'chatgpt' | 'apikey' | 'chatgptAuthTokens' | null;
  authToken: string | null;
  requiresOpenaiAuth: boolean | null;
}

interface CodexConfigReadResponse {
  config?: {
    service_tier?: string | null;
  } | null;
}

export interface CodexChatGptLoginStartResult {
  authUrl: string;
  loginId: string;
}

interface CodexLoginResponseApiKey {
  type: 'apiKey';
}

interface CodexLoginResponseChatGpt {
  type: 'chatgpt';
  authUrl: string;
  loginId: string;
}

interface CodexLoginResponseChatGptAuthTokens {
  type: 'chatgptAuthTokens';
}

interface CodexAccountLoginCompletedNotification {
  success: boolean;
  loginId?: string | null;
  error?: string | null;
}

type CodexLoginResponse =
  | CodexLoginResponseApiKey
  | CodexLoginResponseChatGpt
  | CodexLoginResponseChatGptAuthTokens;

export interface CodexAppServerSnapshot {
  account: CodexAccountResponse | null;
  rateLimits: CodexRateLimitsResponse | null;
  authStatus: CodexAuthStatusResponse | null;
  config: CodexConfigReadResponse | null;
  authMode: 'chatgpt' | 'apikey' | 'chatgptAuthTokens' | null;
  planTypeHint: string | null;
  latestRateLimitsNotification: CodexRateLimitsUpdatedNotification | null;
}

export interface CodexAppServerClientOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export class CodexAppServerClient {
  private readonly executablePath: string;
  private readonly options: CodexAppServerClientOptions;
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pendingRequests = new Map<RequestId, PendingRequest>();
  private readonly pendingLoginCompletions = new Map<string, PendingLoginCompletion>();
  private nextRequestId = 1;
  private initialized = false;
  private lastAccountUpdatedNotification: CodexAccountUpdatedNotification | null = null;
  private lastRateLimitsNotification: CodexRateLimitsUpdatedNotification | null = null;

  constructor(executablePath: string, options: CodexAppServerClientOptions = {}) {
    this.executablePath = executablePath;
    this.options = options;
  }

  async collectSnapshot(timeoutMs = 8000): Promise<CodexAppServerSnapshot> {
    let accountResponse: CodexAccountResponse | null = null;
    let rateLimitsResponse: CodexRateLimitsResponse | null = null;
    let authStatusResponse: CodexAuthStatusResponse | null = null;
    let configReadResponse: CodexConfigReadResponse | null = null;
    let authMode: CodexAccountUpdatedNotification['authMode'] = null;
    let planTypeHint: string | null = null;
    let latestRateLimitsNotification: CodexRateLimitsUpdatedNotification | null = null;

    await this.start();
    await this.ensureInitialized();

    const timeout = setTimeout(() => {
      for (const [requestId, pending] of this.pendingRequests.entries()) {
        pending.reject(new Error(`Codex app-server request timed out: ${requestId}`));
      }
      this.pendingRequests.clear();
    }, timeoutMs);

    try {
      const [accountResult, rateLimitResult, authStatusResult, configReadResult] =
        await Promise.allSettled([
          this.request('account/read', { refreshToken: false }),
          this.request('account/rateLimits/read', undefined),
          this.request('getAuthStatus', {
            includeToken: false,
            refreshToken: false,
          }),
          this.request('config/read', {
            includeLayers: false,
          }),
        ]);

      if (accountResult.status === 'fulfilled') {
        accountResponse = accountResult.value as CodexAccountResponse;
      } else {
        logger.warn('Codex app-server account/read failed', accountResult.reason);
      }

      if (rateLimitResult.status === 'fulfilled') {
        rateLimitsResponse = rateLimitResult.value as CodexRateLimitsResponse;
      } else {
        logger.warn('Codex app-server account/rateLimits/read failed', rateLimitResult.reason);
      }

      if (authStatusResult.status === 'fulfilled') {
        authStatusResponse = authStatusResult.value as CodexAuthStatusResponse;
      } else {
        logger.warn('Codex app-server getAuthStatus failed', authStatusResult.reason);
      }

      if (configReadResult.status === 'fulfilled') {
        configReadResponse = configReadResult.value as CodexConfigReadResponse;
      } else {
        logger.warn('Codex app-server config/read failed', configReadResult.reason);
      }

      await new Promise((resolve) => setTimeout(resolve, 150));

      if (this.lastAccountUpdatedNotification) {
        authMode = this.lastAccountUpdatedNotification.authMode ?? null;
        planTypeHint = this.lastAccountUpdatedNotification.planType ?? null;
      }

      if (this.lastRateLimitsNotification) {
        latestRateLimitsNotification = this.lastRateLimitsNotification;
      }

      return {
        account: accountResponse,
        rateLimits: rateLimitsResponse,
        authStatus: authStatusResponse,
        config: configReadResponse,
        authMode:
          authMode ??
          authStatusResponse?.authMethod ??
          (accountResponse?.account?.type === 'chatgpt'
            ? 'chatgpt'
            : accountResponse?.account?.type === 'apiKey'
              ? 'apikey'
              : null),
        planTypeHint,
        latestRateLimitsNotification,
      };
    } finally {
      clearTimeout(timeout);
      await this.dispose();
    }
  }

  async loginWithChatGpt(options: {
    openUrl: (url: string) => Promise<void> | void;
    timeoutMs?: number;
  }): Promise<void> {
    const result = await this.startChatGptLogin();
    await options.openUrl(result.authUrl);
    await this.waitForChatGptLoginCompletion(result.loginId, options.timeoutMs ?? 180_000);
  }

  async startChatGptLogin(): Promise<CodexChatGptLoginStartResult> {
    await this.start();
    await this.ensureInitialized();

    const result = (await this.request('account/login/start', {
      type: 'chatgpt',
    })) as CodexLoginResponse;

    if (result.type !== 'chatgpt') {
      throw new Error(`Unexpected Codex login response type: ${result.type}`);
    }

    return {
      authUrl: result.authUrl,
      loginId: result.loginId,
    };
  }

  async waitForChatGptLoginCompletion(loginId: string, timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingLoginCompletions.delete(loginId);
        reject(new Error('CODEX_LOGIN_TIMEOUT'));
      }, timeoutMs);

      this.pendingLoginCompletions.set(loginId, {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.request('initialize', {
      clientInfo: {
        name: 'applyron-manager',
        version: '0.10.0',
      },
    });
    this.initialized = true;
  }

  private async start(): Promise<void> {
    if (this.child) {
      return;
    }

    const spawnOptions: SpawnOptionsWithoutStdio = {
      env: {
        ...process.env,
        ...this.options.env,
      },
      cwd: this.options.cwd,
      windowsHide: true,
    };

    const child = spawn(this.executablePath, ['app-server'], {
      ...spawnOptions,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    const stdoutInterface = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    stdoutInterface.on('line', (line) => {
      this.handleMessage(line);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        logger.debug(`[Codex app-server stderr] ${text}`);
      }
    });

    child.on('exit', (code, signal) => {
      const exitMessage = `Codex app-server exited with code=${String(code)} signal=${String(signal)}`;
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(exitMessage));
      }
      for (const [, pending] of this.pendingLoginCompletions) {
        pending.reject(new Error(exitMessage));
      }
      this.pendingRequests.clear();
      this.pendingLoginCompletions.clear();
      stdoutInterface.close();
      this.child = null;
      this.initialized = false;
    });
  }

  private handleMessage(line: string): void {
    if (!line.trim()) {
      return;
    }

    try {
      const payload = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
      if ('id' in payload) {
        const requestId = String(payload.id);
        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
          return;
        }

        this.pendingRequests.delete(requestId);

        if ('error' in payload && payload.error) {
          pending.reject(new Error(payload.error.message || 'Unknown Codex app-server error'));
          return;
        }

        pending.resolve(payload.result);
        return;
      }

      if ('method' in payload) {
        if (payload.method === 'account/updated') {
          this.lastAccountUpdatedNotification = (payload.params ??
            null) as CodexAccountUpdatedNotification | null;
          return;
        }

        if (payload.method === 'account/rateLimits/updated') {
          this.lastRateLimitsNotification = (payload.params ??
            null) as CodexRateLimitsUpdatedNotification | null;
          return;
        }

        if (payload.method === 'account/login/completed') {
          const params = (payload.params ?? null) as CodexAccountLoginCompletedNotification | null;
          if (!params?.loginId) {
            return;
          }

          const pending = this.pendingLoginCompletions.get(params.loginId);
          if (!pending) {
            return;
          }

          this.pendingLoginCompletions.delete(params.loginId);
          if (params.success) {
            pending.resolve();
          } else {
            pending.reject(new Error(params.error || 'CODEX_LOGIN_FAILED'));
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to parse Codex app-server message', { error, line });
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.child) {
      return Promise.reject(new Error('Codex app-server process is not running'));
    }

    const id = String(this.nextRequestId++);
    const payload =
      typeof params === 'undefined'
        ? JSON.stringify({ id, method })
        : JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.child?.stdin.write(`${payload}\n`);
    });
  }

  async dispose(): Promise<void> {
    if (!this.child) {
      return;
    }

    const child = this.child;
    this.child = null;
    this.initialized = false;

    try {
      child.stdin.end();
    } catch {
      // Ignore stdin teardown failures.
    }

    if (!child.killed) {
      child.kill();
    }
  }
}
