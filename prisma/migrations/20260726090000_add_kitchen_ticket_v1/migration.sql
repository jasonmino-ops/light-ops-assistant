-- EP-BR-KITCHEN-TICKET-01: safe-by-default kitchen ticket configuration,
-- immutable line snapshots, client submission idempotency and minimal print audit.
CREATE TYPE "TicketType" AS ENUM ('CUSTOMER_RECEIPT', 'KITCHEN_TICKET');
CREATE TYPE "TicketPrintTrigger" AS ENUM ('ORIGINAL', 'REPRINT');
CREATE TYPE "TicketPrintDispatchStatus" AS ENUM ('CLAIMED', 'OPENED', 'FAILED', 'UNKNOWN');

ALTER TABLE "Store"
  ADD COLUMN "kitchenTicketEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Product"
  ADD COLUMN "printToKitchen" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "SaleRecord"
  ADD COLUMN "printToKitchenSnapshot" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PaymentIntent"
  ADD COLUMN "clientSubmissionKey" TEXT;

CREATE UNIQUE INDEX "PaymentIntent_tenantId_storeId_clientSubmissionKey_key"
  ON "PaymentIntent"("tenantId", "storeId", "clientSubmissionKey");

CREATE TABLE "TicketPrintDispatch" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "orderNo" TEXT NOT NULL,
  "ticketType" "TicketType" NOT NULL,
  "trigger" "TicketPrintTrigger" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "TicketPrintDispatchStatus" NOT NULL DEFAULT 'CLAIMED',
  "error" TEXT,
  "openedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TicketPrintDispatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TicketPrintDispatch_idempotencyKey_key"
  ON "TicketPrintDispatch"("idempotencyKey");
CREATE INDEX "TicketPrintDispatch_tenantId_storeId_orderNo_idx"
  ON "TicketPrintDispatch"("tenantId", "storeId", "orderNo");
CREATE INDEX "TicketPrintDispatch_orderNo_ticketType_trigger_idx"
  ON "TicketPrintDispatch"("orderNo", "ticketType", "trigger");

ALTER TABLE "TicketPrintDispatch"
  ADD CONSTRAINT "TicketPrintDispatch_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
