-- CreateTable
CREATE TABLE "WebhookInboundLog" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawBody" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "eventType" TEXT,
    "eventId" TEXT,
    "payload" JSONB,
    "errorMessage" TEXT,

    CONSTRAINT "WebhookInboundLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookInboundLog_receivedAt_idx" ON "WebhookInboundLog"("receivedAt");
