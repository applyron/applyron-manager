import http from 'http';
import { logger } from '../../utils/logger';
import { ipcContext } from '../context';
import { ConfigManager } from '../config/manager';
import { FALLBACK_APP_LANGUAGE, normalizeAppLanguage } from '../../utils/language';
import { ServiceHealthRegistry } from '../../services/ServiceHealthRegistry';

type OAuthPageText = {
  successTitle: string;
  successDescription: string;
  errorTitle: string;
  errorDescriptionPrefix: string;
  missingCode: string;
  notFound: string;
};

const OAUTH_PAGE_TEXTS: Record<string, OAuthPageText> = {
  en: {
    successTitle: 'Login Successful',
    successDescription: 'You can close this window and return to Applyron Manager.',
    errorTitle: 'Login Failed',
    errorDescriptionPrefix: 'Error:',
    missingCode: 'Missing code parameter',
    notFound: 'Not Found',
  },
  tr: {
    successTitle: 'Giriş Başarılı',
    successDescription: 'Bu pencereyi kapatıp Applyron Manager uygulamasına dönebilirsiniz.',
    errorTitle: 'Giriş Başarısız',
    errorDescriptionPrefix: 'Hata:',
    missingCode: 'Kod parametresi eksik',
    notFound: 'Sayfa bulunamadı',
  },
};

function resolveOAuthPageText(): OAuthPageText {
  const language = normalizeAppLanguage(
    ConfigManager.getCachedConfigOrLoad().language,
    FALLBACK_APP_LANGUAGE,
  );
  return OAUTH_PAGE_TEXTS[language];
}

export class AuthServer {
  private static server: http.Server | null = null;
  private static startPromise: Promise<{ redirectUri: string; port: number }> | null = null;
  private static idleTimer: NodeJS.Timeout | null = null;
  private static readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000;
  private static status: {
    state: 'idle' | 'starting' | 'ready' | 'error';
    port: number | null;
    redirectUri: string | null;
    message: string | null;
  } = {
    state: 'idle',
    port: null,
    redirectUri: null,
    message: null,
  };
  private static lastRedirectUri: string | null = null;

  static async startOrReuse(): Promise<{ redirectUri: string; port: number }> {
    if (
      this.server &&
      this.status.port &&
      this.status.redirectUri &&
      this.status.state === 'ready'
    ) {
      this.scheduleIdleShutdown();
      return {
        redirectUri: this.status.redirectUri,
        port: this.status.port,
      };
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.applyStatus({
      state: 'starting',
      port: null,
      redirectUri: this.lastRedirectUri,
      message: null,
    });

    this.startPromise = new Promise<{ redirectUri: string; port: number }>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || '', 'http://127.0.0.1');
        const pageText = resolveOAuthPageText();

        if (url.pathname === '/oauth-callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (code) {
            logger.info(`AuthServer: Received authorization code: ${code.substring(0, 10)}...`);

            if (ipcContext.mainWindow) {
              logger.info('AuthServer: Sending code to renderer via IPC');
              ipcContext.mainWindow.webContents.send('GOOGLE_AUTH_CODE', code);
              logger.info('AuthServer: Code sent successfully');
            } else {
              logger.error('AuthServer: Main window not found, cannot send code');
            }

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html>
                <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                  <h1>${pageText.successTitle}</h1>
                  <p>${pageText.successDescription}</p>
                  <script>
                    setTimeout(() => window.close(), 3000);
                  </script>
                </body>
              </html>
            `);

            this.stop();
          } else if (error) {
            logger.error(`AuthServer: OAuth error: ${error}`);
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html>
                <body>
                  <h1>${pageText.errorTitle}</h1>
                  <p>${pageText.errorDescriptionPrefix} ${error}</p>
                </body>
              </html>
            `);
            this.stop({
              nextState: 'error',
              message: `OAuth callback failed: ${error}`,
            });
          } else {
            res.writeHead(400);
            res.end(pageText.missingCode);
            this.stop({
              nextState: 'error',
              message: pageText.missingCode,
            });
          }
        } else {
          res.writeHead(404);
          res.end(pageText.notFound);
        }
      });

      this.server = server;

      server.on('error', (err) => {
        logger.error('AuthServer: Server error', err);
        this.startPromise = null;
        this.server = null;
        const normalizedMessage =
          typeof (err as NodeJS.ErrnoException).code === 'string' &&
          (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
            ? 'AUTH_PORT_IN_USE|Google sign-in could not start because the loopback port is already in use.'
            : err.message;
        this.applyStatus({
          state: 'error',
          port: null,
          redirectUri: this.lastRedirectUri,
          message: normalizedMessage,
        });
        reject(new Error(normalizedMessage));
      });

      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          const error = new Error('AuthServer could not resolve a loopback port.');
          this.startPromise = null;
          this.server = null;
          this.applyStatus({
            state: 'error',
            port: null,
            redirectUri: this.lastRedirectUri,
            message: error.message,
          });
          reject(error);
          return;
        }

        const redirectUri = `http://127.0.0.1:${address.port}/oauth-callback`;
        this.lastRedirectUri = redirectUri;
        this.applyStatus({
          state: 'ready',
          port: address.port,
          redirectUri,
          message: null,
        });
        this.startPromise = null;
        this.scheduleIdleShutdown();
        logger.info(`AuthServer: Listening on ${redirectUri}`);
        resolve({ redirectUri, port: address.port });
      });
    });

    return this.startPromise;
  }

  static getStatus() {
    return { ...this.status };
  }

  static getRedirectUriForExchange(): string | null {
    return this.status.redirectUri ?? this.lastRedirectUri;
  }

  static stop(options?: { nextState?: 'idle' | 'error'; message?: string | null }) {
    this.clearIdleShutdown();
    this.startPromise = null;

    if (this.server) {
      try {
        this.server.close();
      } catch (error) {
        logger.warn('AuthServer: Failed to close server cleanly', error);
      }
      this.server = null;
    }

    const nextState = options?.nextState ?? 'idle';
    this.applyStatus({
      state: nextState,
      port: null,
      redirectUri: nextState === 'error' ? this.lastRedirectUri : null,
      message: options?.message ?? null,
    });
    logger.info(`AuthServer: Stopped (${nextState})`);
  }

  private static scheduleIdleShutdown() {
    this.clearIdleShutdown();
    this.idleTimer = setTimeout(() => {
      logger.info('AuthServer: Idle timeout reached, stopping loopback listener');
      this.stop();
    }, this.IDLE_TIMEOUT_MS);
  }

  private static clearIdleShutdown() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private static applyStatus(input: {
    state: 'idle' | 'starting' | 'ready' | 'error';
    port: number | null;
    redirectUri: string | null;
    message: string | null;
  }) {
    this.status = input;

    switch (input.state) {
      case 'starting':
        ServiceHealthRegistry.markStarting(
          'auth_server',
          input.message ?? 'Preparing loopback callback listener.',
        );
        break;
      case 'ready':
        ServiceHealthRegistry.markReady(
          'auth_server',
          input.message ?? 'Loopback callback listener is ready.',
        );
        break;
      case 'error':
        ServiceHealthRegistry.markError(
          'auth_server',
          input.message ?? 'Google auth loopback listener failed.',
        );
        break;
      default:
        ServiceHealthRegistry.markIdle('auth_server', input.message);
        break;
    }
  }
}
