BEGIN;

CREATE TYPE "CustomerOrderFulfillmentPurpose" AS ENUM ('KITCHEN_MAKE', 'FRONT_UNPAID', 'FRONT_PAID');
ALTER TABLE "CustomerOrderFulfillmentIntent" ADD COLUMN "purpose" "CustomerOrderFulfillmentPurpose";

-- Historical FRONT was exclusively a paid receipt. Never relabel it UNPAID.
UPDATE "CustomerOrderFulfillmentIntent"
SET "purpose" = CASE "role"
  WHEN 'KITCHEN' THEN 'KITCHEN_MAKE'::"CustomerOrderFulfillmentPurpose"
  WHEN 'FRONT' THEN 'FRONT_PAID'::"CustomerOrderFulfillmentPurpose"
END;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "CustomerOrderFulfillmentIntent" WHERE "purpose" IS NULL) THEN
    RAISE EXCEPTION 'H5 fulfillment purpose backfill incomplete';
  END IF;
END $$;

ALTER TABLE "CustomerOrderFulfillmentIntent" ALTER COLUMN "purpose" SET NOT NULL;
-- No default: every new producer must make the purpose decision explicitly.
ALTER TABLE "CustomerOrderFulfillmentIntent"
  ADD CONSTRAINT "CustomerOrderFulfillmentIntent_role_purpose_check" CHECK (
    ("purpose" = 'KITCHEN_MAKE' AND "role" = 'KITCHEN') OR
    ("purpose" IN ('FRONT_UNPAID', 'FRONT_PAID') AND "role" = 'FRONT')
  );
CREATE UNIQUE INDEX "CustomerOrderFulfillmentIntent_scope_purpose_key"
  ON "CustomerOrderFulfillmentIntent" ("tenantId", "storeId", "orderNo", "purpose");
DROP INDEX "CustomerOrderFulfillmentIntent_scope_role_key";

COMMIT;
