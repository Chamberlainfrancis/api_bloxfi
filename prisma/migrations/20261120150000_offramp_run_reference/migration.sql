-- AlterTable
ALTER TABLE "Offramp" ADD COLUMN "runReference" TEXT;

-- CreateIndex
CREATE INDEX "Offramp_runReference_idx" ON "Offramp"("runReference");
