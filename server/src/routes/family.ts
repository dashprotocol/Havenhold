import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requirePatientAccess } from '../middleware/sessionAuth';

export const familyRouter = Router();

// List family members for a patient
familyRouter.get('/:patientId', requirePatientAccess, async (req, res) => {
  try {
    const members = await prisma.user.findMany({
      where: { patientId: req.params.patientId as string },
      orderBy: { role: 'asc' },
    });
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch family members' });
  }
});
