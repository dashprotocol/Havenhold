import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requirePatientAccess } from '../middleware/sessionAuth';

export const feedRouter = Router();

// SSE clients per patient, with a cap to prevent resource exhaustion
const clients = new Map<string, Response[]>();
const MAX_SSE_CONNECTIONS_PER_PATIENT = 10;

export function broadcastFeedEvent(patientId: string, event: object) {
  const patientClients = clients.get(patientId) ?? [];
  const data = `data: ${JSON.stringify(event)}\n\n`;
  patientClients.forEach((res) => res.write(data));
}

// SSE stream for live feed updates — must be registered BEFORE /:patientId
// otherwise Express matches "events" as the patientId param
feedRouter.get('/events/:patientId', requirePatientAccess, (req: Request, res: Response) => {
  const patientId = req.params.patientId as string;

  const existing = clients.get(patientId) ?? [];
  if (existing.length >= MAX_SSE_CONNECTIONS_PER_PATIENT) {
    return res.status(429).json({ error: 'Too many active connections' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);

  if (!clients.has(patientId)) clients.set(patientId, []);
  clients.get(patientId)!.push(res);

  req.on('close', () => {
    clearInterval(heartbeat);
    const remaining = (clients.get(patientId) ?? []).filter((c) => c !== res);
    clients.set(patientId, remaining);
  });
});

// Unified timeline feed
feedRouter.get('/:patientId', requirePatientAccess, async (req, res) => {
  try {
    const patientId = req.params.patientId as string;

    const [appointments, medications, documents] = await Promise.all([
      prisma.appointment.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.medication.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.document.findMany({
        where: { patientId },
        // Exclude rawText — it contains unredacted clinical content
        select: {
          id: true,
          patientId: true,
          filename: true,
          fileUrl: true,
          processingStatus: true,
          aiSummary: true,
          aiQuestions: true,
          uploadedAt: true,
        },
        orderBy: { uploadedAt: 'desc' },
        take: 20,
      }),
    ]);

    const feed = [
      ...appointments.map((a) => ({ type: 'appointment', createdAt: a.createdAt, data: a })),
      ...medications.map((m) => ({ type: 'medication', createdAt: m.createdAt, data: m })),
      ...documents.map((d) => ({ type: 'document', createdAt: d.uploadedAt, data: d })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(feed);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch feed' });
  }
});
