/*
  Warnings:

  - A unique constraint covering the columns `[medicationAId,medicationBId]` on the table `MedicationInteraction` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "MedicationInteraction_medicationAId_medicationBId_key" ON "MedicationInteraction"("medicationAId", "medicationBId");
