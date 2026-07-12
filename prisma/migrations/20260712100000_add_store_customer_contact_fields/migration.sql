-- Store public contact methods for customer-facing "Contact merchant".
ALTER TABLE "Store" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "Store" ADD COLUMN "contactTelegram" TEXT;
ALTER TABLE "Store" ADD COLUMN "contactWhatsApp" TEXT;
