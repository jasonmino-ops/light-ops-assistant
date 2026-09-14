-- ES-PRINT-KITCHEN-ITEM-ROUTING-01
-- Existing and newly imported products remain kitchen-eligible by default.
ALTER TABLE "Product"
  ADD COLUMN "printKitchenTicket" BOOLEAN NOT NULL DEFAULT true;

-- Internal queue-ledger signal only. It is not part of the frozen network-v2
-- payload and lets observability distinguish deliberate suppression from loss.
ALTER TABLE "EshopTrayPrintJob"
  ADD COLUMN "kitchenJobSuppressed" BOOLEAN NOT NULL DEFAULT false;
