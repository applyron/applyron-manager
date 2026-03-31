import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getLocalizedErrorMessage } from '@/utils/errorMessages';
import { useTranslation } from 'react-i18next';

export function RouteErrorState({
  error,
  onRetry,
  testId = 'route-error-state',
}: {
  error: unknown;
  onRetry: () => void;
  testId?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-4xl p-10" data-testid={testId}>
      <div
        className="rounded-xl border p-10 text-center"
        style={{
          background: 'var(--hud-panel)',
          borderColor: 'var(--hud-border-soft)',
          boxShadow: 'var(--hud-shadow)',
        }}
      >
        <div
          className="text-foreground text-lg font-semibold"
          style={{ fontFamily: 'Tomorrow, sans-serif' }}
        >
          {t('error.generic')}
        </div>
        <div className="text-muted-foreground mt-2 text-sm">
          {getLocalizedErrorMessage(error, t)}
        </div>
        <Button
          className="text-foreground hover:bg-accent/60 hover:text-primary mt-4 border-[var(--hud-border-soft)] bg-transparent"
          variant="outline"
          onClick={onRetry}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('action.retry')}
        </Button>
      </div>
    </div>
  );
}

export function createRouteErrorBoundary(testId?: string) {
  return function RouteErrorBoundary({ error, reset }: { error: unknown; reset: () => void }) {
    return <RouteErrorState error={error} onRetry={reset} testId={testId} />;
  };
}
