import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { demoAuth } from './middleware/demoAuth';
import { appointmentsRouter } from './routes/appointments';
import { medicationsRouter } from './routes/medications';
import { documentsRouter } from './routes/documents';
import { feedRouter } from './routes/feed';
import { commentsRouter } from './routes/comments';
import { familyRouter } from './routes/family';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:8080', 'http://localhost:3000'] }));
app.use(express.json());

// Demo auth: sets req.user on every request.
// Replace with real JWT verification before any real deployment.
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
