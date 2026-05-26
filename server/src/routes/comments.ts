import { Router } from 'express';
import { prisma } from '../lib/prisma';

export const commentsRouter = Router();

// Add a comment — authorId comes from the session, not the request body
commentsRouter.post('/', async (req, res) => {
  try {
    const { body, documentId, appointmentId, medicationId } = req.body;
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const authorId = req.user.id;

    const comment = await prisma.comment.create({
      data: { authorId, body, documentId, appointmentId, medicationId },
      include: { author: true },
    });
    res.status(201).json(comment);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// Get comments for an entity
commentsRouter.get('/:entityType/:entityId', async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const where: Record<string, string> = {};

    if (entityType === 'document') where.documentId = entityId;
    else if (entityType === 'appointment') where.appointmentId = entityId;
    else if (entityType === 'medication') where.medicationId = entityId;
    else return res.status(400).json({ error: 'Invalid entity type' });

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
