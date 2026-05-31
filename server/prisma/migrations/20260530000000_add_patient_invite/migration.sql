-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- AlterTable
ALTER TABLE "PatientMember" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "impersonatedBy" TEXT;

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "banExpires" TIMESTAMP(3),
  ADD COLUMN "banReason"  TEXT,
  ADD COLUMN "banned"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "role"       TEXT;

-- CreateTable
CREATE TABLE "PatientInvite" (
    "id"          TEXT NOT NULL,
    "patientId"   TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "email"       TEXT NOT NULL,
    "role"        "MemberRole"   NOT NULL DEFAULT 'VIEWER',
    "tokenHash"   TEXT NOT NULL,
    "expiresAt"   TIMESTAMP(3)   NOT NULL,
    "status"      "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt"   TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3)   NOT NULL,

    CONSTRAINT "PatientInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientInvite_tokenHash_key" ON "PatientInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "PatientInvite_patientId_idx" ON "PatientInvite"("patientId");

-- CreateIndex
CREATE INDEX "PatientInvite_patientId_email_idx" ON "PatientInvite"("patientId", "email");

-- Partial unique index: only one PENDING invite per (patientId, email)
CREATE UNIQUE INDEX "PatientInvite_patientId_email_pending_key"
  ON "PatientInvite" ("patientId", "email")
  WHERE status = 'PENDING';

-- AddForeignKey
ALTER TABLE "PatientInvite" ADD CONSTRAINT "PatientInvite_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientInvite" ADD CONSTRAINT "PatientInvite_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
