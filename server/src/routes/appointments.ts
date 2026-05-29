import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requirePatientAccess, assertPatientMembership } from '../middleware/sessionAuth';

export const appointmentsRouter = Router();

// Escape special characters in iCal text fields (RFC 5545)
function escapeIcal(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n').replace(/\r/g, '');
}

// List appointments for a patient — exclude PENDING (awaiting review)
appointmentsRouter.get('/:patientId', requirePatientAccess, async (req, res) => {
  try {
    const appointments = await prisma.appointment.findMany({
      where: { patientId: req.params.patientId as string, reviewStatus: 'CONFIRMED' },
      include: { comments: { include: { author: true } } },
      orderBy: { datetime: 'asc' },
    });
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Create appointment manually
appointmentsRouter.post('/', requirePatientAccess, async (req, res) => {
  try {
    const { patientId, title, doctor, specialty, datetime, location, notes } = req.body;
    const appointment = await prisma.appointment.create({
      data: { patientId, title, doctor, specialty, datetime: new Date(datetime), location, notes },
    });
    res.status(201).json(appointment);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

// Update appointment — only allow mutable user-facing fields
appointmentsRouter.patch('/:id', async (req, res) => {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      select: { patientId: true },
    });
    if (!appt) return res.status(404).json({ error: 'Not found' });
    const membership = await assertPatientMembership(req.user!.id, appt.patientId);
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const { title, doctor, specialty, datetime, location, notes } = req.body;
    const appointment = await prisma.appointment.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined && { title }),
        ...(doctor !== undefined && { doctor }),
        ...(specialty !== undefined && { specialty }),
        ...(datetime !== undefined && { datetime: new Date(datetime) }),
        ...(location !== undefined && { location }),
        ...(notes !== undefined && { notes }),
      },
    });
    res.json(appointment);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

// Review AI-extracted appointment — confirm or reject
appointmentsRouter.patch('/:id/review', async (req, res) => {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      select: { patientId: true },
    });
    if (!appt) return res.status(404).json({ error: 'Not found' });
    const membership = await assertPatientMembership(req.user!.id, appt.patientId);
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const { action } = req.body as { action: 'confirm' | 'reject' };
    if (!['confirm', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be confirm or reject' });
    }
    const appointment = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { reviewStatus: action === 'confirm' ? 'CONFIRMED' : 'REJECTED' },
    });
    res.json(appointment);
  } catch (err) {
    res.status(500).json({ error: 'Failed to review appointment' });
  }
});

// Export single appointment as iCal
appointmentsRouter.get('/:id/ical', async (req, res) => {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: req.params.id },
    });
    if (!appt) return res.status(404).json({ error: 'Not found' });
    const membership = await assertPatientMembership(req.user!.id, appt.patientId);
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const start = new Date(appt.datetime);
    const end = new Date(start.getTime() + 60 * 60 * 1000); // 1hr default

    const fmt = (d: Date) =>
      d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const safeFilename = appt.title.replace(/[^a-z0-9\s\-_]/gi, '').trim() || 'appointment';

    const ical = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Havenhold//EN',
      'BEGIN:VEVENT',
      `UID:${appt.id}@havenhold`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${escapeIcal(appt.title)}`,
      appt.location ? `LOCATION:${escapeIcal(appt.location)}` : '',
      appt.notes ? `DESCRIPTION:${escapeIcal(appt.notes)}` : '',
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .filter(Boolean)
      .join('\r\n');

    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.ics"`);
    res.send(ical);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate iCal' });
  }
});
