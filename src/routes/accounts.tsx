import { AccountsPage, AccountsPageErrorBoundary } from '@/components/AccountsPage';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/accounts')({
  component: AccountsPage,
  errorComponent: AccountsPageErrorBoundary,
});
