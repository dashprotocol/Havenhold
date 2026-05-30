import { Router } from 'express';
import { prisma } from '../lib/prisma';

export const meRouter = Router();

meRouter.get('/', async (req, res) => {
  try {
    const memberships = await prisma.patientMember.findMany({
      where: { userId: req.user!.id },
      select: {
        id: true,
        role: true,
        patient: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      id: req.user!.id,
      name: req.user!.name,
      email: req.user!.email,
      memberships,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});
