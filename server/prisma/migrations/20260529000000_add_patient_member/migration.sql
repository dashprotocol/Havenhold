-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateTable
CREATE TABLE "PatientMember" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'VIEWER',
    "invitedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientMember_patientId_userId_key" ON "PatientMember"("patientId", "userId");

-- CreateIndex
CREATE INDEX "PatientMember_userId_idx" ON "PatientMember"("userId");

-- AddForeignKey
ALTER TABLE "PatientMember" ADD CONSTRAINT "PatientMember_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMember" ADD CONSTRAINT "PatientMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: convert existing User.patientId rows to PatientMember rows with OWNER role
-- All existing users with a patientId were the sole accessor of that patient record
INSERT INTO "PatientMember" ("id", "patientId", "userId", "role", "createdAt", "updatedAt")
SELECT
    md5("id" || "patientId" || 'owner-migration'),
    "patientId",
    "id",
    'OWNER'::"MemberRole",
    NOW(),
    NOW()
FROM "User"
WHERE "patientId" IS NOT NULL;

-- SafetyCheck: verify migrated count matches source before dropping columns
DO $$
DECLARE
  expected INT;
  actual   INT;
BEGIN
  SELECT COUNT(*) INTO expected FROM "User" WHERE "patientId" IS NOT NULL;
  SELECT COUNT(*) INTO actual   FROM "PatientMember";
  IF actual <> expected THEN
    RAISE EXCEPTION 'Migration safety check failed: expected % PatientMember rows, found %', expected, actual;
  END IF;
END $$;

-- DropColumn: remove old direct User→Patient fields
ALTER TABLE "User" DROP COLUMN "patientId";
ALTER TABLE "User" DROP COLUMN "role";

-- DropEnum
DROP TYPE "Role";
