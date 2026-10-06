ALTER TABLE "Order" ADD COLUMN "dispatchReadyAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "pickupReadyAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "pickedUpAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "completedAt" DATETIME;
CREATE TABLE "DispatchCommandReceipt" (
  "clientCommandId" TEXT NOT NULL PRIMARY KEY,
  "payloadHash" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "responseSnapshot" JSONB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DispatchCommandReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DispatchCommandReceipt_orderId_createdAt_idx" ON "DispatchCommandReceipt"("orderId", "createdAt");
