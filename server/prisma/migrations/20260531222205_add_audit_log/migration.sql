-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('INVITE_CREATED', 'INVITE_ACCEPTED', 'INVITE_REVOKED', 'MEMBER_REMOVED', 'RECORD_CREATED', 'RECORD_UPDATED', 'RECORD_DELETED', 'RECORD_EXPORTED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VIEWED');

-- CreateEnum
CREATE TYPE "AuditResource" AS ENUM ('APPOINTMENT', 'MEDICATION', 'DOCUMENT', 'COMMENT', 'INVITE', 'MEMBER');

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "patientId" TEXT,
    "action" "AuditAction" NOT NULL,
    "resource" "AuditResource",
    "resourceId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_patientId_createdAt_idx" ON "AuditLog"("patientId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
