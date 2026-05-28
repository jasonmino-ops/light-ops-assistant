-- CreateTable
CREATE TABLE "CampaignLink" (
    "id"             TEXT NOT NULL,
    "code"           TEXT NOT NULL,
    "storeId"        TEXT NOT NULL,
    "sourcePlatform" TEXT NOT NULL DEFAULT 'tiktok',
    "creatorName"    TEXT,
    "videoTitle"     TEXT,
    "targetUrl"      TEXT NOT NULL,
    "viewCount"      INTEGER NOT NULL DEFAULT 0,
    "clickCount"     INTEGER NOT NULL DEFAULT 0,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLink_code_key" ON "CampaignLink"("code");

-- CreateIndex
CREATE INDEX "CampaignLink_storeId_idx" ON "CampaignLink"("storeId");

-- AddForeignKey
ALTER TABLE "CampaignLink" ADD CONSTRAINT "CampaignLink_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
