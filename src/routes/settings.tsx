import { SettingsPage } from '@/components/SettingsPage';
import { createRouteErrorBoundary } from '@/components/RouteErrorState';
import { createFileRoute } from '@tanstack/react-router';

const SettingsPageErrorBoundary = createRouteErrorBoundary('settings-route-error-state');

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
  errorComponent: SettingsPageErrorBoundary,
});
