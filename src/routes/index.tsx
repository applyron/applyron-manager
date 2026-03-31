import { DashboardPage } from '@/components/DashboardPage';
import { createRouteErrorBoundary } from '@/components/RouteErrorState';
import { createFileRoute } from '@tanstack/react-router';

const DashboardPageErrorBoundary = createRouteErrorBoundary('dashboard-route-error-state');

export const Route = createFileRoute('/')({
  component: DashboardPage,
  errorComponent: DashboardPageErrorBoundary,
});
