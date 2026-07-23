-- EP-BR-LINK-AUTH-01: retain minimal owner-visible Browser POS device metadata.
-- Additive only; existing BrowserPosDevice rows remain valid.
ALTER TABLE "BrowserPosDevice"
ADD COLUMN "displayName" TEXT,
ADD COLUMN "browserInfo" TEXT;
