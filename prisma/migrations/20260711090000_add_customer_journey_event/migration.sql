CREATE TABLE "CustomerJourneyEvent" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "storeCode" TEXT NOT NULL,
  "visitorId" TEXT,
  "source" TEXT,
  "campaign" TEXT,
  "referrer" TEXT,
  "language" TEXT,
  "orderId" TEXT,
  "eventKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CustomerJourneyEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CustomerJourneyEvent"
  ADD CONSTRAINT "CustomerJourneyEvent_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "CustomerJourneyEvent_eventKey_key" ON "CustomerJourneyEvent"("eventKey");
CREATE INDEX "CustomerJourneyEvent_storeId_eventType_createdAt_idx" ON "CustomerJourneyEvent"("storeId", "eventType", "createdAt");
CREATE INDEX "CustomerJourneyEvent_storeCode_createdAt_idx" ON "CustomerJourneyEvent"("storeCode", "createdAt");
CREATE INDEX "CustomerJourneyEvent_visitorId_createdAt_idx" ON "CustomerJourneyEvent"("visitorId", "createdAt");
CREATE INDEX "CustomerJourneyEvent_orderId_idx" ON "CustomerJourneyEvent"("orderId");
