-- EP-MB3-06A blocking fix.
-- Split token hash algorithm version from credential rotation version.

ALTER TABLE "DesktopDevice"
  ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 1;
