import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requirePatientAccess } from '../middleware/sessionAuth';

export const feedRouter = Router();

// SSE clients per patient, with a cap to prevent resource exhaustion
const clients = new Map<string, Set<Response>>();
const MAX_SSE_CONNECTIONS_PER_PATIENT = 10;
const MAX_TOTAL_SSE_CONNECTIONS = 100;

type BufferedEvent = {
  id: string;
  event: string;
  data: string;
  createdAt: number;
};

const replayBuffers = new Map<string, BufferedEvent[]>();
const REPLAY_BUFFER_PER_PATIENT = 100;
const REPLAY_BUFFER_TOTAL_MAX = 2000;
const REPLAY_BUFFER_TTL_MS = 15 * 60 * 1000;

const patientLastActivity = new Map<string, number>();
let totalSseConnections = 0;
let totalBufferedEvents = 0;
let eventSequence = 0;

function nowMs(): number {
  return Date.now();
}

function nextEventId(): string {
  eventSequence = (eventSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${nowMs()}-${eventSequence}`;
}

function parseEventId(id: string): [number, number] | null {
  const [tsRaw, seqRaw] = id.split('-');
  if (!tsRaw || !seqRaw) return null;
  const ts = Number(tsRaw);
  const seq = Number(seqRaw);
  if (!Number.isFinite(ts) || !Number.isFinite(seq)) return null;
  return [ts, seq];
}

function isAfterEventId(candidate: string, baseline: string): boolean {
  const a = parseEventId(candidate);
  const b = parseEventId(baseline);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] > b[0];
  return a[1] > b[1];
}

function formatSseFrame(evt: BufferedEvent): string {
  return `id: ${evt.id}\nevent: ${evt.event}\ndata: ${evt.data}\n\n`;
}

function prunePatientBuffer(patientId: string) {
  const buf = replayBuffers.get(patientId);
  if (!buf || buf.length === 0) return;

  const cutoff = nowMs() - REPLAY_BUFFER_TTL_MS;
  let removed = 0;
  while (buf.length > 0 && buf[0]!.createdAt < cutoff) {
    buf.shift();
    removed += 1;
  }
  if (removed > 0) totalBufferedEvents = Math.max(0, totalBufferedEvents - removed);

  if (buf.length === 0) {
    const hasClients = (clients.get(patientId)?.size ?? 0) > 0;
    if (!hasClients) {
      replayBuffers.delete(patientId);
      patientLastActivity.delete(patientId);
    }
  }
}

function appendToReplayBuffer(patientId: string, evt: BufferedEvent) {
  prunePatientBuffer(patientId);
  const buf = replayBuffers.get(patientId) ?? [];
  buf.push(evt);
  totalBufferedEvents += 1;

  while (buf.length > REPLAY_BUFFER_PER_PATIENT) {
    buf.shift();
    totalBufferedEvents = Math.max(0, totalBufferedEvents - 1);
  }

  replayBuffers.set(patientId, buf);
  patientLastActivity.set(patientId, nowMs());
  enforceGlobalReplayCap();
}

function enforceGlobalReplayCap() {
  while (totalBufferedEvents > REPLAY_BUFFER_TOTAL_MAX) {
    let oldestPatientId: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;

    for (const [patientId, buf] of replayBuffers.entries()) {
      const ts = buf[0]?.createdAt;
      if (ts !== undefined && ts < oldestTs) {
        oldestTs = ts;
        oldestPatientId = patientId;
      }
    }

    if (!oldestPatientId) break;
    const buf = replayBuffers.get(oldestPatientId);
    if (!buf || buf.length === 0) {
      replayBuffers.delete(oldestPatientId);
      patientLastActivity.delete(oldestPatientId);
      continue;
    }

    buf.shift();
    totalBufferedEvents = Math.max(0, totalBufferedEvents - 1);
    if (buf.length === 0 && (clients.get(oldestPatientId)?.size ?? 0) === 0) {
      replayBuffers.delete(oldestPatientId);
      patientLastActivity.delete(oldestPatientId);
    }
  }
}

function cleanupInactiveReplayBuffers() {
  const cutoff = nowMs() - REPLAY_BUFFER_TTL_MS;
  for (const [patientId, buf] of replayBuffers.entries()) {
    const hasClients = (clients.get(patientId)?.size ?? 0) > 0;
    const lastActivity = patientLastActivity.get(patientId) ?? 0;
    if (!hasClients && lastActivity < cutoff) {
      totalBufferedEvents = Math.max(0, totalBufferedEvents - buf.length);
      replayBuffers.delete(patientId);
      patientLastActivity.delete(patientId);
      continue;
    }
    prunePatientBuffer(patientId);
  }
}

const replayGcTimer = setInterval(cleanupInactiveReplayBuffers, 60_000);
replayGcTimer.unref();

export function broadcastFeedEvent(patientId: string, event: object) {
  const eventName = (event as { type?: unknown }).type;
  const evt: BufferedEvent = {
    id: nextEventId(),
    event: typeof eventName === 'string' ? eventName : 'message',
    data: JSON.stringify(event),
    createdAt: nowMs(),
  };

  appendToReplayBuffer(patientId, evt);

  const patientClients = clients.get(patientId);
  if (!patientClients || patientClients.size === 0) return;

  const frame = formatSseFrame(evt);
  patientClients.forEach((res) => {
    res.write(frame);
  });
}

export function closeAllFeedStreams(reason = 'server_shutdown') {
  const payload = JSON.stringify({ type: 'shutdown', reason });
  const shutdownEvent: BufferedEvent = {
    id: nextEventId(),
    event: 'shutdown',
    data: payload,
    createdAt: nowMs(),
  };
  const frame = formatSseFrame(shutdownEvent);

  for (const [, patientClients] of clients.entries()) {
    patientClients.forEach((res) => {
      try {
        res.write(frame);
      } catch {
        // Ignore write errors on shutdown; stream is ending anyway.
      }
      res.end();
    });
  }

  clients.clear();
  totalSseConnections = 0;
}

function replayMissedEvents(patientId: string, lastEventId: string, res: Response) {
  const buf = replayBuffers.get(patientId);
  if (!buf || buf.length === 0) return;
  for (const evt of buf) {
    if (isAfterEventId(evt.id, lastEventId)) {
      res.write(formatSseFrame(evt));
    }
  }
}

// SSE stream for live feed updates — must be registered BEFORE /:patientId
// otherwise Express matches "events" as the patientId param
feedRouter.get('/events/:patientId', requirePatientAccess, (req: Request, res: Response) => {
  const patientId = req.params.patientId as string;

  const existing = clients.get(patientId) ?? new Set<Response>();
  if (existing.size >= MAX_SSE_CONNECTIONS_PER_PATIENT) {
    return res.status(429).json({ error: 'Too many active connections' });
  }
  if (totalSseConnections >= MAX_TOTAL_SSE_CONNECTIONS) {
    return res.status(429).json({ error: 'Too many active connections globally' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write('retry: 3000\n\n');

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);
  heartbeat.unref();

  // Register before replaying so any broadcast that fires after replay begins
  // is delivered in-order. Safe because replay is synchronous and Node.js is
  // single-threaded — no broadcast can interleave with it today. If pipeline
  // work ever moves to worker threads or a shared channel, revisit this.
  existing.add(res);
  clients.set(patientId, existing);
  totalSseConnections += 1;
  patientLastActivity.set(patientId, nowMs());

  const lastEventId = req.get('last-event-id');
  if (lastEventId) {
    replayMissedEvents(patientId, lastEventId, res);
  }

  req.on('close', () => {
    clearInterval(heartbeat);
    const current = clients.get(patientId);
    if (!current) return;
    if (current.delete(res)) {
      totalSseConnections = Math.max(0, totalSseConnections - 1);
    }
    if (current.size === 0) {
      clients.delete(patientId);
    }
    patientLastActivity.set(patientId, nowMs());
    prunePatientBuffer(patientId);
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
