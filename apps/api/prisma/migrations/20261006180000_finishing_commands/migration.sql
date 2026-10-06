-- Additive receipt store. Existing orders, items and audit records are preserved.
CREATE TABLE "FinishingCommandReceipt" (
    "clientCommandId" TEXT NOT NULL PRIMARY KEY,
    "payloadHash" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "responseSnapshot" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinishingCommandReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "FinishingCommandReceipt_orderId_createdAt_idx" ON "FinishingCommandReceipt"("orderId", "createdAt");
