CREATE TYPE "MarketingProductPageTemplateType" AS ENUM ('TIKTOK_HOT', 'HOME_GOODS', 'FOOD_SET', 'BEAUTY');

ALTER TABLE "MarketingProductPage"
  ADD COLUMN "templateType" "MarketingProductPageTemplateType";
