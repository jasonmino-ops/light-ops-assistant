-- ES-SALES-LEAD-01 — retain Telegram username for Sales Onboarding contacts.
-- Additive only: historical rows remain NULL and no identity/Lead backfill is attempted.

ALTER TABLE "TelegramMessage"
ADD COLUMN "senderUsername" TEXT;
