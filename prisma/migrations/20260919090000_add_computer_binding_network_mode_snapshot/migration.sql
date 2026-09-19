ALTER TABLE "ComputerBinding"
  ADD COLUMN "lastNetworkMode" VARCHAR(20),
  ADD COLUMN "lastNetworkModeAt" TIMESTAMP(3);

ALTER TABLE "ComputerBinding"
  ADD CONSTRAINT "ComputerBinding_lastNetworkMode_check"
  CHECK (
    "lastNetworkMode" IS NULL
    OR "lastNetworkMode" IN ('FRONT_ONLY', 'SHARED_PRINTER')
  );
