BEGIN;

-- The runtime needs to claim and complete a request, never remove its evidence.
REVOKE ALL ON public."CashierSaleIdempotency" FROM PUBLIC, anon, authenticated, service_role, eshop_app_runtime;
GRANT SELECT, INSERT, UPDATE (status, "resultSnapshot", "updatedAt")
ON public."CashierSaleIdempotency" TO eshop_app_runtime;
ALTER TABLE public."CashierSaleIdempotency" ENABLE ROW LEVEL SECURITY;
CREATE POLICY diamond_pos_request_runtime ON public."CashierSaleIdempotency"
  TO eshop_app_runtime USING (true) WITH CHECK (true);

-- Record the audited feed retirement in the immutable pilot binding at cutover.
-- This migration leaves the binding and every store's switch unchanged.
ALTER TABLE native_inventory.sales_pilot ADD COLUMN sheets_retired_at timestamptz;
ALTER TABLE native_inventory.sales_pilot DROP CONSTRAINT sales_pilot_check;
ALTER TABLE native_inventory.sales_pilot ADD CONSTRAINT native_sales_legacy_feed_exclusion
  CHECK (pilot_store_id <> sheets_store_id OR sheets_retired_at IS NOT NULL);

CREATE OR REPLACE FUNCTION native_inventory.validate_sales_pilot() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'The pilot and Sheets store binding is immutable';
  END IF;
  -- The existing, deployed Sheets feed is independently pinned to this store
  -- code. The cutover must verify its configured store ID against this row.
  IF NOT EXISTS (SELECT 1 FROM public."Store" WHERE id = NEW.sheets_store_id AND code = 'ST883DC00C' AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Sheets store binding does not match the active legacy pilot';
  END IF;
  IF (NEW.pilot_store_id = NEW.sheets_store_id) IS DISTINCT FROM (NEW.sheets_retired_at IS NOT NULL)
     OR NEW.sheets_retired_at > clock_timestamp() THEN
    RAISE EXCEPTION 'Diamond requires a verified legacy Feed retirement';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION native_inventory.set_sales_epoch() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."salesEnabledAt" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."enabledAt" IS NULL OR NOT EXISTS (
    SELECT 1 FROM native_inventory.sales_pilot p
    WHERE p.pilot_store_id = NEW."storeId" AND (p.sheets_store_id <> NEW."storeId" OR p.sheets_retired_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Native sales require an enabled inventory and the approved non-Sheets pilot';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."salesEnabledAt" IS NOT NULL THEN
    NEW."salesEnabledAt" := OLD."salesEnabledAt";
    RETURN NEW;
  END IF;

  -- The writer requests activation with a nonnull value. Only the database
  -- chooses the boundary. Round forward so transactions that started before
  -- the update cannot enter this activation epoch.
  NEW."salesEnabledAt" := date_trunc('milliseconds', clock_timestamp()) + interval '1 millisecond';
  RETURN NEW;
END;
$$;

-- Both callers hold the inventory store lock. Verify admission before creating
-- an item so historical, paused and offline sales cannot leave empty accounts.
CREATE FUNCTION native_inventory.sale_item(p_tenant text, p_store text, p_product text, p_kind text, p_source text)
RETURNS public."NativeInventoryItem"
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  item public."NativeInventoryItem"%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM native_inventory.sales_admission a
    JOIN public."NativeInventoryStore" n ON n."tenantId" = a.tenant_id AND n."storeId" = a.store_id
    WHERE a.tenant_id = p_tenant AND a.store_id = p_store AND a.source_kind = p_kind
      AND a.source_id = p_source AND a.epoch = n."salesEnabledAt" AND a.epoch <= transaction_timestamp()
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public."NativeInventoryItem"
    ("tenantId", "storeId", id, "productId", "productTenantId", "productName", "baseUnitName")
  SELECT p_tenant, p_store, gen_random_uuid()::text, p.id, p."tenantId", p.name,
    coalesce(nullif(btrim(p."mainUnitName"), ''), '件')
  FROM public."Product" p
  WHERE p.id = p_product AND p."tenantId" = p_tenant
    AND native_inventory.legacy_feed_retired(p_store)
    AND NOT EXISTS (
      SELECT 1 FROM public."NativeInventoryItem" i
      WHERE i."tenantId" = p_tenant AND i."storeId" = p_store AND i."productId" = p_product
    )
  ON CONFLICT ("tenantId", "storeId", "productId") DO NOTHING;

  SELECT * INTO item FROM public."NativeInventoryItem"
  WHERE "tenantId" = p_tenant AND "storeId" = p_store AND "productId" = p_product;
  RETURN item;
END;
$$;
REVOKE ALL ON FUNCTION native_inventory.sale_item(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION native_inventory.sale_item(text,text,text,text,text) TO eshop_native_inventory_access;

CREATE FUNCTION native_inventory.legacy_feed_retired(p_store text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM native_inventory.sales_pilot
    WHERE sheets_store_id = p_store AND sheets_retired_at IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION native_inventory.legacy_feed_retired(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION native_inventory.legacy_feed_retired(text) TO eshop_native_inventory_access;

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
  IF sale."quantity" <= 0 OR sale."productId" IS NULL THEN
    RETURN;
  END IF;
  item := native_inventory.sale_item(sale."tenantId", sale."storeId", sale."productId", 'POS', sale.id);
  IF item.id IS NULL THEN
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

CREATE OR REPLACE FUNCTION public.native_inventory_on_customer_sale() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  completed boolean := NEW."status" = 'COMPLETED' AND NEW."paymentStatus" = 'PAID';
  line record;
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

  -- This phase admits paid sales only. H5 returns are reconciled manually.
  IF NOT completed THEN
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
    IF line.quantity <= 0 OR line.quantity >= 1e314 OR scale(trim_scale(line.quantity)) > 6 THEN
      CONTINUE;
    END IF;
    item := native_inventory.sale_item(NEW."tenantId", NEW."storeId", line.product_id, 'H5', NEW.id);
    IF item.id IS NULL THEN
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
