BEGIN;

-- Provision this restricted login independently, before running migrations.
-- Never grant it the migration owner's role or one of the PostgREST roles.
DO $$
DECLARE
  runtime_role pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO runtime_role FROM pg_catalog.pg_roles WHERE rolname = 'eshop_native_inventory_app';
  IF NOT FOUND OR NOT runtime_role.rolcanlogin OR runtime_role.rolsuper OR runtime_role.rolbypassrls
      OR runtime_role.rolcreaterole OR runtime_role.rolcreatedb OR runtime_role.rolreplication
      OR pg_has_role(runtime_role.oid, current_user, 'MEMBER')
      OR pg_has_role(runtime_role.oid, 'anon', 'MEMBER')
      OR pg_has_role(runtime_role.oid, 'authenticated', 'MEMBER')
      OR pg_has_role(runtime_role.oid, 'service_role', 'MEMBER') THEN
    RAISE EXCEPTION 'A separate restricted eshop_native_inventory_app role is required';
  END IF;
END;
$$;

CREATE TABLE native_inventory.desktop_operator (
  device_session_id text PRIMARY KEY REFERENCES public."BrowserPosDevice"(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  tenant_id text NOT NULL,
  store_id text NOT NULL,
  code_hash text UNIQUE NOT NULL,
  claim_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  operator_id text REFERENCES public."User"(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id, tenant_id, store_id) REFERENCES public."DesktopDevice"(id, "tenantId", "storeId") ON DELETE CASCADE,
  FOREIGN KEY (store_id, tenant_id) REFERENCES public."Store"("id", "tenantId") ON DELETE CASCADE
);
ALTER TABLE native_inventory.desktop_operator ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA native_inventory FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE native_inventory.order_currency, native_inventory.desktop_operator FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION native_inventory.capture_order_currency() FROM anon, authenticated, service_role;

GRANT USAGE ON SCHEMA native_inventory TO eshop_native_inventory_app;
GRANT SELECT, INSERT ON native_inventory.order_currency TO eshop_native_inventory_app;
GRANT SELECT, INSERT, UPDATE ON native_inventory.desktop_operator TO eshop_native_inventory_app;
CREATE POLICY inventory_application_currency ON native_inventory.order_currency
  TO eshop_native_inventory_app USING (true) WITH CHECK (true);
CREATE POLICY inventory_application_operator ON native_inventory.desktop_operator
  TO eshop_native_inventory_app USING (true) WITH CHECK (true);

GRANT SELECT ON public."NativeInventoryStore" TO eshop_native_inventory_app;
-- PostgreSQL requires UPDATE privilege to lock a row. The update policy
-- permits row locks while preventing changes to store activation or currency.
GRANT UPDATE ("enabledAt") ON public."NativeInventoryStore" TO eshop_native_inventory_app;
CREATE POLICY inventory_application_store_read ON public."NativeInventoryStore"
  FOR SELECT TO eshop_native_inventory_app USING (true);
CREATE POLICY inventory_application_store_lock ON public."NativeInventoryStore"
  FOR UPDATE TO eshop_native_inventory_app USING (true) WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE ON public."NativeInventoryItem", public."NativeInventorySupplier" TO eshop_native_inventory_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."NativeInventoryReceipt" TO eshop_native_inventory_app;
GRANT SELECT, INSERT, DELETE ON public."NativeInventoryReceiptLine", public."NativeInventoryReceiver" TO eshop_native_inventory_app;
GRANT SELECT, INSERT ON public."NativeInventoryMovement" TO eshop_native_inventory_app;
GRANT SELECT, INSERT ON public."NativeInventoryUnit" TO eshop_native_inventory_app;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'NativeInventoryItem', 'NativeInventorySupplier', 'NativeInventoryReceipt',
    'NativeInventoryReceiptLine', 'NativeInventoryReceiver', 'NativeInventoryMovement', 'NativeInventoryUnit'
  ] LOOP
    EXECUTE format('CREATE POLICY inventory_application ON public.%I TO eshop_native_inventory_app USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.native_inventory_move(text,text,text,text,public."NativeInventoryMovementType",numeric,numeric,numeric,numeric,text,text,text),
  public.native_inventory_complete_sale(public."SaleRecord"),
  public.native_inventory_post_receipt(text,text,text,text)
TO eshop_native_inventory_app;

-- Existing tables used by M1 are read or written with the same Prisma login.
-- Keep this ACL limited to inventory, order settlement and device authorization.
GRANT USAGE ON SCHEMA public TO eshop_native_inventory_app;
GRANT SELECT ON public."Tenant", public."TenantSubscription", public."Store", public."User",
  public."UserStoreRole", public."Product", public."ProductCategory", public."MerchantPaymentConfig",
  public."CampaignLink", public."CouponTemplate", public."PaymentTransaction", public."DiningMeal",
  public."V3PrintControlPlane", public."DiningTable", public."PosSession"
TO eshop_native_inventory_app;
GRANT SELECT, INSERT, UPDATE ON public."SaleRecord", public."PaymentIntent", public."CustomerOrder",
  public."BrowserPosDevice", public."DesktopDevice", public."DesktopActivationPin"
TO eshop_native_inventory_app;
GRANT SELECT, UPDATE ON public."CustomerCoupon", public."Member" TO eshop_native_inventory_app;
GRANT SELECT, INSERT ON public."MemberBalanceLedger" TO eshop_native_inventory_app;
GRANT SELECT, INSERT, UPDATE ON public."OfflineSaleSyncMap" TO eshop_native_inventory_app;
GRANT SELECT, INSERT ON public."OperationLog", public."CouponRedemption", public."CustomerJourneyEvent",
  public."DesktopActivationAudit", public."TelegramMessage"
TO eshop_native_inventory_app;

-- This table is already private. Give the separate backend role only the
-- existing fulfillment operations it needs for H5 checkout and cancellation.
GRANT SELECT, INSERT, UPDATE ON public."CustomerOrderFulfillmentIntent" TO eshop_native_inventory_app;
CREATE POLICY inventory_application_fulfillment ON public."CustomerOrderFulfillmentIntent"
  TO eshop_native_inventory_app USING (true) WITH CHECK (true);
-- Checkout enqueue and H5 cancellation already use the relay in the same
-- transaction. Keep that ACL private to the authenticated backend role.
GRANT SELECT, INSERT, UPDATE ON public."EshopTrayPrintJob" TO eshop_native_inventory_app;
CREATE POLICY inventory_application_relay ON public."EshopTrayPrintJob"
  TO eshop_native_inventory_app USING (true) WITH CHECK (true);

COMMIT;
