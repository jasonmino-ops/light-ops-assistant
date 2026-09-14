-- CreateTable
CREATE TABLE "ProductBulkImportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceFileName" VARCHAR(255) NOT NULL,
    "sourceMimeType" VARCHAR(127) NOT NULL,
    "sourceFormat" VARCHAR(16) NOT NULL,
    "sourceFileSize" INTEGER NOT NULL,
    "sourceFileHash" CHAR(64),
    "stagingStorageKey" VARCHAR(512) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'AWAITING_UPLOAD',
    "version" INTEGER NOT NULL DEFAULT 0,
    "analysisRevision" INTEGER NOT NULL DEFAULT 0,
    "totalRowCount" INTEGER NOT NULL DEFAULT 0,
    "analyzedRowCount" INTEGER NOT NULL DEFAULT 0,
    "readyRowCount" INTEGER NOT NULL DEFAULT 0,
    "invalidRowCount" INTEGER NOT NULL DEFAULT 0,
    "confirmedRowCount" INTEGER NOT NULL DEFAULT 0,
    "failedRowCount" INTEGER NOT NULL DEFAULT 0,
    "analyzeAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "confirmAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "cleanupAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(64),
    "lastErrorMessage" TEXT,
    "analysisMetadata" JSONB,
    "resultSummary" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "analyzedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "stagingCleanedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductBulkImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBulkImportRow" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceOrdinal" INTEGER NOT NULL,
    "sourceSheetIndex" INTEGER,
    "sourceSheetName" VARCHAR(255),
    "sourceRowNumber" INTEGER,
    "sourcePageNumber" INTEGER,
    "stableSourceRowIdentity" CHAR(64) NOT NULL,
    "sourcePayload" JSONB NOT NULL,
    "previewPayload" JSONB NOT NULL,
    "validationIssues" JSONB NOT NULL,
    "aiMetadata" JSONB,
    "assignedBarcode" TEXT,
    "barcodeOrigin" VARCHAR(16),
    "action" VARCHAR(16),
    "imagePlan" JSONB,
    "imageResult" JSONB,
    "status" VARCHAR(32) NOT NULL DEFAULT 'ANALYZED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(64),
    "lastErrorMessage" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductBulkImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductGeneratedBarcode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceFileHash" CHAR(64) NOT NULL,
    "stableSourceRowIdentity" CHAR(64) NOT NULL,
    "assignedBarcode" VARCHAR(13) NOT NULL,
    "reuseCount" INTEGER NOT NULL DEFAULT 0,
    "lastReusedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductGeneratedBarcode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductBulkImportJob_stagingStorageKey_key" ON "ProductBulkImportJob"("stagingStorageKey");

-- CreateIndex
CREATE INDEX "ProductBulkImportJob_tenantId_status_updatedAt_idx" ON "ProductBulkImportJob"("tenantId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ProductBulkImportJob_tenantId_sourceFileHash_idx" ON "ProductBulkImportJob"("tenantId", "sourceFileHash");

-- CreateIndex
CREATE INDEX "ProductBulkImportJob_expiresAt_idx" ON "ProductBulkImportJob"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBulkImportJob_id_tenantId_key" ON "ProductBulkImportJob"("id", "tenantId");

-- CreateIndex
CREATE INDEX "ProductBulkImportRow_jobId_status_id_idx" ON "ProductBulkImportRow"("jobId", "status", "id");

-- CreateIndex
CREATE INDEX "ProductBulkImportRow_tenantId_status_updatedAt_idx" ON "ProductBulkImportRow"("tenantId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBulkImportRow_jobId_sourceOrdinal_key" ON "ProductBulkImportRow"("jobId", "sourceOrdinal");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBulkImportRow_jobId_stableSourceRowIdentity_key" ON "ProductBulkImportRow"("jobId", "stableSourceRowIdentity");

-- CreateIndex
CREATE INDEX "ProductGeneratedBarcode_tenantId_sourceFileHash_idx" ON "ProductGeneratedBarcode"("tenantId", "sourceFileHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProductGeneratedBarcode_tenantId_sourceFileHash_stableSourc_key" ON "ProductGeneratedBarcode"("tenantId", "sourceFileHash", "stableSourceRowIdentity");

-- CreateIndex
CREATE UNIQUE INDEX "ProductGeneratedBarcode_tenantId_assignedBarcode_key" ON "ProductGeneratedBarcode"("tenantId", "assignedBarcode");

-- AddForeignKey
ALTER TABLE "ProductBulkImportJob" ADD CONSTRAINT "ProductBulkImportJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBulkImportRow" ADD CONSTRAINT "ProductBulkImportRow_jobId_tenantId_fkey" FOREIGN KEY ("jobId", "tenantId") REFERENCES "ProductBulkImportJob"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBulkImportRow" ADD CONSTRAINT "ProductBulkImportRow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductGeneratedBarcode" ADD CONSTRAINT "ProductGeneratedBarcode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Application-only import state. No Data API policies are created: browser
-- clients must use authenticated server routes and never access these tables.
ALTER TABLE "ProductBulkImportJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductBulkImportRow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductGeneratedBarcode" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."ProductBulkImportJob" TO service_role;
REVOKE ALL ON public."ProductBulkImportJob" FROM anon;
REVOKE ALL ON public."ProductBulkImportJob" FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."ProductBulkImportRow" TO service_role;
REVOKE ALL ON public."ProductBulkImportRow" FROM anon;
REVOKE ALL ON public."ProductBulkImportRow" FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."ProductGeneratedBarcode" TO service_role;
REVOKE ALL ON public."ProductGeneratedBarcode" FROM anon;
REVOKE ALL ON public."ProductGeneratedBarcode" FROM authenticated;
