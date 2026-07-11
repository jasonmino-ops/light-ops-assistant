-- Store-level currency configuration.
-- Default USD matches the current hardcoded $ display behavior for existing stores.
ALTER TABLE "Store" ADD COLUMN "currencyCode" TEXT NOT NULL DEFAULT 'USD';

-- Central African Republic pilot store: display as FCFA, no exchange conversion.
UPDATE "Store"
SET "currencyCode" = 'XAF'
WHERE "code" = 'ST5B7AFF38';
