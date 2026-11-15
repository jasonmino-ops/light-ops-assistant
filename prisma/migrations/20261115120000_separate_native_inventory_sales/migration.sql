BEGIN;

ALTER TABLE public."NativeInventoryStore" ADD COLUMN "salesEnabledAt" timestamptz(3);

-- One explicitly selected pilot. The operator binds the verified live Sheets
-- store before activation. A missing binding keeps all automatic movements off.
CREATE TABLE native_inventory.sales_pilot (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  pilot_store_id text NOT NULL REFERENCES public."Store"(id),
  sheets_store_id text NOT NULL REFERENCES public."Store"(id),
  CHECK (pilot_store_id <> sheets_store_id)
);
ALTER TABLE native_inventory.sales_pilot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON native_inventory.sales_pilot FROM PUBLIC, eshop_native_inventory_access;

CREATE FUNCTION native_inventory.validate_sales_pilot() RETURNS trigger
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
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION native_inventory.validate_sales_pilot() FROM PUBLIC;
CREATE TRIGGER validate_sales_pilot
BEFORE INSERT OR UPDATE OR DELETE ON native_inventory.sales_pilot
FOR EACH ROW EXECUTE FUNCTION native_inventory.validate_sales_pilot();

CREATE FUNCTION native_inventory.set_sales_epoch() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."salesEnabledAt" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."enabledAt" IS NULL OR NOT EXISTS (
    SELECT 1 FROM native_inventory.sales_pilot p
    WHERE p.pilot_store_id = NEW."storeId" AND p.sheets_store_id <> NEW."storeId"
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
REVOKE ALL ON FUNCTION native_inventory.set_sales_epoch() FROM PUBLIC;
CREATE TRIGGER set_native_sales_epoch
BEFORE INSERT OR UPDATE OF "salesEnabledAt", "storeId", "tenantId" ON public."NativeInventoryStore"
FOR EACH ROW EXECUTE FUNCTION native_inventory.set_sales_epoch();

ALTER TABLE public."NativeInventoryStore" ADD CONSTRAINT native_sales_requires_inventory
  CHECK ("salesEnabledAt" IS NULL OR "enabledAt" IS NOT NULL);

-- Record admission at the source INSERT using the database transaction clock.
-- One POS transaction therefore admits every line against the same epoch,
-- even if display-sort timestamps differ. Preactivation orders get no marker.
CREATE TABLE native_inventory.sales_admission (
  tenant_id text NOT NULL,
  store_id text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('POS', 'H5', 'REFUND')),
  source_id text NOT NULL,
  epoch timestamptz(3) NOT NULL,
  -- Avoid competing FK key-share locks before the deferred store-row lock.
  PRIMARY KEY (tenant_id, store_id, source_kind, source_id)
);
ALTER TABLE native_inventory.sales_admission ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON native_inventory.sales_admission FROM PUBLIC;
GRANT SELECT, INSERT ON native_inventory.sales_admission TO eshop_native_inventory_access;
CREATE POLICY sales_admission_read ON native_inventory.sales_admission
  FOR SELECT TO eshop_native_inventory_access USING (true);
CREATE POLICY sales_admission_write ON native_inventory.sales_admission
  FOR INSERT TO eshop_native_inventory_access WITH CHECK (true);

-- Read Committed may see activation halfway through a multi-statement POS
-- order. Pin the first decision per store to this transaction, including OFF.
CREATE FUNCTION native_inventory.pin_sales_epoch(tenant_id text, store_id text) RETURNS timestamptz
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  scope text := jsonb_build_array(tenant_id, store_id)::text;
  decisions jsonb := coalesce(nullif(current_setting('eshop.native_sales_epochs', true), '')::jsonb, '{}'::jsonb);
  epoch timestamptz;
BEGIN
  IF NOT (decisions ? scope) THEN
    SELECT n."salesEnabledAt" INTO epoch FROM public."NativeInventoryStore" n
    WHERE n."tenantId" = tenant_id AND n."storeId" = store_id
      AND n."salesEnabledAt" <= transaction_timestamp();
    PERFORM set_config('eshop.native_sales_epochs', (decisions || jsonb_build_object(scope, epoch))::text, true);
    RETURN epoch;
  END IF;
  RETURN (decisions ->> scope)::timestamptz;
END;
$$;
REVOKE ALL ON FUNCTION native_inventory.pin_sales_epoch(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION native_inventory.pin_sales_epoch(text, text) TO eshop_native_inventory_access;

CREATE FUNCTION native_inventory.capture_sales_admission() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  inventory_store text := NEW."storeId";
  source_kind text := TG_ARGV[0];
  epoch timestamptz;
BEGIN
  IF source_kind = 'POS' THEN
    -- An offline upload cannot establish that the sale occurred in this epoch.
    IF NEW."offlineOrderId" IS NOT NULL OR NEW."source" = 'CASHIER_OFFLINE' THEN
      RETURN NEW;
    END IF;
    IF NEW."saleType" = 'REFUND' THEN
      source_kind := 'REFUND';
      SELECT "storeId" INTO inventory_store FROM public."SaleRecord" s
        WHERE s.id = NEW."originalSaleRecordId" AND s."tenantId" = NEW."tenantId";
    END IF;
  END IF;
  IF inventory_store IS NULL THEN
    RETURN NEW;
  END IF;
  epoch := native_inventory.pin_sales_epoch(NEW."tenantId", inventory_store);
  IF epoch IS NOT NULL THEN
    INSERT INTO native_inventory.sales_admission (tenant_id, store_id, source_kind, source_id, epoch)
      VALUES (NEW."tenantId", inventory_store, source_kind, NEW.id, epoch);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION native_inventory.capture_sales_admission() FROM PUBLIC;

CREATE TRIGGER capture_native_pos_sales_admission
AFTER INSERT ON public."SaleRecord" FOR EACH ROW EXECUTE FUNCTION native_inventory.capture_sales_admission('POS');
CREATE TRIGGER capture_native_h5_sales_admission
AFTER INSERT ON public."CustomerOrder" FOR EACH ROW EXECUTE FUNCTION native_inventory.capture_sales_admission('H5');

-- Enforce the switch at the journal boundary, including direct inserts. The
-- existing POS/H5 triggers hold the same store row before entering this guard.
-- Returning NULL also prevents native_inventory_move from updating the balance.
CREATE FUNCTION native_inventory.gate_sales_movement() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  active_since timestamptz;
  admission_kind text;
  admission_id text;
BEGIN
  IF NEW."type" NOT IN ('SALE', 'REFUND', 'SALE_CANCEL', 'REFUND_CANCEL', 'CUSTOMER_SALE', 'CUSTOMER_SALE_CANCEL') THEN
    RETURN NEW;
  END IF;

  SELECT "salesEnabledAt" INTO active_since FROM public."NativeInventoryStore"
    WHERE "tenantId" = NEW."tenantId" AND "storeId" = NEW."storeId"
    FOR UPDATE;
  IF active_since IS NULL OR transaction_timestamp() < active_since THEN
    RETURN NULL;
  END IF;

  CASE NEW."type"
    WHEN 'SALE' THEN admission_kind := 'POS'; admission_id := NEW."sourceId";
    WHEN 'CUSTOMER_SALE' THEN admission_kind := 'H5'; admission_id := NEW."originalId";
    WHEN 'REFUND' THEN admission_kind := 'REFUND'; admission_id := NEW."sourceId";
    ELSE
      -- Existing source handlers require the original journal row before
      -- posting a reversal. A pause suppresses all automatic journal writes.
      RETURN NEW;
  END CASE;
  IF EXISTS (
    SELECT 1 FROM native_inventory.sales_admission a
    WHERE a.tenant_id = NEW."tenantId" AND a.store_id = NEW."storeId"
      AND a.source_kind = admission_kind AND a.source_id = admission_id AND a.epoch = active_since
  ) THEN
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION native_inventory.gate_sales_movement() FROM PUBLIC;
CREATE TRIGGER gate_native_sales_movement
BEFORE INSERT ON public."NativeInventoryMovement"
FOR EACH ROW EXECUTE FUNCTION native_inventory.gate_sales_movement();

-- Avoid queuing inventory work while paused. The deferred handlers and the
-- journal guard still share the inventory row lock when a pause races checkout.
CREATE FUNCTION native_inventory.sales_active(tenant_id text, store_id text, original_sale_id text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."NativeInventoryStore" n
    WHERE n."tenantId" = tenant_id
      AND n."storeId" = CASE WHEN original_sale_id IS NULL THEN store_id ELSE (
        SELECT s."storeId" FROM public."SaleRecord" s WHERE s.id = original_sale_id AND s."tenantId" = tenant_id
      ) END
      AND n."salesEnabledAt" <= transaction_timestamp()
  );
$$;
REVOKE ALL ON FUNCTION native_inventory.sales_active(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION native_inventory.sales_active(text, text, text) TO eshop_native_inventory_access;

DROP TRIGGER native_inventory_sale ON public."SaleRecord";
CREATE CONSTRAINT TRIGGER native_inventory_sale
AFTER INSERT OR UPDATE OF "status" ON public."SaleRecord"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW."status" IN ('COMPLETED', 'CANCELLED')
  AND native_inventory.sales_active(NEW."tenantId", NEW."storeId",
    CASE WHEN NEW."saleType" = 'REFUND' THEN NEW."originalSaleRecordId" END))
EXECUTE FUNCTION public.native_inventory_on_sale();

DROP TRIGGER native_inventory_payment ON public."PaymentIntent";
CREATE CONSTRAINT TRIGGER native_inventory_payment
AFTER UPDATE OF "status" ON public."PaymentIntent"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (OLD."status" = 'PENDING' AND NEW."status" = 'PAID'
  AND native_inventory.sales_active(NEW."tenantId", NEW."storeId", NULL))
EXECUTE FUNCTION public.native_inventory_on_payment();

DROP TRIGGER native_inventory_customer_sale ON public."CustomerOrder";
CREATE CONSTRAINT TRIGGER native_inventory_customer_sale
AFTER INSERT OR UPDATE OF "status", "paymentStatus" ON public."CustomerOrder"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (native_inventory.sales_active(NEW."tenantId", NEW."storeId", NULL))
EXECUTE FUNCTION public.native_inventory_on_customer_sale();

COMMIT;
