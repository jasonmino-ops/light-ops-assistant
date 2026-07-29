-- Computer Console closeout:
--   1. soft-disable bound computers without deleting history;
--   2. one-time, short-lived Browser POS launch tickets.

ALTER TABLE "ComputerBinding"
ADD COLUMN "disabledByUserId" TEXT,
ADD COLUMN "disabledAt" TIMESTAMP(3);

CREATE TABLE "ComputerBrowserLaunchTicket" (
    "id" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "ticketHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "browserDeviceIdHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComputerBrowserLaunchTicket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ComputerBrowserLaunchTicket_ticketHash_key"
ON "ComputerBrowserLaunchTicket"("ticketHash");

CREATE INDEX "ComputerBrowserLaunchTicket_bindingId_createdAt_idx"
ON "ComputerBrowserLaunchTicket"("bindingId", "createdAt");

CREATE INDEX "ComputerBrowserLaunchTicket_expiresAt_idx"
ON "ComputerBrowserLaunchTicket"("expiresAt");

CREATE INDEX "ComputerBinding_tenantId_storeId_disabledAt_idx"
ON "ComputerBinding"("tenantId", "storeId", "disabledAt");

CREATE INDEX "ComputerBinding_disabledByUserId_idx"
ON "ComputerBinding"("disabledByUserId");

ALTER TABLE "ComputerBinding"
ADD CONSTRAINT "ComputerBinding_disabledByUserId_fkey"
FOREIGN KEY ("disabledByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ComputerBrowserLaunchTicket"
ADD CONSTRAINT "ComputerBrowserLaunchTicket_bindingId_fkey"
FOREIGN KEY ("bindingId") REFERENCES "ComputerBinding"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
