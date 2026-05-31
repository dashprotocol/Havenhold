import * as Sentry from '@sentry/react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { initPostHog } from './lib/posthog';
import './index.css';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
});

initPostHog();

createRoot(document.getElementById('root')!).render(<App />);
