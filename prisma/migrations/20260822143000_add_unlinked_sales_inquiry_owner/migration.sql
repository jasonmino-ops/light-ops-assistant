-- ES-SALES-LEAD-01 — persist ownership for unlinked onboarding inquiries.
-- Additive only: no new model, no Lead/Application backfill, historical rows remain unclaimed.

ALTER TABLE "TelegramMessage"
ADD COLUMN "salesInquiryOwnerId" TEXT;

CREATE INDEX "TelegramMessage_sales_inquiry_owner_idx"
ON "TelegramMessage"("channel", "salesLeadId", "salesInquiryOwnerId", "createdAt");

ALTER TABLE "TelegramMessage"
ADD CONSTRAINT "TelegramMessage_salesInquiryOwnerId_fkey"
FOREIGN KEY ("salesInquiryOwnerId") REFERENCES "OpsAdmin"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
