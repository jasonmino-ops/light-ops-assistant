-- Test fixture for the pre-existing application ACL. This deliberately contains
-- no inventory schema, policies, or function grants. Run only in the disposable
-- integration database, as its owner; deployments use their established ACL.
DO $$
BEGIN
  IF current_database() !~ '^native_inventory_test_[a-z0-9_]+$'
     OR inet_server_addr() IS NULL
     OR inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet) THEN
    RAISE EXCEPTION 'This fixture is restricted to a loopback test database';
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO eshop_app_runtime;
GRANT SELECT ON public."Tenant", public."TenantSubscription", public."Store", public."User",
  public."UserStoreRole", public."ProductCategory", public."MerchantPaymentConfig", public."CampaignLink",
  public."CouponTemplate", public."PaymentTransaction", public."PosSession", public."ComputerBinding",
  public."CashierSaleIdempotency"
TO eshop_app_runtime;
GRANT SELECT, INSERT, UPDATE ON public."Product", public."SaleRecord", public."PaymentIntent", public."CustomerOrder",
  public."BrowserPosDevice", public."DesktopDevice", public."DesktopActivationPin", public."OfflineSaleSyncMap",
  public."V3PrintControlPlane", public."V3PrintExecutionBatch", public."DiningMeal", public."DiningTable", public."DiningBatch"
TO eshop_app_runtime;
GRANT SELECT, UPDATE ON public."CustomerCoupon", public."Member" TO eshop_app_runtime;
GRANT SELECT, INSERT ON public."MemberBalanceLedger", public."OperationLog", public."CouponRedemption",
  public."CustomerJourneyEvent", public."DesktopActivationAudit", public."TelegramMessage", public."DiningVoidLine"
TO eshop_app_runtime;
