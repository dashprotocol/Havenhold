-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'CONFIRMED';

-- AlterTable
ALTER TABLE "Medication" ADD COLUMN     "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'CONFIRMED';
