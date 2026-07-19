-- EP-MB3-06C explicit actor model for activation PIN issuance.
-- Existing merchant PIN rows keep createdByUserId and get createdByOpsAdminId = NULL.
-- New ops-issued PIN rows set createdByUserId = NULL and createdByOpsAdminId = OpsAdmin.id.

ALTER TABLE "DesktopActivationPin"
  ADD COLUMN "createdByOpsAdminId" TEXT;

ALTER TABLE "DesktopActivationAudit"
  ADD COLUMN "actorOpsAdminId" TEXT;

ALTER TABLE "DesktopActivationPin"
  ALTER COLUMN "createdByUserId" DROP NOT NULL;

CREATE INDEX "DesktopActivationPin_createdByOpsAdminId_idx"
  ON "DesktopActivationPin"("createdByOpsAdminId");

CREATE INDEX "DesktopActivationAudit_actorOpsAdminId_idx"
  ON "DesktopActivationAudit"("actorOpsAdminId");

ALTER TABLE "DesktopActivationPin"
  ADD CONSTRAINT "DesktopActivationPin_createdByOpsAdminId_fkey"
  FOREIGN KEY ("createdByOpsAdminId") REFERENCES "OpsAdmin"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DesktopActivationAudit"
  ADD CONSTRAINT "DesktopActivationAudit_actorOpsAdminId_fkey"
  FOREIGN KEY ("actorOpsAdminId") REFERENCES "OpsAdmin"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DesktopActivationPin"
  ADD CONSTRAINT "DesktopActivationPin_exactly_one_creator_check"
  CHECK (
    ("createdByUserId" IS NOT NULL AND "createdByOpsAdminId" IS NULL)
    OR
    ("createdByUserId" IS NULL AND "createdByOpsAdminId" IS NOT NULL)
  );
