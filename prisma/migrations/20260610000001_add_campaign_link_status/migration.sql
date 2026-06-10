ALTER TABLE "CampaignLink"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "CampaignLink_status_idx" ON "CampaignLink"("status");
