import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { assertPatientMembership } from '../middleware/sessionAuth';

export const commentsRouter = Router();

async function resolveEntityPatientId(
  entityType: string,
  entityId: string
): Promise<string | null> {
  if (entityType === 'document') {
    const doc = await prisma.document.findUnique({ where: { id: entityId }, select: { patientId: true } });
    return doc?.patientId ?? null;
  }
  if (entityType === 'appointment') {
    const appt = await prisma.appointment.findUnique({ where: { id: entityId }, select: { patientId: true } });
    return appt?.patientId ?? null;
  }
  if (entityType === 'medication') {
    const med = await prisma.medication.findUnique({ where: { id: entityId }, select: { patientId: true } });
    return med?.patientId ?? null;
  }
  return null;
}

// Add a comment — authorId comes from the session, not the request body
commentsRouter.post('/', async (req, res) => {
  try {
    const { body, documentId, appointmentId, medicationId } = req.body;

    const provided: { type: 'document' | 'appointment' | 'medication'; id: string }[] = [
      ...(documentId    ? [{ type: 'document'    as const, id: documentId }]    : []),
      ...(appointmentId ? [{ type: 'appointment' as const, id: appointmentId }] : []),
      ...(medicationId  ? [{ type: 'medication'  as const, id: medicationId }]  : []),
    ];

    if (provided.length === 0) {
      return res.status(400).json({ error: 'A documentId, appointmentId, or medicationId is required' });
    }

    // Resolve patientId for every provided entity
    const patientIds = await Promise.all(
      provided.map(async ({ type, id }) => {
        const ownerPatientId = await resolveEntityPatientId(type, id);
        if (!ownerPatientId) throw Object.assign(new Error(`${type} not found`), { status: 404 });
        return ownerPatientId;
      })
    );

    // All entities must belong to the same patient — prevents cross-patient comment linking
    const uniquePatientIds = new Set(patientIds);
    if (uniquePatientIds.size > 1) {
      return res.status(400).json({ error: 'All entities must belong to the same patient' });
    }

    const patientId = patientIds[0];
    const membership = await assertPatientMembership(req.user!.id, patientId);
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const comment = await prisma.comment.create({
      data: { authorId: req.user!.id, body, documentId, appointmentId, medicationId },
      include: { author: true },
    });
    res.status(201).json(comment);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'status' in err &&
      (err as Error & { status: unknown }).status === 404
    ) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// Get comments for an entity
commentsRouter.get('/:entityType/:entityId', async (req, res) => {
  try {
    const { entityType, entityId } = req.params;

    if (!['document', 'appointment', 'medication'].includes(entityType)) {
      return res.status(400).json({ error: 'Invalid entity type' });
    }

    const ownerPatientId = await resolveEntityPatientId(entityType, entityId);
    if (!ownerPatientId) return res.status(404).json({ error: 'Entity not found' });

    const membership = await assertPatientMembership(req.user!.id, ownerPatientId);
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const where: Record<string, string> = {};
    if (entityType === 'document') where.documentId = entityId;
    else if (entityType === 'appointment') where.appointmentId = entityId;
    else where.medicationId = entityId;

    const comments = await prisma.comment.findMany({
      where,
      include: { author: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});
