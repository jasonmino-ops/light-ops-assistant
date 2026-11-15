BEGIN;

-- CreateEnum
CREATE TYPE "NativeInventoryMovementType" AS ENUM ('RECEIPT', 'ADJUSTMENT', 'SALE', 'REFUND', 'SALE_CANCEL', 'REFUND_CANCEL', 'CUSTOMER_SALE', 'CUSTOMER_SALE_CANCEL');

-- CreateTable
CREATE TABLE "NativeInventoryStore" (
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "enabledAt" TIMESTAMPTZ(3),
    "currencyCode" TEXT NOT NULL,

    CONSTRAINT "NativeInventoryStore_pkey" PRIMARY KEY ("tenantId","storeId")
);

-- CreateTable
CREATE TABLE "NativeInventoryReceiver" (
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "NativeInventoryReceiver_pkey" PRIMARY KEY ("tenantId","storeId","userId")
);

-- CreateTable
CREATE TABLE "NativeInventoryItem" (
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "productTenantId" TEXT,
    "materialName" TEXT,
    "productName" TEXT,
    "baseUnitName" TEXT NOT NULL,
    "lowStockAt" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "onHand" DECIMAL(320,6) NOT NULL DEFAULT 0,
    "averageUnitCost" DECIMAL(24,10),

    CONSTRAINT "NativeInventoryItem_pkey" PRIMARY KEY ("tenantId","storeId","id")
);

-- CreateTable
CREATE TABLE "NativeInventoryUnit" (
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "barcode" TEXT,
    "factor" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "NativeInventoryUnit_pkey" PRIMARY KEY ("tenantId","storeId","id")
);

-- CreateTable
CREATE TABLE "NativeInventorySupplier" (
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,

    CONSTRAINT "NativeInventorySupplier_pkey" PRIMARY KEY ("tenantId","storeId","id")
);

-- CreateTable
CREATE TABLE "NativeInventoryReceipt" (
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "lastDraftRequestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMPTZ(3),
    "postedBy" TEXT,
    "total" DECIMAL(26,2) NOT NULL,
    "currencyCode" TEXT NOT NULL,

    CONSTRAINT "NativeInventoryReceipt_pkey" PRIMARY KEY ("tenantId","storeId","id")
);

-- CreateTable
CREATE TABLE "NativeInventoryReceiptLine" (
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unitName" TEXT NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "baseQty" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "amount" DECIMAL(24,2) NOT NULL,

    CONSTRAINT "NativeInventoryReceiptLine_pkey" PRIMARY KEY ("tenantId","storeId","receiptId","lineNo")
);

-- CreateTable
CREATE TABLE "NativeInventoryMovement" (
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "type" "NativeInventoryMovementType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(320,6) NOT NULL,
    "balance" DECIMAL(320,6) NOT NULL,
    "unitCost" DECIMAL(24,10),
    "valuationUnitCost" DECIMAL(24,10),
    "revenue" DECIMAL(12,2),
    "actorId" TEXT,
    "reason" TEXT,
    "originalId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NativeInventoryMovement_pkey" PRIMARY KEY ("tenantId","storeId","type","sourceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "NativeInventoryStore_storeId_tenantId_key" ON "NativeInventoryStore"("storeId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "NativeInventoryItem_tenantId_storeId_productId_key" ON "NativeInventoryItem"("tenantId", "storeId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "NativeInventoryUnit_tenantId_storeId_itemId_name_key" ON "NativeInventoryUnit"("tenantId", "storeId", "itemId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "NativeInventoryUnit_tenantId_storeId_barcode_key" ON "NativeInventoryUnit"("tenantId", "storeId", "barcode");

-- CreateIndex
CREATE INDEX "NativeInventoryReceipt_tenantId_storeId_supplierId_postedAt_idx" ON "NativeInventoryReceipt"("tenantId", "storeId", "supplierId", "postedAt");

-- CreateIndex
CREATE INDEX "NativeInventoryReceipt_tenantId_storeId_createdAt_id_idx" ON "NativeInventoryReceipt"("tenantId", "storeId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "NativeInventoryReceiptLine_tenantId_storeId_itemId_idx" ON "NativeInventoryReceiptLine"("tenantId", "storeId", "itemId");

-- CreateIndex
CREATE INDEX "NativeInventoryMovement_tenantId_storeId_itemId_createdAt_idx" ON "NativeInventoryMovement"("tenantId", "storeId", "itemId", "createdAt");

-- CreateIndex
CREATE INDEX "NativeInventoryMovement_tenantId_storeId_originalId_idx" ON "NativeInventoryMovement"("tenantId", "storeId", "originalId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_tenantId_key" ON "Product"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "NativeInventoryStore" ADD CONSTRAINT "NativeInventoryStore_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "Store"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeInventoryReceiver" ADD CONSTRAINT "NativeInventoryReceiver_tenantId_storeId_fkey" FOREIGN KEY ("tenantId", "storeId") REFERENCES "NativeInventoryStore"("tenantId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeInventoryItem" ADD CONSTRAINT "NativeInventoryItem_tenantId_storeId_fkey" FOREIGN KEY ("tenantId", "storeId") REFERENCES "NativeInventoryStore"("tenantId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeInventoryItem" ADD CONSTRAINT "NativeInventoryItem_productId_productTenantId_fkey" FOREIGN KEY ("productId", "productTenantId") REFERENCES "Product"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeInventoryUnit" ADD CONSTRAINT "NativeInventoryUnit_tenantId_storeId_itemId_fkey" FOREIGN KEY ("tenantId", "storeId", "itemId") REFERENCES "NativeInventoryItem"("tenantId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeInventorySupplier" ADD CONSTRAINT "NativeInventorySupplier_tenantId_storeId_fkey" FOREIGN KEY ("tenantId", "storeId") REFERENCES "NativeInventoryStore"("tenantId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeInventoryReceipt" ADD CONSTRAINT "NativeInventoryReceipt_tenantId_storeId_supplierId_fkey" FOREIGN KEY ("tenantId", "storeId", "supplierId") REFERENCES "NativeInventorySupplier"("tenantId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeInventoryReceiptLine" ADD CONSTRAINT "NativeInventoryReceiptLine_tenantId_storeId_receiptId_fkey" FOREIGN KEY ("tenantId", "storeId", "receiptId") REFERENCES "NativeInventoryReceipt"("tenantId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeInventoryReceiptLine" ADD CONSTRAINT "NativeInventoryReceiptLine_tenantId_storeId_itemId_fkey" FOREIGN KEY ("tenantId", "storeId", "itemId") REFERENCES "NativeInventoryItem"("tenantId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeInventoryMovement" ADD CONSTRAINT "NativeInventoryMovement_tenantId_storeId_itemId_fkey" FOREIGN KEY ("tenantId", "storeId", "itemId") REFERENCES "NativeInventoryItem"("tenantId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NativeInventoryItem"
  ADD CHECK (("productName" IS NULL) <> ("materialName" IS NULL)),
  ADD CHECK (("productId" IS NULL) = ("productTenantId" IS NULL)),
  ADD CHECK ("productId" IS NULL OR ("productName" IS NOT NULL AND "productTenantId" = "tenantId")),
  ADD CHECK ("lowStockAt" >= 0 AND "averageUnitCost" >= 0);
ALTER TABLE "NativeInventoryUnit" ADD CHECK ("factor" > 0);
ALTER TABLE "NativeInventoryReceipt"
  ADD CHECK (("postedAt" IS NULL) = ("postedBy" IS NULL)),
  ADD CHECK ("revision" > 0 AND "total" >= 0);
ALTER TABLE "NativeInventoryReceiptLine"
  ADD CHECK ("factor" > 0 AND "quantity" > 0 AND "baseQty" > 0 AND "unitPrice" >= 0 AND "amount" >= 0);

-- The application connects directly through Prisma. These relations are private
-- to server-side code even on Supabase projects with public schema auto-grants.
DO $$
DECLARE
  table_name text;
  api_role text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'NativeInventoryStore', 'NativeInventoryReceiver', 'NativeInventoryItem', 'NativeInventoryUnit',
    'NativeInventorySupplier', 'NativeInventoryReceipt', 'NativeInventoryReceiptLine', 'NativeInventoryMovement'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    FOR api_role IN SELECT rolname FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'service_role')
    LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, api_role);
    END LOOP;
  END LOOP;
END;
$$;

-- Callers that write inventory serialize on the NativeInventoryStore row.
-- Source keys identify receipt lines, adjustment requests and sale transitions.
CREATE FUNCTION public.native_inventory_move(
  tenant_id text, store_id text, item_id text, source_id text,
  movement_type public."NativeInventoryMovementType",
  delta numeric, incoming_unit_cost numeric, snapshot_unit_cost numeric,
  revenue_amount numeric, actor_id text, explanation text, original_id text
) RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  item public."NativeInventoryItem"%ROWTYPE;
  remaining numeric;
  next_cost numeric;
BEGIN
  SELECT * INTO STRICT item FROM public."NativeInventoryItem"
    WHERE "tenantId" = tenant_id AND "storeId" = store_id AND "id" = item_id
    FOR UPDATE;

  INSERT INTO public."NativeInventoryMovement" (
    "tenantId", "storeId", "itemId", "sourceId", "type", "quantity", "balance",
    "unitCost", "valuationUnitCost", "revenue", "actorId", "reason", "originalId"
  ) VALUES (
    tenant_id, store_id, item_id, source_id, movement_type, delta, item."onHand" + delta,
    snapshot_unit_cost, incoming_unit_cost, revenue_amount, actor_id, explanation, original_id
  ) ON CONFLICT ("tenantId", "storeId", "type", "sourceId") DO NOTHING;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  next_cost := item."averageUnitCost";
  remaining := item."onHand" + delta;
  -- Keep the last valuation while stock is exhausted. It can restore an
  -- immediately reversed sale and never prices a new issue from a deficit.
  IF remaining > 0 AND delta > 0 THEN
    IF item."onHand" <= 0 THEN
      next_cost := incoming_unit_cost;
    ELSE
      next_cost := (item."onHand" * item."averageUnitCost" + delta * incoming_unit_cost) / remaining;
    END IF;
  ELSIF remaining > 0 AND movement_type = 'REFUND_CANCEL' THEN
    next_cost := (item."onHand" * item."averageUnitCost" + delta * incoming_unit_cost) / remaining;
    IF next_cost < 0 THEN
      next_cost := NULL;
    END IF;
  END IF;

  UPDATE public."NativeInventoryItem" SET "onHand" = remaining, "averageUnitCost" = next_cost
    WHERE "tenantId" = tenant_id AND "storeId" = store_id AND "id" = item_id;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.native_inventory_move(
  text, text, text, text, public."NativeInventoryMovementType",
  numeric, numeric, numeric, numeric, text, text, text
) FROM PUBLIC;

CREATE FUNCTION public.native_inventory_post_receipt(
  tenant_id text, store_id text, receipt_id text, actor_id text
) RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  receipt_line public."NativeInventoryReceiptLine"%ROWTYPE;
  posted integer := 0;
BEGIN
  FOR receipt_line IN SELECT * FROM public."NativeInventoryReceiptLine"
    WHERE "tenantId" = tenant_id AND "storeId" = store_id AND "receiptId" = receipt_id
    ORDER BY "lineNo"
  LOOP
    IF public.native_inventory_move(
      tenant_id, store_id, receipt_line."itemId", receipt_id || ':' || receipt_line."lineNo", 'RECEIPT',
      receipt_line."baseQty", receipt_line."amount" / receipt_line."baseQty",
      receipt_line."amount" / receipt_line."baseQty", NULL, actor_id, NULL, NULL
    ) THEN
      posted := posted + 1;
    END IF;
  END LOOP;
  RETURN posted;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.native_inventory_post_receipt(text, text, text, text) FROM PUBLIC;

CREATE FUNCTION public.native_inventory_complete_sale(sale public."SaleRecord") RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  item public."NativeInventoryItem"%ROWTYPE;
  snapshot_cost numeric;
  currency_matches boolean;
  booked boolean;
  prior_refund record;
BEGIN
  SELECT n."currencyCode" = s."currencyCode" INTO currency_matches
    FROM public."NativeInventoryStore" n JOIN public."Store" s ON s."id" = n."storeId" AND s."tenantId" = n."tenantId"
    WHERE n."tenantId" = sale."tenantId" AND n."storeId" = sale."storeId"
      AND n."enabledAt" IS NOT NULL FOR UPDATE OF n;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO item FROM public."NativeInventoryItem"
    WHERE "tenantId" = sale."tenantId" AND "storeId" = sale."storeId" AND "productId" = sale."productId";
  IF NOT FOUND OR sale."quantity" <= 0 THEN
    RETURN;
  END IF;
  -- SaleRecord.quantity is already the base quantity for MAIN and AUX.
  IF currency_matches AND item."onHand" >= sale."quantity" THEN
    snapshot_cost := item."averageUnitCost";
  END IF;
  booked := public.native_inventory_move(
    sale."tenantId", sale."storeId", item."id", sale."id", 'SALE', -sale."quantity",
    item."averageUnitCost", snapshot_cost, CASE WHEN currency_matches THEN sale."lineAmount" END, sale."operatorUserId",
    CASE WHEN NOT currency_matches THEN 'CURRENCY_MISMATCH' END, NULL
  );
  IF NOT booked THEN
    RETURN;
  END IF;

  -- Some legacy paths can complete a refund while the original KHQR intent
  -- is still pending. Fold those refunds in when the sale becomes paid.
  FOR prior_refund IN
    SELECT r.*, ns."currencyCode" = rs."currencyCode" AS currency_matches
    FROM public."SaleRecord" r
    JOIN public."Store" rs ON rs."id" = r."storeId" AND rs."tenantId" = r."tenantId"
    JOIN public."NativeInventoryStore" ns ON ns."tenantId" = sale."tenantId" AND ns."storeId" = sale."storeId"
    WHERE r."originalSaleRecordId" = sale."id" AND r."tenantId" = sale."tenantId"
      AND r."saleType" = 'REFUND' AND r."status" = 'COMPLETED'
    ORDER BY r."createdAt", r."id"
  LOOP
    PERFORM public.native_inventory_move(
      sale."tenantId", sale."storeId", item."id", prior_refund."id", 'REFUND', abs(prior_refund."quantity"),
      item."averageUnitCost", snapshot_cost,
      CASE WHEN currency_matches AND prior_refund.currency_matches THEN prior_refund."lineAmount" END,
      prior_refund."operatorUserId",
      CASE WHEN NOT currency_matches OR NOT prior_refund.currency_matches THEN 'CURRENCY_MISMATCH' END,
      sale."id"
    );
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.native_inventory_complete_sale(public."SaleRecord") FROM PUBLIC;

CREATE FUNCTION public.native_inventory_on_payment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  sale public."SaleRecord"%ROWTYPE;
BEGIN
  IF OLD."status" <> 'PENDING' OR NEW."status" <> 'PAID' OR NOT EXISTS (
    SELECT 1 FROM public."PaymentIntent" WHERE "id" = NEW."id" AND "status" = 'PAID'
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."NativeInventoryStore" WHERE "tenantId" = NEW."tenantId"
      AND "storeId" = NEW."storeId" AND "enabledAt" IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  FOR sale IN SELECT * FROM public."SaleRecord"
    WHERE "tenantId" = NEW."tenantId" AND "storeId" = NEW."storeId"
      AND "orderNo" = NEW."orderNo" AND "saleType" = 'SALE' AND "status" = 'COMPLETED'
    ORDER BY "id"
  LOOP
    PERFORM public.native_inventory_complete_sale(sale);
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.native_inventory_on_payment() FROM PUBLIC;

CREATE FUNCTION public.native_inventory_on_sale() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  inventory_store text := NEW."storeId";
  currency_matches boolean;
  original_sale public."NativeInventoryMovement"%ROWTYPE;
  previous public."NativeInventoryMovement"%ROWTYPE;
  item public."NativeInventoryItem"%ROWTYPE;
  movement_type public."NativeInventoryMovementType";
  delta numeric;
  revenue_amount numeric;
  snapshot_cost numeric;
  valuation_cost numeric;
  already_returned numeric;
  refunded_revenue numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."status" = NEW."status" THEN
    RETURN NEW;
  END IF;
  IF NEW."status" <> 'COMPLETED' AND (
    TG_OP = 'INSERT' OR NEW."status" <> 'CANCELLED' OR OLD."status" <> 'COMPLETED'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW."saleType" = 'REFUND' THEN
    -- Use the store that actually dispatched stock. The refund may be issued
    -- by another store in the same tenant under the existing POS rules.
    SELECT "storeId" INTO inventory_store FROM public."SaleRecord"
      WHERE "id" = NEW."originalSaleRecordId" AND "tenantId" = NEW."tenantId";
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT n."currencyCode" = s."currencyCode" INTO currency_matches
    FROM public."NativeInventoryStore" n JOIN public."Store" s
      ON s."id" = NEW."storeId" AND s."tenantId" = n."tenantId"
    WHERE n."tenantId" = NEW."tenantId" AND n."storeId" = inventory_store
      AND (n."enabledAt" IS NOT NULL OR NEW."saleType" = 'REFUND' OR NEW."status" = 'CANCELLED')
    FOR UPDATE OF n;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW."saleType" = 'SALE' AND NEW."status" = 'COMPLETED' THEN
    -- Cashier may write COMPLETED before it creates a PENDING KHQR intent.
    -- The deferred trigger sees the full checkout transaction.
    IF EXISTS (
      SELECT 1 FROM public."PaymentIntent"
      WHERE "orderNo" = NEW."orderNo" AND "tenantId" = NEW."tenantId" AND "storeId" = NEW."storeId"
        AND "status" <> 'PAID'
    ) THEN
      RETURN NEW;
    END IF;
    PERFORM public.native_inventory_complete_sale(NEW);
    RETURN NEW;
  END IF;

  SELECT * INTO original_sale FROM public."NativeInventoryMovement"
    WHERE "tenantId" = NEW."tenantId" AND "storeId" = inventory_store
      AND "type" = 'SALE' AND "sourceId" = COALESCE(NEW."originalSaleRecordId", NEW."id");
  -- A sale completed before inventory activation has no native stock to return.
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public."NativeInventoryMovement"
    WHERE "tenantId" = NEW."tenantId" AND "storeId" = inventory_store
      AND "type" = 'SALE_CANCEL' AND "sourceId" = original_sale."sourceId"
  ) THEN
    RETURN NEW;
  END IF;
  item."id" := original_sale."itemId";
  snapshot_cost := original_sale."unitCost";
  valuation_cost := original_sale."valuationUnitCost";

  IF NEW."saleType" = 'REFUND' AND NEW."status" = 'COMPLETED' THEN
    movement_type := 'REFUND';
    delta := abs(NEW."quantity");
    revenue_amount := CASE WHEN currency_matches AND original_sale."revenue" IS NOT NULL THEN NEW."lineAmount" END;
  ELSIF NEW."saleType" = 'REFUND' THEN
    SELECT * INTO previous FROM public."NativeInventoryMovement"
      WHERE "tenantId" = NEW."tenantId" AND "storeId" = inventory_store
        AND "type" = 'REFUND' AND "sourceId" = NEW."id";
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
    movement_type := 'REFUND_CANCEL';
    valuation_cost := previous."valuationUnitCost";
    delta := -previous."quantity";
    revenue_amount := -previous."revenue";
  ELSE
    SELECT COALESCE(sum("quantity"), 0), COALESCE(sum("revenue"), 0)
      INTO already_returned, refunded_revenue FROM public."NativeInventoryMovement"
      WHERE "tenantId" = NEW."tenantId" AND "storeId" = inventory_store
        AND "originalId" = original_sale."sourceId" AND "type" IN ('REFUND', 'REFUND_CANCEL');
    movement_type := 'SALE_CANCEL';
    delta := -original_sale."quantity" - already_returned;
    revenue_amount := -original_sale."revenue" - refunded_revenue;
  END IF;

  PERFORM public.native_inventory_move(
    NEW."tenantId", inventory_store, item."id", NEW."id", movement_type, delta,
    valuation_cost, snapshot_cost, revenue_amount, NEW."operatorUserId",
    CASE WHEN NOT currency_matches OR original_sale."revenue" IS NULL THEN 'CURRENCY_MISMATCH' END,
    original_sale."sourceId"
  );
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.native_inventory_on_sale() FROM PUBLIC;

CREATE FUNCTION public.native_inventory_on_customer_sale() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  completed boolean := NEW."status" = 'COMPLETED' AND NEW."paymentStatus" = 'PAID';
  line record;
  original public."NativeInventoryMovement"%ROWTYPE;
  item public."NativeInventoryItem"%ROWTYPE;
  payload jsonb;
  snapshot_cost numeric;
  currency_matches boolean;
  recognized numeric := 0;
  cumulative numeric := 0;
  allocated numeric := 0;
  next_allocated numeric;
  revenue_amount numeric;
  payment_currency text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF completed = (OLD."status" = 'COMPLETED' AND OLD."paymentStatus" = 'PAID') THEN
      RETURN NEW;
    END IF;
  ELSIF NOT completed THEN
    RETURN NEW;
  END IF;

  SELECT n."currencyCode" = s."currencyCode" INTO currency_matches
    FROM public."NativeInventoryStore" n JOIN public."Store" s ON s."id" = n."storeId" AND s."tenantId" = n."tenantId"
    WHERE n."tenantId" = NEW."tenantId" AND n."storeId" = NEW."storeId"
      AND (n."enabledAt" IS NOT NULL OR NOT completed) FOR UPDATE OF n;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NOT completed THEN
    FOR original IN SELECT * FROM public."NativeInventoryMovement"
      WHERE "tenantId" = NEW."tenantId" AND "storeId" = NEW."storeId" AND "originalId" = NEW."id"
        AND "type" = 'CUSTOMER_SALE'
      ORDER BY substring("sourceId" from '[0-9]+$')::numeric DESC
    LOOP
      PERFORM public.native_inventory_move(
        NEW."tenantId", NEW."storeId", original."itemId", original."sourceId", 'CUSTOMER_SALE_CANCEL',
        -original."quantity", original."valuationUnitCost", original."unitCost", -original."revenue",
        NEW."authorizedByUserId", original."reason", NEW."id"
      );
    END LOOP;
    RETURN NEW;
  END IF;

  IF NEW."paymentMethod" = 'SHINHAN' THEN
    SELECT t."currency" INTO payment_currency FROM public."PaymentTransaction" t
      WHERE t."customerOrderId" = NEW."id" AND t."tenantId" = NEW."tenantId"
        AND t."storeId" = NEW."storeId" AND t."provider" = 'SHINHAN' AND t."status" = 'PAID'
      ORDER BY t."paidAt" DESC NULLS LAST, t."id" DESC LIMIT 1;
    SELECT COALESCE(n."currencyCode" = payment_currency, false) INTO currency_matches
      FROM public."NativeInventoryStore" n WHERE n."tenantId" = NEW."tenantId" AND n."storeId" = NEW."storeId";
  END IF;

  BEGIN
    payload := NEW."itemsJson"::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE WARNING 'Native inventory: invalid customer order lines';
    RETURN NEW;
  END;
  IF jsonb_typeof(payload) <> 'array' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload) AS lines(value)
    WHERE jsonb_typeof(value->'productId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(value->'quantity') IS DISTINCT FROM 'number'
      OR jsonb_typeof(value->'lineAmount') IS DISTINCT FROM 'number'
  ) THEN
    RAISE WARNING 'Native inventory: invalid customer order line format';
    RETURN NEW;
  END IF;
  SELECT COALESCE(sum((value->>'lineAmount')::numeric), 0) INTO recognized
    FROM jsonb_array_elements(payload) AS lines(value);
  -- Allocate the actual order total including the coupon across all lines, so
  -- reported revenue reconciles to the paid order even when some items are untracked.
  FOR line IN SELECT value->>'productId' AS product_id, (value->>'quantity')::numeric AS quantity,
      (value->>'lineAmount')::numeric AS amount, ordinal
    FROM jsonb_array_elements(payload) WITH ORDINALITY AS lines(value, ordinal)
    ORDER BY ordinal
  LOOP
    cumulative := cumulative + line.amount;
    next_allocated := CASE WHEN recognized > 0 THEN round(COALESCE(NEW."paidAmount", NEW."totalAmount") * cumulative / recognized, 2) ELSE 0 END;
    revenue_amount := next_allocated - allocated;
    allocated := next_allocated;
    SELECT * INTO item FROM public."NativeInventoryItem"
      WHERE "tenantId" = NEW."tenantId" AND "storeId" = NEW."storeId" AND "productId" = line.product_id;
    IF NOT FOUND OR line.quantity <= 0 OR line.quantity >= 1e314 OR scale(trim_scale(line.quantity)) > 6 THEN
      CONTINUE;
    END IF;
    snapshot_cost := CASE WHEN currency_matches AND item."onHand" >= line.quantity THEN item."averageUnitCost" END;
    PERFORM public.native_inventory_move(
      NEW."tenantId", NEW."storeId", item."id", NEW."id" || ':' || line.ordinal,
      'CUSTOMER_SALE', -line.quantity, item."averageUnitCost", snapshot_cost, CASE WHEN currency_matches THEN revenue_amount END,
      NEW."authorizedByUserId", CASE WHEN NOT currency_matches THEN 'CURRENCY_MISMATCH' END, NEW."id"
    );
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.native_inventory_on_customer_sale() FROM PUBLIC;

-- Supabase may grant explicit EXECUTE in addition to PostgreSQL's PUBLIC grant.
DO $$
DECLARE
  api_role text;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.native_inventory_on_sale() FROM %I', api_role);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.native_inventory_on_payment() FROM %I', api_role);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.native_inventory_on_customer_sale() FROM %I', api_role);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.native_inventory_complete_sale(public."SaleRecord") FROM %I', api_role);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.native_inventory_post_receipt(text,text,text,text) FROM %I', api_role);
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.native_inventory_move(text,text,text,text,public."NativeInventoryMovementType",numeric,numeric,numeric,numeric,text,text,text) FROM %I',
      api_role
    );
  END LOOP;
END;
$$;

CREATE CONSTRAINT TRIGGER native_inventory_sale
AFTER INSERT OR UPDATE OF "status" ON public."SaleRecord"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.native_inventory_on_sale();

CREATE CONSTRAINT TRIGGER native_inventory_payment
AFTER UPDATE OF "status" ON public."PaymentIntent"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.native_inventory_on_payment();

CREATE CONSTRAINT TRIGGER native_inventory_customer_sale
AFTER INSERT OR UPDATE OF "status", "paymentStatus" ON public."CustomerOrder"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.native_inventory_on_customer_sale();

COMMIT;
