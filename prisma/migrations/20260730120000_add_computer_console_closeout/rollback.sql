-- Roll back only the Computer Console closeout migration.
-- This removes launch-ticket data and soft-disable fields; it does not touch
-- ComputerBinding rows, Browser POS, sales, orders, payments, products, or printing.

BEGIN;

ALTER TABLE "ComputerBrowserLaunchTicket"
DROP CONSTRAINT IF EXISTS "ComputerBrowserLaunchTicket_bindingId_fkey";

ALTER TABLE "ComputerBinding"
DROP CONSTRAINT IF EXISTS "ComputerBinding_disabledByUserId_fkey";

DROP TABLE IF EXISTS "ComputerBrowserLaunchTicket";

DROP INDEX IF EXISTS "ComputerBinding_disabledByUserId_idx";
DROP INDEX IF EXISTS "ComputerBinding_tenantId_storeId_disabledAt_idx";

ALTER TABLE "ComputerBinding"
DROP COLUMN IF EXISTS "disabledByUserId",
DROP COLUMN IF EXISTS "disabledAt";

COMMIT;
