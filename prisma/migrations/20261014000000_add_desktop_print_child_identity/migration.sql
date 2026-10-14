-- DesktopDevice-owned hidden Network Print child identity.
-- Existing ComputerBinding rows remain LEGACY_AGENT and are not migrated.
CREATE TYPE "ComputerBindingIdentityKind" AS ENUM ('LEGACY_AGENT', 'DESKTOP_PRINT_CHILD');

ALTER TABLE "ComputerBinding"
  ADD COLUMN "identityKind" "ComputerBindingIdentityKind" NOT NULL DEFAULT 'LEGACY_AGENT',
  ADD COLUMN "parentDesktopDeviceId" TEXT,
  ADD COLUMN "childActiveSlot" TEXT;

ALTER TABLE "ComputerBinding"
  ADD CONSTRAINT "ComputerBinding_parentDesktopDeviceId_tenantId_storeId_fkey"
  FOREIGN KEY ("parentDesktopDeviceId", "tenantId", "storeId")
  REFERENCES "DesktopDevice"("id", "tenantId", "storeId")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ComputerBinding_parentDesktopDeviceId_identityKind_childActiveSlot_idx"
  ON "ComputerBinding"("parentDesktopDeviceId", "identityKind", "childActiveSlot");

-- One active child per DesktopDevice. Legacy rows have NULL parent/slot and are
-- intentionally outside this partial uniqueness contract.
CREATE UNIQUE INDEX "ComputerBinding_one_active_desktop_print_child_per_parent_key"
  ON "ComputerBinding"("parentDesktopDeviceId")
  WHERE "identityKind" = 'DESKTOP_PRINT_CHILD'
    AND "childActiveSlot" = 'ACTIVE'
    AND "parentDesktopDeviceId" IS NOT NULL;
