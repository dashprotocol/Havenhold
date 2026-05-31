import * as Sentry from '@sentry/react';
import { ReactNode } from 'react';

function FallbackUI() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground text-sm">
        This error has been reported. Try refreshing the page.
      </p>
      <button
        className="text-sm underline text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => window.location.reload()}
      >
        Reload page
      </button>
    </div>
  );
}

export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary fallback={<FallbackUI />}>
      {children}
    </Sentry.ErrorBoundary>
  );
}
