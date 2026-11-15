BEGIN;

-- Provision the existing application login and the inventory-only NOLOGIN
-- capability independently. The existing application ACL is managed by the
-- deployment, including its existing RLS policies. Do not substitute the old
-- inventory-only login for DATABASE_URL or mirror legacy privileges here.
DO $$
DECLARE
  app oid := to_regrole('eshop_app_runtime');
  inventory oid := to_regrole('eshop_native_inventory_access');
BEGIN
  IF app IS NULL OR inventory IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE oid = app AND rolcanlogin
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE oid = inventory AND NOT rolcanlogin
  ) THEN
    RAISE EXCEPTION 'Separate application login and inventory capability are required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE pg_has_role(app, r.oid, 'MEMBER') AND (
      r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
      OR r.rolname IN ('anon', 'authenticated', 'service_role', 'authenticator',
        'supabase_admin', 'supabase_auth_admin', 'eshop_native_inventory_app')
      OR left(r.rolname, 3) = 'pg_'
    )
  ) OR pg_has_role(app, current_user, 'MEMBER')
    OR pg_has_role(app, (SELECT datdba FROM pg_database WHERE datname = current_database()), 'MEMBER')
    OR has_schema_privilege(app, 'public', 'CREATE')
    OR has_schema_privilege(app, 'native_inventory', 'CREATE')
    OR EXISTS (
      SELECT 1 FROM pg_roles r
      WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'authenticator', 'eshop_native_inventory_app')
        AND pg_has_role(r.oid, app, 'MEMBER')
    ) OR EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'native_inventory') AND pg_has_role(app, p.proowner, 'MEMBER')
    ) OR EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'native_inventory') AND pg_has_role(app, c.relowner, 'MEMBER')
    ) THEN
    RAISE EXCEPTION 'Application login must have a non-owner, non-privileged ACL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE roleid = inventory AND member = app AND inherit_option AND NOT set_option AND NOT admin_option
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE member = inventory OR (
      roleid = inventory AND (member <> app OR NOT inherit_option OR set_option OR admin_option)
    )
  ) THEN
    RAISE EXCEPTION 'Inventory capability must be inherited only by the application login without SET or ADMIN';
  END IF;

  -- Permissive policies are ORed. Refuse to add the sealed internal policy if
  -- it would mask a deployment's existing, narrower permissive policy.
  IF EXISTS (
    SELECT 1 FROM pg_policy p
    CROSS JOIN LATERAL unnest(p.polroles) AS recipient(role_oid)
    WHERE p.polrelid IN ('public."CustomerOrderFulfillmentIntent"'::regclass, 'public."EshopTrayPrintJob"'::regclass)
      AND p.polpermissive
      AND CASE WHEN recipient.role_oid = 0 THEN true ELSE pg_has_role(app, recipient.role_oid, 'USAGE') END
      AND (p.polcmd <> '*' OR pg_get_expr(p.polqual, p.polrelid) IS DISTINCT FROM 'true'
        OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), 'true') <> 'true')
  ) THEN
    RAISE EXCEPTION 'Existing scoped fulfillment or print policy requires an explicit compatibility review';
  END IF;
END;
$$;

-- Move the sealed inventory ACL and policies verbatim to the capability. The
-- application and the inventory triggers run on the same session/transaction.
GRANT USAGE ON SCHEMA native_inventory TO eshop_native_inventory_access;
GRANT SELECT, INSERT ON native_inventory.order_currency TO eshop_native_inventory_access;
GRANT SELECT, INSERT, UPDATE ON native_inventory.desktop_operator TO eshop_native_inventory_access;
ALTER POLICY inventory_application_currency ON native_inventory.order_currency TO eshop_native_inventory_access;
ALTER POLICY inventory_application_operator ON native_inventory.desktop_operator TO eshop_native_inventory_access;

GRANT SELECT, UPDATE ("enabledAt") ON public."NativeInventoryStore" TO eshop_native_inventory_access;
ALTER POLICY inventory_application_store_read ON public."NativeInventoryStore" TO eshop_native_inventory_access;
ALTER POLICY inventory_application_store_lock ON public."NativeInventoryStore" TO eshop_native_inventory_access;

GRANT SELECT, INSERT, UPDATE ON public."NativeInventoryItem", public."NativeInventorySupplier" TO eshop_native_inventory_access;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."NativeInventoryReceipt" TO eshop_native_inventory_access;
GRANT SELECT, INSERT, DELETE ON public."NativeInventoryReceiptLine", public."NativeInventoryReceiver" TO eshop_native_inventory_access;
GRANT SELECT, INSERT ON public."NativeInventoryMovement", public."NativeInventoryUnit" TO eshop_native_inventory_access;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'NativeInventoryItem', 'NativeInventorySupplier', 'NativeInventoryReceipt',
    'NativeInventoryReceiptLine', 'NativeInventoryReceiver', 'NativeInventoryMovement', 'NativeInventoryUnit'
  ] LOOP
    EXECUTE format('ALTER POLICY inventory_application ON public.%I TO eshop_native_inventory_access', table_name);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.native_inventory_move(text,text,text,text,public."NativeInventoryMovementType",numeric,numeric,numeric,numeric,text,text,text),
  public.native_inventory_complete_sale(public."SaleRecord"),
  public.native_inventory_post_receipt(text,text,text,text)
TO eshop_native_inventory_access;

-- Preserve the two sealed transaction dependencies on the shared backend
-- login. They are private H5/print tables, not inventory capability grants.
GRANT SELECT, INSERT, UPDATE ON public."CustomerOrderFulfillmentIntent", public."EshopTrayPrintJob" TO eshop_app_runtime;
ALTER POLICY inventory_application_fulfillment ON public."CustomerOrderFulfillmentIntent" TO eshop_app_runtime;
ALTER POLICY inventory_application_relay ON public."EshopTrayPrintJob" TO eshop_app_runtime;

-- Retire the superseded inventory login's M1 grants in this database.

REVOKE USAGE ON SCHEMA native_inventory, public FROM eshop_native_inventory_app;
REVOKE SELECT, INSERT ON native_inventory.order_currency FROM eshop_native_inventory_app;
REVOKE SELECT, INSERT, UPDATE ON native_inventory.desktop_operator FROM eshop_native_inventory_app;
REVOKE UPDATE ("enabledAt") ON public."NativeInventoryStore" FROM eshop_native_inventory_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON
  public."NativeInventoryStore", public."NativeInventoryItem", public."NativeInventorySupplier",
  public."NativeInventoryReceipt", public."NativeInventoryReceiptLine", public."NativeInventoryReceiver",
  public."NativeInventoryMovement", public."NativeInventoryUnit",
  public."Tenant", public."TenantSubscription", public."Store", public."User", public."UserStoreRole",
  public."Product", public."ProductCategory", public."MerchantPaymentConfig", public."CampaignLink",
  public."CouponTemplate", public."PaymentTransaction", public."DiningMeal", public."V3PrintControlPlane",
  public."DiningTable", public."PosSession", public."SaleRecord", public."PaymentIntent", public."CustomerOrder",
  public."BrowserPosDevice", public."DesktopDevice", public."DesktopActivationPin", public."CustomerCoupon",
  public."Member", public."MemberBalanceLedger", public."OfflineSaleSyncMap", public."OperationLog",
  public."CouponRedemption", public."CustomerJourneyEvent", public."DesktopActivationAudit", public."TelegramMessage",
  public."CustomerOrderFulfillmentIntent", public."EshopTrayPrintJob"
FROM eshop_native_inventory_app;
REVOKE EXECUTE ON FUNCTION
  public.native_inventory_move(text,text,text,text,public."NativeInventoryMovementType",numeric,numeric,numeric,numeric,text,text,text),
  public.native_inventory_complete_sale(public."SaleRecord"),
  public.native_inventory_post_receipt(text,text,text,text)
FROM eshop_native_inventory_app;

COMMIT;
