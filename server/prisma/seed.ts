import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Stable IDs — deterministic upserts for entities without natural unique keys
const PATIENT_ID     = 'seed-patient-margaret';
const MED_LISI_ID    = 'seed-med-lisinopril';
const MED_MET_ID     = 'seed-med-metformin';
const APPT_CARDIO_ID = 'seed-appt-cardiology';
const APPT_REFILL_ID = 'seed-appt-refill';
const INTER_ID       = 'seed-inter-lisi-met';

async function main() {
  console.log('Seeding Havenhold demo data...');

  // Patient
  const margaret = await prisma.patient.upsert({
    where: { id: PATIENT_ID },
    update: {},
    create: { id: PATIENT_ID, name: 'Margaret Chen', dateOfBirth: new Date('1945-03-12') },
  });

  // Medications
  const lisinopril = await prisma.medication.upsert({
    where: { id: MED_LISI_ID },
    update: {},
    create: {
      id: MED_LISI_ID,
      patientId: margaret.id,
      name: 'Lisinopril',
      dosage: '10mg',
      frequency: 'Once daily',
      prescribingDoctor: 'Dr. Patricia Wong',
      aiDescription:
        "Lisinopril is a blood pressure medication that helps keep your mom's heart from working too hard. It relaxes the blood vessels so her heart pumps more easily. Common things to watch for include a dry cough, dizziness when standing up quickly, and occasional headaches.",
    },
  });

  const metformin = await prisma.medication.upsert({
    where: { id: MED_MET_ID },
    update: {},
    create: {
      id: MED_MET_ID,
      patientId: margaret.id,
      name: 'Metformin',
      dosage: '500mg',
      frequency: 'Twice daily with meals',
      prescribingDoctor: 'Dr. James Park',
      aiDescription:
        "Metformin helps control your mom's blood sugar levels for her type 2 diabetes. It's best taken with food to avoid an upset stomach. Watch for nausea or diarrhea when she first starts, and make sure she's eating regularly — skipping meals can cause low blood sugar.",
    },
  });

  // Appointments
  await prisma.appointment.upsert({
    where: { id: APPT_CARDIO_ID },
    update: {},
    create: {
      id: APPT_CARDIO_ID,
      patientId: margaret.id,
      title: 'Cardiology Follow-up',
      doctor: 'Dr. Patricia Wong',
      specialty: 'Cardiology',
      datetime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      location: 'Sunrise Medical Center, Room 204',
      notes: 'Bring updated medication list. Fasting bloodwork required.',
    },
  });

  await prisma.appointment.upsert({
    where: { id: APPT_REFILL_ID },
    update: {},
    create: {
      id: APPT_REFILL_ID,
      patientId: margaret.id,
      title: 'Prescription Refill — Metformin',
      doctor: 'Dr. James Park',
      specialty: 'Primary Care',
      datetime: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      location: 'Parkview Family Medicine',
    },
  });

  // Medication interaction
  await prisma.medicationInteraction.upsert({
    where: { id: INTER_ID },
    update: {},
    create: {
      id: INTER_ID,
      patientId: margaret.id,
      medicationAId: lisinopril.id,
      medicationBId: metformin.id,
      severity: 'MILD',
      description:
        'Lisinopril may slightly increase the blood sugar-lowering effect of Metformin. Monitor for signs of low blood sugar (shakiness, sweating, confusion) particularly after meals.',
    },
  });

  console.log(`✓ Patient: ${margaret.name} (id: ${margaret.id})`);
  console.log('✓ 2 medications with interaction');
  console.log('✓ 2 upcoming appointments');
  console.log('\nPatient ID:', margaret.id);
  console.log('Create your account via the API, then link it:');
  console.log(`  patientMember: { userId: <your-id>, patientId: '${margaret.id}', role: 'OWNER' }`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
