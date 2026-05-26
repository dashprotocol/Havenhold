import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Havenhold demo data...');

  // Patient
  const margaret = await prisma.patient.create({
    data: { name: 'Margaret Chen', dateOfBirth: new Date('1945-03-12') },
  });

  // Family members
  await prisma.user.createMany({
    data: [
      {
        name: 'David Chen',
        email: 'david@example.com',
        role: 'PRIMARY_CAREGIVER',
        patientId: margaret.id,
      },
      {
        name: 'Sarah Chen',
        email: 'sarah@example.com',
        role: 'FAMILY_MEMBER',
        patientId: margaret.id,
      },
      {
        name: 'Michael Chen',
        email: 'michael@example.com',
        role: 'FAMILY_MEMBER',
        patientId: margaret.id,
      },
    ],
  });

  const primaryCaregiver = await prisma.user.findUnique({
    where: { email: 'david@example.com' },
  });

  // Existing medications
  const lisinopril = await prisma.medication.create({
    data: {
      patientId: margaret.id,
      name: 'Lisinopril',
      dosage: '10mg',
      frequency: 'Once daily',
      prescribingDoctor: 'Dr. Patricia Wong',
      aiDescription:
        'Lisinopril is a blood pressure medication that helps keep your mom\'s heart from working too hard. It relaxes the blood vessels so her heart pumps more easily. Common things to watch for include a dry cough, dizziness when standing up quickly, and occasional headaches.',
    },
  });

  const metformin = await prisma.medication.create({
    data: {
      patientId: margaret.id,
      name: 'Metformin',
      dosage: '500mg',
      frequency: 'Twice daily with meals',
      prescribingDoctor: 'Dr. James Park',
      aiDescription:
        'Metformin helps control your mom\'s blood sugar levels for her type 2 diabetes. It\'s best taken with food to avoid an upset stomach. Watch for nausea or diarrhea when she first starts, and make sure she\'s eating regularly — skipping meals can cause low blood sugar.',
    },
  });

  // Upcoming appointments
  await prisma.appointment.createMany({
    data: [
      {
        patientId: margaret.id,
        title: 'Cardiology Follow-up',
        doctor: 'Dr. Patricia Wong',
        specialty: 'Cardiology',
        datetime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week
        location: 'Sunrise Medical Center, Room 204',
        notes: 'Bring updated medication list. Fasting bloodwork required.',
      },
      {
        patientId: margaret.id,
        title: 'Prescription Refill — Metformin',
        doctor: 'Dr. James Park',
        specialty: 'Primary Care',
        datetime: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2 weeks
        location: 'Parkview Family Medicine',
      },
    ],
  });

  // A known interaction between the two medications
  await prisma.medicationInteraction.create({
    data: {
      patientId: margaret.id,
      medicationAId: lisinopril.id,
      medicationBId: metformin.id,
      severity: 'MILD',
      description:
        'Lisinopril may slightly increase the blood sugar-lowering effect of Metformin. Monitor for signs of low blood sugar (shakiness, sweating, confusion) particularly after meals.',
    },
  });

  console.log(`✓ Patient: ${margaret.name} (id: ${margaret.id})`);
  console.log('✓ 3 family members');
  console.log('✓ 2 medications with interaction');
  console.log('✓ 2 upcoming appointments');
  console.log('\nPatient ID for API calls:', margaret.id);
  console.log('Demo user ID for API calls:', primaryCaregiver?.id ?? 'not found');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
