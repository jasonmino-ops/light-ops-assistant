BEGIN;

-- Additive only: never rewrite an executed migration or backfill a journal.
-- Main without the deployed Phase-2 prerequisite remains installable but cannot
-- activate this control. Only the audited Diamond binding can opt in.
CREATE FUNCTION native_inventory.diamond_control_ready(p_tenant text, p_store text)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
BEGIN
  IF to_regprocedure('native_inventory.legacy_feed_retired(text)') IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public."Store" s WHERE s.id = p_store
    AND s."tenantId" = p_tenant AND s.code = 'ST883DC00C' AND s.status = 'ACTIVE')
    AND native_inventory.legacy_feed_retired(p_store);
END;
$$;
REVOKE ALL ON FUNCTION native_inventory.diamond_control_ready(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION native_inventory.diamond_control_ready(text,text) TO eshop_native_inventory_access;

CREATE FUNCTION native_inventory.pos_reversal_active(p_tenant text, p_original text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public."NativeInventoryMovement" m
    WHERE m."tenantId" = p_tenant AND m.type = 'SALE' AND m."sourceId" = p_original
      AND native_inventory.diamond_control_ready(p_tenant, m."storeId"));
$$;
REVOKE ALL ON FUNCTION native_inventory.pos_reversal_active(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION native_inventory.pos_reversal_active(text,text) TO eshop_native_inventory_access;

CREATE OR REPLACE FUNCTION native_inventory.gate_sales_movement() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  active_since timestamptz;
  admission_kind text;
  admission_id text;
  original public."NativeInventoryMovement"%ROWTYPE;
  returned public."NativeInventoryMovement"%ROWTYPE;
  source public."SaleRecord"%ROWTYPE;
  net_returned numeric;
BEGIN
  IF NEW.type NOT IN ('SALE', 'REFUND', 'SALE_CANCEL', 'REFUND_CANCEL', 'CUSTOMER_SALE', 'CUSTOMER_SALE_CANCEL') THEN
    RETURN NEW;
  END IF;
  SELECT "salesEnabledAt" INTO active_since FROM public."NativeInventoryStore"
    WHERE "tenantId" = NEW."tenantId" AND "storeId" = NEW."storeId" FOR UPDATE;

  IF native_inventory.diamond_control_ready(NEW."tenantId", NEW."storeId") THEN
    IF NEW.type = 'CUSTOMER_SALE_CANCEL' THEN RETURN NULL; END IF;
    IF NEW.type IN ('REFUND','SALE_CANCEL','REFUND_CANCEL') THEN
      -- All automatic writers share the store lock. Exact source replay is a
      -- no-op BEFORE applying the aggregate cap, even when now fully returned.
      IF EXISTS (SELECT 1 FROM public."NativeInventoryMovement" m
        WHERE m."tenantId"=NEW."tenantId" AND m."storeId"=NEW."storeId"
          AND m.type=NEW.type AND m."sourceId"=NEW."sourceId") THEN RETURN NULL; END IF;
      SELECT * INTO original FROM public."NativeInventoryMovement" m
        WHERE m."tenantId"=NEW."tenantId" AND m."storeId"=NEW."storeId"
          AND m.type='SALE' AND m."sourceId"=NEW."originalId";
      IF NOT FOUND OR original.quantity >= 0 OR original."itemId" <> NEW."itemId" THEN RETURN NULL; END IF;
      IF EXISTS (SELECT 1 FROM public."NativeInventoryMovement" m
        WHERE m."tenantId"=NEW."tenantId" AND m."storeId"=NEW."storeId"
          AND m.type='SALE_CANCEL' AND m."sourceId"=original."sourceId") THEN RETURN NULL; END IF;
      SELECT * INTO source FROM public."SaleRecord" s
        WHERE s."tenantId"=NEW."tenantId" AND s.id=NEW."sourceId";
      IF NOT FOUND THEN RETURN NULL; END IF;
      IF NEW.type='REFUND' THEN
        IF source."saleType" <> 'REFUND' OR source.status <> 'COMPLETED'
          OR source."originalSaleRecordId" IS DISTINCT FROM original."sourceId"
          OR NEW.quantity <> abs(source.quantity) OR NEW.quantity <= 0
          OR EXISTS (SELECT 1 FROM public."NativeInventoryMovement" m
            WHERE m."tenantId"=NEW."tenantId" AND m."storeId"=NEW."storeId"
              AND m.type='SALE_CANCEL' AND m."sourceId"=original."sourceId") THEN RETURN NULL; END IF;
        SELECT coalesce(sum(m.quantity),0) INTO net_returned FROM public."NativeInventoryMovement" m
          WHERE m."tenantId"=NEW."tenantId" AND m."storeId"=NEW."storeId"
            AND m."originalId"=original."sourceId" AND m.type IN ('REFUND','REFUND_CANCEL');
        IF net_returned + NEW.quantity > -original.quantity THEN
          RAISE EXCEPTION 'NATIVE_REFUND_QTY_EXCEEDED' USING ERRCODE='23514';
        END IF;
      ELSIF NEW.type='REFUND_CANCEL' THEN
        SELECT * INTO returned FROM public."NativeInventoryMovement" m
          WHERE m."tenantId"=NEW."tenantId" AND m."storeId"=NEW."storeId"
            AND m.type='REFUND' AND m."sourceId"=NEW."sourceId"
            AND m."originalId"=original."sourceId";
        IF NOT FOUND OR source."saleType" <> 'REFUND' OR source.status <> 'CANCELLED'
          OR source."originalSaleRecordId" IS DISTINCT FROM original."sourceId"
          OR NEW.quantity <> -returned.quantity THEN RETURN NULL; END IF;
      ELSE
        IF source."saleType" <> 'SALE' OR source.status <> 'CANCELLED'
          OR source.id <> original."sourceId" THEN RETURN NULL; END IF;
        SELECT coalesce(sum(m.quantity),0) INTO net_returned FROM public."NativeInventoryMovement" m
          WHERE m."tenantId"=NEW."tenantId" AND m."storeId"=NEW."storeId"
            AND m."originalId"=original."sourceId" AND m.type IN ('REFUND','REFUND_CANCEL');
        IF NEW.quantity <> -original.quantity-net_returned THEN RETURN NULL; END IF;
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  -- Existing sale admission is unchanged: no historic, offline or old-epoch
  -- order is admitted by pausing/re-enabling. Other stores retain old rules.
  IF active_since IS NULL OR transaction_timestamp() < active_since THEN RETURN NULL; END IF;
  CASE NEW.type
    WHEN 'SALE' THEN admission_kind := 'POS'; admission_id := NEW."sourceId";
    WHEN 'CUSTOMER_SALE' THEN admission_kind := 'H5'; admission_id := NEW."originalId";
    WHEN 'REFUND' THEN admission_kind := 'REFUND'; admission_id := NEW."sourceId";
    ELSE RETURN NEW;
  END CASE;
  IF EXISTS (SELECT 1 FROM native_inventory.sales_admission a
    WHERE a.tenant_id=NEW."tenantId" AND a.store_id=NEW."storeId"
      AND a.source_kind=admission_kind AND a.source_id=admission_id AND a.epoch=active_since) THEN RETURN NEW; END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER native_inventory_sale ON public."SaleRecord";
CREATE CONSTRAINT TRIGGER native_inventory_sale
AFTER INSERT OR UPDATE OF status ON public."SaleRecord"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW.status IN ('COMPLETED','CANCELLED') AND (
  native_inventory.sales_active(NEW."tenantId",NEW."storeId",
    CASE WHEN NEW."saleType"='REFUND' THEN NEW."originalSaleRecordId" END)
  OR ((NEW."saleType"='REFUND' OR NEW.status='CANCELLED') AND
    native_inventory.pos_reversal_active(NEW."tenantId",coalesce(NEW."originalSaleRecordId",NEW.id)))
)) EXECUTE FUNCTION public.native_inventory_on_sale();

-- Internal command/audit boundary, not a public Supabase Data API. No direct
-- application table writes: only narrowly scoped functions below may append.
CREATE TABLE native_inventory.sales_control_version (
  tenant_id text NOT NULL, store_id text NOT NULL, version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(tenant_id,store_id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES public."NativeInventoryStore"("tenantId","storeId")
);
CREATE TABLE native_inventory.sales_control_operation (
  tenant_id text NOT NULL, store_id text NOT NULL, request_id uuid NOT NULL,
  actor_id text NOT NULL, requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  payload jsonb NOT NULL, result jsonb NOT NULL,
  PRIMARY KEY(tenant_id,store_id,request_id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES public."NativeInventoryStore"("tenantId","storeId")
);
ALTER TABLE native_inventory.sales_control_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE native_inventory.sales_control_operation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON native_inventory.sales_control_version,native_inventory.sales_control_operation
  FROM PUBLIC,anon,authenticated,service_role,eshop_app_runtime,eshop_native_inventory_access;

-- SECURITY DEFINER is intentional for the append-only private audit command.
-- Never grant anon/authenticated access; validate live person/store membership
-- internally as well as the existing signed Telegram/Desktop API proof.
CREATE FUNCTION native_inventory.sales_control_access(p_tenant text,p_store text,p_actor text,p_owner boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (SELECT 1 FROM public."UserStoreRole" m
    JOIN public."User" u ON u.id=m."userId" AND u."tenantId"=m."tenantId"
    JOIN public."Store" s ON s.id=m."storeId" AND s."tenantId"=m."tenantId"
    JOIN public."Tenant" t ON t.id=m."tenantId"
    JOIN public."NativeInventoryStore" n ON n."tenantId"=m."tenantId" AND n."storeId"=m."storeId"
    WHERE m."tenantId"=p_tenant AND m."storeId"=p_store AND m."userId"=p_actor
      AND m.status='ACTIVE' AND u.status='ACTIVE' AND s.status='ACTIVE' AND t.status='ACTIVE'
      AND n."enabledAt" IS NOT NULL AND n."currencyCode"=s."currencyCode"
      AND ((m.role='OWNER' AND u.role='OWNER') OR (NOT p_owner AND EXISTS (
        SELECT 1 FROM public."NativeInventoryReceiver" r
          WHERE r."tenantId"=p_tenant AND r."storeId"=p_store AND r."userId"=p_actor))));
$$;
REVOKE ALL ON FUNCTION native_inventory.sales_control_access(text,text,text,boolean) FROM PUBLIC;

CREATE FUNCTION native_inventory.sales_control_state(p_tenant text,p_store text,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT native_inventory.sales_control_access(p_tenant,p_store,p_actor,false) THEN
    RAISE EXCEPTION 'STORE_ACCESS_DENIED' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object('available',s.code='ST883DC00C','ready',native_inventory.diamond_control_ready(p_tenant,p_store),
    'enabled',n."salesEnabledAt" IS NOT NULL,'epoch',n."salesEnabledAt",'version',coalesce(v.version,0)::text,
    'canControl',s.code='ST883DC00C' AND native_inventory.sales_control_access(p_tenant,p_store,p_actor,true),
    'h5Refund',false,'checkedAt',clock_timestamp()) INTO result
    FROM public."NativeInventoryStore" n JOIN public."Store" s ON s.id=n."storeId" AND s."tenantId"=n."tenantId"
    LEFT JOIN native_inventory.sales_control_version v ON v.tenant_id=n."tenantId" AND v.store_id=n."storeId"
    WHERE n."tenantId"=p_tenant AND n."storeId"=p_store;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION native_inventory.sales_control_state(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION native_inventory.sales_control_state(text,text,text) TO eshop_native_inventory_access;

CREATE FUNCTION native_inventory.sales_control_command(p_tenant text,p_store text,p_actor text,p_request uuid,p_payload jsonb,p_resolve boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  flag public."NativeInventoryStore"%ROWTYPE;
  prior native_inventory.sales_control_operation%ROWTYPE;
  current_version bigint;
  before_epoch timestamptz;
  failure text;
  outcome text;
  result jsonb;
BEGIN
  SELECT * INTO flag FROM public."NativeInventoryStore" n
    WHERE n."tenantId"=p_tenant AND n."storeId"=p_store FOR UPDATE;
  IF NOT FOUND OR NOT native_inventory.sales_control_access(p_tenant,p_store,p_actor,true) THEN
    RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE='42501';
  END IF;
  -- Keep the authenticated membership valid until this transaction commits.
  PERFORM 1 FROM public."UserStoreRole" m JOIN public."User" u ON u.id=m."userId"
    WHERE m."tenantId"=p_tenant AND m."storeId"=p_store AND m."userId"=p_actor
      AND m.role='OWNER' AND m.status='ACTIVE' AND u.role='OWNER' AND u.status='ACTIVE' FOR SHARE OF m,u;
  IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."Store" WHERE id=p_store AND "tenantId"=p_tenant AND code='ST883DC00C') THEN
    RAISE EXCEPTION 'DIAMOND_ONLY' USING ERRCODE='42501';
  END IF;
  SELECT * INTO prior FROM native_inventory.sales_control_operation
    WHERE tenant_id=p_tenant AND store_id=p_store AND request_id=p_request;
  IF FOUND THEN
    IF prior.actor_id<>p_actor OR prior.payload<>p_payload THEN
      RAISE EXCEPTION 'CONTROL_REQUEST_CONFLICT' USING ERRCODE='22023';
    END IF;
    RETURN prior.result;
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload->'enabled') IS DISTINCT FROM 'boolean'
    OR coalesce(p_payload->>'expectedVersion','') !~ '^[0-9]{1,15}$'
    OR NOT (p_payload ? 'expectedEpoch') THEN
    RAISE EXCEPTION 'INVALID_CONTROL_REQUEST' USING ERRCODE='22023';
  END IF;
  INSERT INTO native_inventory.sales_control_version(tenant_id,store_id) VALUES(p_tenant,p_store) ON CONFLICT DO NOTHING;
  SELECT version INTO current_version FROM native_inventory.sales_control_version
    WHERE tenant_id=p_tenant AND store_id=p_store;
  before_epoch:=flag."salesEnabledAt";
  IF p_resolve THEN
    -- Fences a late original request. If it had committed we returned its
    -- immutable result above. NOT_APPLIED can therefore never later activate.
    failure:='REQUEST_NOT_APPLIED'; outcome:='NOT_APPLIED';
  ELSIF (p_payload->>'expectedVersion')::bigint<>current_version
    OR (p_payload->>'expectedEpoch')::timestamptz IS DISTINCT FROM before_epoch THEN
    failure:='CONTROL_STATE_CHANGED';
  ELSIF (p_payload->>'enabled')::boolean AND before_epoch IS NULL THEN
    IF NOT native_inventory.diamond_control_ready(p_tenant,p_store) THEN failure:='PILOT_NOT_READY';
    ELSIF p_payload->'confirmations' IS DISTINCT FROM '{"terminalsRefreshed":true,"offlineQueueEmpty":true,"noCheckout":true}'::jsonb THEN
      failure:='FIELD_CONFIRMATION_REQUIRED';
    ELSIF EXISTS (SELECT 1 FROM public."SaleRecord" WHERE "tenantId"=p_tenant AND "storeId"=p_store AND status='PENDING_PAYMENT')
      OR EXISTS (SELECT 1 FROM public."CustomerOrder" WHERE "tenantId"=p_tenant AND "storeId"=p_store
        AND (status IN ('PENDING','CONFIRMED') OR (status='COMPLETED' AND "paymentStatus"='UNPAID')))
      OR EXISTS (SELECT 1 FROM public."PaymentIntent" WHERE "tenantId"=p_tenant AND "storeId"=p_store AND status='PENDING')
      OR EXISTS (SELECT 1 FROM public."PaymentTransaction" WHERE "tenantId"=p_tenant AND "storeId"=p_store AND status='PENDING')
      OR EXISTS (SELECT 1 FROM public."OfflineSaleSyncMap" WHERE "tenantId"=p_tenant AND "storeId"=p_store AND status IN ('PENDING','FAILED')) THEN
      failure:='UNSETTLED_OPERATIONS';
    END IF;
  END IF;
  IF failure IS NULL THEN
    UPDATE public."NativeInventoryStore" SET "salesEnabledAt"=CASE WHEN (p_payload->>'enabled')::boolean THEN coalesce(before_epoch,clock_timestamp()) ELSE NULL END
      WHERE "tenantId"=p_tenant AND "storeId"=p_store RETURNING * INTO flag;
    UPDATE native_inventory.sales_control_version SET version=version+1
      WHERE tenant_id=p_tenant AND store_id=p_store RETURNING version INTO current_version;
    outcome:='APPLIED';
  ELSE outcome:=coalesce(outcome,'REJECTED'); END IF;
  result:=jsonb_build_object('id',p_request,'actorId',p_actor,'at',clock_timestamp(),'outcome',outcome,'error',failure,
    'beforeEnabled',before_epoch IS NOT NULL,'beforeEpoch',before_epoch,
    'afterEnabled',flag."salesEnabledAt" IS NOT NULL,'afterEpoch',flag."salesEnabledAt",'version',current_version::text);
  INSERT INTO native_inventory.sales_control_operation(tenant_id,store_id,request_id,actor_id,payload,result)
    VALUES(p_tenant,p_store,p_request,p_actor,p_payload,result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION native_inventory.sales_control_command(text,text,text,uuid,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION native_inventory.sales_control_command(text,text,text,uuid,jsonb,boolean) TO eshop_native_inventory_access;

COMMIT;
