-- CreateTable
CREATE TABLE "FeishuEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "FeishuEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeishuEvent_eventId_key" ON "FeishuEvent"("eventId");

-- CreateIndex
CREATE INDEX "FeishuEvent_eventType_receivedAt_idx" ON "FeishuEvent"("eventType", "receivedAt");
