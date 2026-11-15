BEGIN;

-- The server records the currency it actually used to price and collect the
-- order. Inbound sync and historic orders lacking evidence stay unvalued.
CREATE SCHEMA native_inventory;
REVOKE ALL ON SCHEMA native_inventory FROM PUBLIC;

CREATE TABLE native_inventory.order_currency (
  tenant_id text NOT NULL,
  store_id text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('POS', 'POS_PAYMENT', 'H5', 'H5_PAYMENT')),
  source_id text NOT NULL,
  currency_code text NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  PRIMARY KEY (tenant_id, store_id, source_kind, source_id),
  FOREIGN KEY (store_id, tenant_id) REFERENCES public."Store"("id", "tenantId") ON DELETE CASCADE
);
ALTER TABLE native_inventory.order_currency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE native_inventory.order_currency FROM PUBLIC;

CREATE FUNCTION native_inventory.capture_order_currency() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  context jsonb := nullif(current_setting('eshop.inventory_order_currency', true), '')::jsonb;
  kind text := TG_ARGV[0];
  source_id text;
  inventory_store_id text := NEW."storeId";
  currency text;
BEGIN
  IF context IS NULL OR context->>'tenantId' IS DISTINCT FROM NEW."tenantId"
      OR context->>'storeId' IS DISTINCT FROM NEW."storeId" THEN
    RETURN NEW;
  END IF;
  IF kind = 'PAYMENT' THEN
    IF context->>'kind' = 'H5_PAYMENT' AND NEW."transactionActorType" = 'H5_CUSTOMER_ORDER' THEN
      kind := 'H5_PAYMENT';
      source_id := NEW."transactionActorId";
      currency := context->>'currencyCode';
    ELSIF context->>'kind' IN ('POS', 'POS_PAYMENT') THEN
      kind := 'POS_PAYMENT';
      source_id := NEW.id;
      currency := CASE WHEN context->>'kind' = 'POS'
        THEN context->>'paymentCurrencyCode' ELSE context->>'currencyCode' END;
    END IF;
  ELSIF kind = context->>'kind' THEN
    IF kind = 'POS' THEN
      IF NEW."source" = 'CASHIER_OFFLINE' OR NEW."offlineOrderId" IS NOT NULL THEN
        RETURN NEW;
      END IF;
      IF NEW."saleType" = 'REFUND' THEN
        SELECT "storeId" INTO inventory_store_id FROM public."SaleRecord"
        WHERE id = NEW."originalSaleRecordId" AND "tenantId" = NEW."tenantId";
      END IF;
    END IF;
    source_id := NEW.id;
    currency := context->>'currencyCode';
  END IF;
  IF source_id IS NULL OR currency IS NULL OR currency !~ '^[A-Z]{3}$' OR NOT EXISTS (
    SELECT 1 FROM public."NativeInventoryStore" n
    WHERE n."tenantId" = NEW."tenantId" AND n."storeId" = inventory_store_id AND n."enabledAt" IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  INSERT INTO native_inventory.order_currency (tenant_id, store_id, source_kind, source_id, currency_code)
  VALUES (NEW."tenantId", NEW."storeId", kind, source_id, currency)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION native_inventory.capture_order_currency() FROM PUBLIC;

CREATE TRIGGER native_inventory_capture_pos_currency
AFTER INSERT ON public."SaleRecord"
FOR EACH ROW EXECUTE FUNCTION native_inventory.capture_order_currency('POS');

CREATE TRIGGER native_inventory_capture_h5_currency
AFTER INSERT ON public."CustomerOrder"
FOR EACH ROW EXECUTE FUNCTION native_inventory.capture_order_currency('H5');

CREATE TRIGGER native_inventory_capture_payment_currency
AFTER INSERT ON public."PaymentIntent"
FOR EACH ROW EXECUTE FUNCTION native_inventory.capture_order_currency('PAYMENT');

CREATE OR REPLACE FUNCTION public.native_inventory_complete_sale(sale public."SaleRecord") RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  item public."NativeInventoryItem"%ROWTYPE;
  snapshot_cost numeric;
  currency_matches boolean;
  booked boolean;
  prior_refund record;
BEGIN
  SELECT coalesce(n."currencyCode" = c.currency_code AND c.currency_code = pc.currency_code, false) INTO currency_matches
    FROM public."NativeInventoryStore" n
    LEFT JOIN native_inventory.order_currency c ON c.tenant_id = n."tenantId"
      AND c.store_id = n."storeId" AND c.source_kind = 'POS' AND c.source_id = sale."id"
    LEFT JOIN public."PaymentIntent" pi ON pi."tenantId" = n."tenantId"
      AND pi."storeId" = n."storeId" AND pi."orderNo" = sale."orderNo" AND pi.status = 'PAID'
    LEFT JOIN native_inventory.order_currency pc ON pc.tenant_id = n."tenantId"
      AND pc.store_id = n."storeId" AND pc.source_kind = 'POS_PAYMENT' AND pc.source_id = pi.id
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
    SELECT r.*, coalesce(ns."currencyCode" = rc.currency_code, false) AS currency_matches
    FROM public."SaleRecord" r
    LEFT JOIN native_inventory.order_currency rc ON rc.tenant_id = r."tenantId"
      AND rc.store_id = r."storeId" AND rc.source_kind = 'POS' AND rc.source_id = r."id"
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

CREATE OR REPLACE FUNCTION public.native_inventory_on_sale() RETURNS trigger
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

  SELECT coalesce(n."currencyCode" = c.currency_code, false) INTO currency_matches
    FROM public."NativeInventoryStore" n
    LEFT JOIN native_inventory.order_currency c ON c.tenant_id = NEW."tenantId"
      AND c.store_id = NEW."storeId" AND c.source_kind = 'POS' AND c.source_id = NEW."id"
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
    CASE WHEN (movement_type = 'REFUND' AND NOT currency_matches) OR revenue_amount IS NULL
      THEN 'CURRENCY_MISMATCH' END,
    original_sale."sourceId"
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.native_inventory_on_customer_sale() RETURNS trigger
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
  source_currency text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF completed = (OLD."status" = 'COMPLETED' AND OLD."paymentStatus" = 'PAID') THEN
      RETURN NEW;
    END IF;
  ELSIF NOT completed THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(n."currencyCode" = c.currency_code AND c.currency_code = pc.currency_code, false), c.currency_code
    INTO currency_matches, source_currency
    FROM public."NativeInventoryStore" n
    LEFT JOIN native_inventory.order_currency c ON c.tenant_id = n."tenantId"
      AND c.store_id = n."storeId" AND c.source_kind = 'H5' AND c.source_id = NEW."id"
    LEFT JOIN native_inventory.order_currency pc ON pc.tenant_id = n."tenantId"
      AND pc.store_id = n."storeId" AND pc.source_kind = 'H5_PAYMENT' AND pc.source_id = NEW."id"
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
    -- The provider writes the same paidAt and amount to both records in one
    -- transaction. An ambiguous or unmatched attempt cannot value inventory.
    SELECT CASE WHEN count(*) = 1 THEN min(t."currency") END INTO payment_currency
      FROM public."PaymentTransaction" t
      WHERE t."customerOrderId" = NEW."id" AND t."tenantId" = NEW."tenantId"
        AND t."storeId" = NEW."storeId" AND t."provider" = 'SHINHAN' AND t."status" = 'PAID'
        AND t."paidAt" = NEW."paidAt" AND t."amount" = NEW."paidAmount";
    SELECT COALESCE(n."currencyCode" = payment_currency AND source_currency = payment_currency, false) INTO currency_matches
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

COMMIT;
