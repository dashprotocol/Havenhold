import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './lib/auth';
import { requireAuth } from './middleware/sessionAuth';
import { flags } from './config/flags';
import { appointmentsRouter } from './routes/appointments';
import { medicationsRouter } from './routes/medications';
import { documentsRouter } from './routes/documents';
import { feedRouter } from './routes/feed';
import { commentsRouter } from './routes/comments';
import { familyRouter } from './routes/family';
import { meRouter } from './routes/me';

console.log(
  `[flags] PIPELINE_ENABLED=${flags.PIPELINE_ENABLED}  INTEGRATIONS_ENABLED=${flags.INTEGRATIONS_ENABLED}`,
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

// better-auth handler must be mounted before express.json() — it parses its own bodies
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
app.use('/api/me',          requireAuth, meRouter);

app.listen(PORT, () => {
  console.log(`Havenhold server running on http://localhost:${PORT}`);
});
