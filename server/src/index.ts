import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { flags } from './config/flags';
import { demoAuth } from './middleware/demoAuth';
import { appointmentsRouter } from './routes/appointments';
import { medicationsRouter } from './routes/medications';
import { documentsRouter } from './routes/documents';
import { feedRouter } from './routes/feed';
import { commentsRouter } from './routes/comments';
import { familyRouter } from './routes/family';

// ---------------------------------------------------------------------------
// Startup: validate flags before any middleware or routes are registered
// ---------------------------------------------------------------------------
console.log(
  `[flags] DEMO_MODE=${flags.DEMO_MODE}  PIPELINE_ENABLED=${flags.PIPELINE_ENABLED}  INTEGRATIONS_ENABLED=${flags.INTEGRATIONS_ENABLED}`,
);

if (!flags.DEMO_MODE) {
  // No JWT auth implementation exists yet. Running without demo auth means every
  // request would be unauthenticated. Fail fast rather than silently serve open routes.
  console.error(
    '[startup] FATAL: DEMO_MODE=false but no JWT auth is configured. ' +
    'Refusing to start. Set DEMO_MODE=true or implement JWT middleware first.',
  );
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT ?? 3001;

const devOrigins = ['http://localhost:5173', 'http://localhost:8080', 'http://localhost:3000'];
const prodOrigins =
  process.env.NODE_ENV !== 'development' && process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
    : [];
// devOrigins are always included while DEMO_MODE is the only auth layer.
// When real auth lands, restrict to prodOrigins-only in production (remove devOrigins spread).
app.use(cors({ origin: [...devOrigins, ...prodOrigins] }));
app.use(express.json());

// Demo auth: sets req.user on every request.
// Replace with real JWT verification before any real deployment.
// Mounting is conditional on DEMO_MODE (guarded above at startup).
app.use(demoAuth);

app.use('/api/appointments', appointmentsRouter);
app.use('/api/medications', medicationsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/feed', feedRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/family', familyRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Havenhold server running on http://localhost:${PORT}`);
});
