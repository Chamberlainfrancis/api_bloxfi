-- CreateEnum
CREATE TYPE "OnrampBeneficiaryStatus" AS ENUM ('pending_import', 'approved', 'rejected', 'failed');

-- CreateTable
CREATE TABLE "OnrampBeneficiary" (
    "id" TEXT NOT NULL,
    "businessUserId" TEXT NOT NULL,
    "status" "OnrampBeneficiaryStatus" NOT NULL DEFAULT 'pending_import',
    "swipeluxCustomerId" TEXT,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "identitySnapshot" JSONB,
    "creationRequestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnrampBeneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnrampBeneficiary_creationRequestId_key" ON "OnrampBeneficiary"("creationRequestId");

-- CreateIndex
CREATE INDEX "OnrampBeneficiary_businessUserId_idx" ON "OnrampBeneficiary"("businessUserId");

-- AddForeignKey
ALTER TABLE "OnrampBeneficiary" ADD CONSTRAINT "OnrampBeneficiary_businessUserId_fkey" FOREIGN KEY ("businessUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
