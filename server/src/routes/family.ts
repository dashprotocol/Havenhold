import { Router } from 'express';
import { prisma } from '../lib/prisma';

export const familyRouter = Router();

// List family members for a patient
familyRouter.get('/:patientId', async (req, res) => {
  try {
    const members = await prisma.user.findMany({
      where: { patientId: req.params.patientId },
      orderBy: { role: 'asc' },
    });
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch family members' });
  }
});
