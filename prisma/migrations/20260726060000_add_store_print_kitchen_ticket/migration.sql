-- Store-level browser kitchen ticket setting. Existing stores stay disabled.
ALTER TABLE "Store"
  ADD COLUMN "printKitchenTicket" BOOLEAN NOT NULL DEFAULT false;
