import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);

  const result = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  console.log(
    `[prune-audit-logs] Deleted ${result.count} rows older than ${cutoff.toISOString()}`,
  );
}

main()
  .catch((err) => {
    console.error('[prune-audit-logs] Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
