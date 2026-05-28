import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requirePatientAccess } from '../middleware/sessionAuth';

export const medicationsRouter = Router();

// List medications with interactions — exclude PENDING (awaiting review)
medicationsRouter.get('/:patientId', requirePatientAccess, async (req, res) => {
  try {
    const medications = await prisma.medication.findMany({
      where: { patientId: req.params.patientId as string, active: true, reviewStatus: 'CONFIRMED' },
      include: {
        comments: { include: { author: true } },
        interactionsA: { include: { medicationB: true } },
        interactionsB: { include: { medicationA: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(medications);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch medications' });
  }
});

// Create medication manually
medicationsRouter.post('/', requirePatientAccess, async (req, res) => {
  try {
    const { patientId, name, dosage, frequency, prescribingDoctor } = req.body;
    const medication = await prisma.medication.create({
      data: { patientId, name, dosage, frequency, prescribingDoctor },
    });
    res.status(201).json(medication);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create medication' });
  }
});

// Review AI-extracted medication — confirm or reject
medicationsRouter.patch('/:id/review', async (req, res) => {
  try {
    const med = await prisma.medication.findUnique({
      where: { id: req.params.id },
      select: { patientId: true },
    });
    if (!med) return res.status(404).json({ error: 'Not found' });
    if (med.patientId !== req.user!.patientId) return res.status(403).json({ error: 'Access denied' });

    const { action } = req.body as { action: 'confirm' | 'reject' };
    if (!['confirm', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be confirm or reject' });
    }
    const medication = await prisma.medication.update({
      where: { id: req.params.id },
      data: { reviewStatus: action === 'confirm' ? 'CONFIRMED' : 'REJECTED' },
    });
    res.json(medication);
  } catch (err) {
    res.status(500).json({ error: 'Failed to review medication' });
  }
});

// Update medication — only allow mutable user-facing fields
medicationsRouter.patch('/:id', async (req, res) => {
  try {
    const med = await prisma.medication.findUnique({
      where: { id: req.params.id },
      select: { patientId: true },
    });
    if (!med) return res.status(404).json({ error: 'Not found' });
    if (med.patientId !== req.user!.patientId) return res.status(403).json({ error: 'Access denied' });

    const { name, dosage, frequency, prescribingDoctor, active } = req.body;
    const medication = await prisma.medication.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(dosage !== undefined && { dosage }),
        ...(frequency !== undefined && { frequency }),
        ...(prescribingDoctor !== undefined && { prescribingDoctor }),
        ...(active !== undefined && { active }),
      },
    });
    res.json(medication);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update medication' });
  }
});
