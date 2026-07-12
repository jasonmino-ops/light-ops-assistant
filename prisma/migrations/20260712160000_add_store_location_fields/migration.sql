-- Store public location for customer-facing "Contact merchant" navigation.
ALTER TABLE "Store" ADD COLUMN "storeAddress" TEXT;
ALTER TABLE "Store" ADD COLUMN "storeLat" DOUBLE PRECISION;
ALTER TABLE "Store" ADD COLUMN "storeLng" DOUBLE PRECISION;
