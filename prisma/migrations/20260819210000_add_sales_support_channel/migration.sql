-- ES-SALES-LEAD-01 — dedicated onboarding support channel.
-- Additive only: no new business model and no TelegramMessage-to-Lead backfill.

ALTER TABLE "SalesLead"
ADD COLUMN "salesOwnerId" TEXT;

-- Existing first-touch assignments become the initial current assignment.
-- initialSalesOwnerId remains immutable and is never overwritten by claiming.
UPDATE "SalesLead"
SET "salesOwnerId" = "initialSalesOwnerId"
WHERE "salesOwnerId" IS NULL
  AND "initialSalesOwnerId" IS NOT NULL;

ALTER TABLE "TelegramMessage"
ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'MERCHANT',
ADD COLUMN "salesLeadId" TEXT;

CREATE INDEX "SalesLead_salesOwnerId_status_lastActivityAt_idx"
ON "SalesLead"("salesOwnerId", "status", "lastActivityAt");

CREATE INDEX "TelegramMessage_channel_recipientTelegramId_createdAt_idx"
ON "TelegramMessage"("channel", "recipientTelegramId", "createdAt");

CREATE INDEX "TelegramMessage_channel_salesLeadId_createdAt_idx"
ON "TelegramMessage"("channel", "salesLeadId", "createdAt");

ALTER TABLE "SalesLead"
ADD CONSTRAINT "SalesLead_salesOwnerId_fkey"
FOREIGN KEY ("salesOwnerId") REFERENCES "OpsAdmin"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TelegramMessage"
ADD CONSTRAINT "TelegramMessage_salesLeadId_fkey"
FOREIGN KEY ("salesLeadId") REFERENCES "SalesLead"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
