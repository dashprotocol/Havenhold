import 'dotenv/config';
import * as Sentry from '@sentry/node';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './lib/auth';
import { logger } from './lib/logger';
import { safeErrorFields } from './lib/errors';
import { posthog } from './lib/posthog';
import { requestIdMiddleware } from './middleware/requestId';
import { requireAuth } from './middleware/sessionAuth';
import { flags } from './config/flags';
import { appointmentsRouter } from './routes/appointments';
import { medicationsRouter } from './routes/medications';
import { documentsRouter } from './routes/documents';
import { feedRouter, closeAllFeedStreams } from './routes/feed';
import { commentsRouter } from './routes/comments';
import { familyRouter } from './routes/family';
import { meRouter } from './routes/me';
import { invitesRouter } from './routes/invites';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  enabled: !!process.env.SENTRY_DSN,
});

logger.info(
  { PIPELINE_ENABLED: flags.PIPELINE_ENABLED, INTEGRATIONS_ENABLED: flags.INTEGRATIONS_ENABLED },
  'Feature flags loaded',
);

const app = express();
const PORT = process.env.PORT ?? 3001;

const devOrigins = ['http://localhost:5173', 'http://localhost:8080', 'http://localhost:3000'];
const prodOrigins =
  process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
    : [];
const allowedOrigins =
  process.env.NODE_ENV === 'production' ? prodOrigins : [...devOrigins, ...prodOrigins];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Trust X-Forwarded-For from Nginx (one hop). Cloudflare sits in front of Nginx,
// so req.ip resolves to the Cloudflare edge IP — audit logs use CF-Connecting-IP
// instead (see requestMeta in lib/audit.ts) to get the real client address.
app.set('trust proxy', 1);
app.use(requestIdMiddleware);

// better-auth handler must be mounted before express.json() — it handles its own body parsing
app.all('/api/auth/*', toNodeHandler(auth));

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/appointments', requireAuth, appointmentsRouter);
app.use('/api/medications',  requireAuth, medicationsRouter);
app.use('/api/documents',    requireAuth, documentsRouter);
app.use('/api/feed',         requireAuth, feedRouter);
app.use('/api/comments',     requireAuth, commentsRouter);
app.use('/api/family',       requireAuth, familyRouter);
app.use('/api/me',           requireAuth, meRouter);
app.use('/api/invites',      invitesRouter);

// Sentry error handler must precede the custom handler — it captures errors
// passed via next(err). Route-level catches use captureError() directly.
Sentry.setupExpressErrorHandler(app);

// Global fallback for any error reaching Express via next(err).
// Does NOT call Sentry.captureException — that would double-report with the
// Sentry handler above. Route catch blocks use captureError() for their errors.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ requestId: req.requestId, err: safeErrorFields(err) }, 'Unhandled request error');
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Server started');
});

let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown started');

  // Arm forced-exit timeout first — must not block on async work before this
  setTimeout(() => {
    logger.error('Forced exit after shutdown timeout');
    process.exit(1);
  }, 10_000).unref();

  try {
    await posthog.shutdown();
  } catch (err) {
    logger.error({ err }, 'PostHog shutdown failed');
  } finally {
    closeAllFeedStreams(signal);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  }
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT',  () => { void gracefulShutdown('SIGINT'); });
