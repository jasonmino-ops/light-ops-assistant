-- ES-SALES-LEAD-01 release-unblock exception: one platform row containing
-- only the two customer-visible support contacts approved by Architecture Board.
CREATE TABLE "SalesLeadSupportConfig" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "supportPhone" TEXT,
    "telegramSupportTarget" TEXT,
    "updatedByOpsAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesLeadSupportConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SalesLeadSupportConfig_singleton_check" CHECK ("id" = 'platform')
);

CREATE INDEX "SalesLeadSupportConfig_updatedByOpsAdminId_idx"
ON "SalesLeadSupportConfig"("updatedByOpsAdminId");

ALTER TABLE "SalesLeadSupportConfig"
ADD CONSTRAINT "SalesLeadSupportConfig_updatedByOpsAdminId_fkey"
FOREIGN KEY ("updatedByOpsAdminId") REFERENCES "OpsAdmin"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."SalesLeadSupportConfig" TO service_role;
REVOKE ALL ON public."SalesLeadSupportConfig" FROM anon;
REVOKE ALL ON public."SalesLeadSupportConfig" FROM authenticated;
