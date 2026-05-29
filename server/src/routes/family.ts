import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requirePatientAccess } from '../middleware/sessionAuth';

export const familyRouter = Router();

familyRouter.get('/:patientId', requirePatientAccess, async (req, res) => {
  try {
    const members = await prisma.patientMember.findMany({
      where: { patientId: req.params.patientId as string },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
      orderBy: { role: 'asc' },
    });
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch family members' });
  }
});
