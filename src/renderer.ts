async function bootstrapRenderer() {
  try {
    const sentryEnabled =
      import.meta.env.PROD &&
      __SENTRY_DSN__ &&
      (await window.electron.getBootstrapFlags()).sentryEnabled;

    if (sentryEnabled) {
      const Sentry = await import('@sentry/electron/renderer');
      Sentry.init({
        dsn: __SENTRY_DSN__,
      });
    }
  } catch (error) {
    console.warn('Sentry initialization failed:', error);
  } finally {
    await import('@/App');
  }
}

void bootstrapRenderer();
