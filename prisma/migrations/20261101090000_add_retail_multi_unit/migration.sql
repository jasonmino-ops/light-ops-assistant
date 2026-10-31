-- ES-RETAIL-MULTI-UNIT-01
-- Additive only: existing products remain main-unit products and historical
-- sale records retain their legacy null selling-unit snapshot.

ALTER TABLE "Product"
  ADD COLUMN "mainUnitName" TEXT,
  ADD COLUMN "auxUnitName" TEXT,
  ADD COLUMN "auxBarcode" TEXT,
  ADD COLUMN "auxConversionFactor" INTEGER,
  ADD COLUMN "auxSellPrice" DECIMAL(12,2),
  ADD COLUMN "auxEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "SaleRecord"
  ADD COLUMN "sellingUnitType" TEXT,
  ADD COLUMN "sellingUnitNameSnapshot" TEXT,
  ADD COLUMN "sellingQuantity" DECIMAL(12,2),
  ADD COLUMN "sellingConversionFactor" INTEGER;

CREATE UNIQUE INDEX "Product_tenantId_auxBarcode_key"
  ON "Product"("tenantId", "auxBarcode");

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_auxConversionFactor_check"
    CHECK ("auxConversionFactor" IS NULL OR "auxConversionFactor" >= 2),
  ADD CONSTRAINT "Product_auxSellPrice_check"
    CHECK ("auxSellPrice" IS NULL OR "auxSellPrice" > 0),
  ADD CONSTRAINT "Product_auxEnabled_complete_check"
    CHECK (
      NOT "auxEnabled" OR (
        "auxUnitName" IS NOT NULL AND length(btrim("auxUnitName")) > 0 AND
        "auxBarcode" IS NOT NULL AND length(btrim("auxBarcode")) > 0 AND
        "auxConversionFactor" IS NOT NULL AND "auxConversionFactor" >= 2 AND
        "auxSellPrice" IS NOT NULL AND "auxSellPrice" > 0
      )
    );

ALTER TABLE "SaleRecord"
  ADD CONSTRAINT "SaleRecord_sellingUnit_snapshot_check"
    CHECK (
      (
        "sellingUnitType" IS NULL AND
        "sellingUnitNameSnapshot" IS NULL AND
        "sellingQuantity" IS NULL AND
        "sellingConversionFactor" IS NULL
      ) OR (
        "sellingUnitType" IN ('MAIN', 'AUX') AND
        "sellingUnitNameSnapshot" IS NOT NULL AND length(btrim("sellingUnitNameSnapshot")) > 0 AND
        "sellingQuantity" IS NOT NULL AND "sellingQuantity" <> 0 AND
        "sellingConversionFactor" IS NOT NULL AND
        (
          ("sellingUnitType" = 'MAIN' AND "sellingConversionFactor" = 1) OR
          ("sellingUnitType" = 'AUX' AND "sellingConversionFactor" >= 2)
        )
      )
    );

-- Serialize Product barcode writes within one tenant, then reject any
-- main/aux cross-column collision. Exact-string matching is intentional.
CREATE OR REPLACE FUNCTION "enforce_product_unit_barcode_uniqueness"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."tenantId", 0));

  IF NEW."auxBarcode" IS NOT NULL AND NEW."barcode" = NEW."auxBarcode" THEN
    RAISE EXCEPTION 'PRODUCT_UNIT_BARCODE_COLLISION'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Product" p
    WHERE p."tenantId" = NEW."tenantId"
      AND p."id" <> NEW."id"
      AND (
        p."barcode" = NEW."barcode" OR
        p."auxBarcode" = NEW."barcode" OR
        (NEW."auxBarcode" IS NOT NULL AND p."barcode" = NEW."auxBarcode") OR
        (NEW."auxBarcode" IS NOT NULL AND p."auxBarcode" = NEW."auxBarcode")
      )
  ) THEN
    RAISE EXCEPTION 'PRODUCT_UNIT_BARCODE_COLLISION'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Product_unit_barcode_uniqueness"
BEFORE INSERT OR UPDATE OF "tenantId", "barcode", "auxBarcode"
ON "Product"
FOR EACH ROW
EXECUTE FUNCTION "enforce_product_unit_barcode_uniqueness"();
