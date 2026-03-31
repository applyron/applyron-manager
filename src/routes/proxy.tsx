import { ProxyPage } from '@/components/ProxyPage';
import { createRouteErrorBoundary } from '@/components/RouteErrorState';
import { createFileRoute } from '@tanstack/react-router';

const ProxyPageErrorBoundary = createRouteErrorBoundary('proxy-route-error-state');

export const Route = createFileRoute('/proxy')({
  component: ProxyPage,
  errorComponent: ProxyPageErrorBoundary,
});
