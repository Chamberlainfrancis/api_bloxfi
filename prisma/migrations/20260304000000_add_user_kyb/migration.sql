-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "KYBStatusEnum" AS ENUM ('not_started', 'incomplete', 'under_review', 'approved', 'rejected', 'suspended');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'business',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "businessInfo" JSONB NOT NULL,
    "registeredAddress" JSONB NOT NULL,
    "legalRepresentative" JSONB NOT NULL,
    "metadata" JSONB,
    "kybStatus" "KYBStatusEnum" NOT NULL DEFAULT 'not_started',
    "approvedRails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KybInfo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessDetails" JSONB,
    "beneficialOwners" JSONB,
    "directors" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KybInfo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KybSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rails" TEXT[] NOT NULL,
    "priority" TEXT,
    "status" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estimatedCompletionDate" TIMESTAMP(3),

    CONSTRAINT "KybSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KybRailStatus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rail" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "KybRailStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_id_idx" ON "User"("id");

-- CreateIndex
CREATE UNIQUE INDEX "KybInfo_userId_key" ON "KybInfo"("userId");

-- CreateIndex
CREATE INDEX "KybSubmission_userId_idx" ON "KybSubmission"("userId");

-- CreateIndex
CREATE INDEX "KybRailStatus_userId_idx" ON "KybRailStatus"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "KybRailStatus_userId_rail_key" ON "KybRailStatus"("userId", "rail");

-- AddForeignKey
ALTER TABLE "KybInfo" ADD CONSTRAINT "KybInfo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KybSubmission" ADD CONSTRAINT "KybSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KybRailStatus" ADD CONSTRAINT "KybRailStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
