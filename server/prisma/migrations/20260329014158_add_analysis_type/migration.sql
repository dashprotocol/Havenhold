-- CreateEnum
CREATE TYPE "AnalysisType" AS ENUM ('BALANCED', 'SCIENTIFIC', 'HOLISTIC', 'INTEGRATIVE');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "analysisType" "AnalysisType" NOT NULL DEFAULT 'BALANCED';

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "analysisType" "AnalysisType" NOT NULL DEFAULT 'BALANCED';
