-- CreateTable
CREATE TABLE "WebhookOutboundLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "rawBody" TEXT NOT NULL,
    "destination" TEXT,
    "outcome" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "httpStatus" INTEGER,
    "errorMessage" TEXT,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookOutboundLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookOutboundLog_createdAt_idx" ON "WebhookOutboundLog"("createdAt");

-- CreateIndex
CREATE INDEX "WebhookOutboundLog_eventId_idx" ON "WebhookOutboundLog"("eventId");

-- CreateIndex
CREATE INDEX "WebhookOutboundLog_eventType_idx" ON "WebhookOutboundLog"("eventType");

-- CreateIndex
CREATE INDEX "WebhookOutboundLog_outcome_idx" ON "WebhookOutboundLog"("outcome");
