-- CreateEnum
CREATE TYPE "HighValueRequestStatusEnum" AS ENUM ('pending', 'under_review', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "HighValueRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "HighValueRequestStatusEnum" NOT NULL DEFAULT 'pending',
    "currency" TEXT,
    "requestedLimit" TEXT,
    "reason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HighValueRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HighValueRequest_requestId_key" ON "HighValueRequest"("requestId");

-- CreateIndex
CREATE INDEX "HighValueRequest_userId_idx" ON "HighValueRequest"("userId");

-- CreateIndex
CREATE INDEX "HighValueRequest_userId_status_idx" ON "HighValueRequest"("userId", "status");

-- AddForeignKey
ALTER TABLE "HighValueRequest" ADD CONSTRAINT "HighValueRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
