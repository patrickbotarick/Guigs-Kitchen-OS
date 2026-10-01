ALTER TABLE "Order" ADD COLUMN "productionFinishedAt" DATETIME;

CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "metadata" TEXT,
    CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "OrderStatusHistory_orderId_changedAt_idx" ON "OrderStatusHistory"("orderId", "changedAt");

-- Pedidos da Fase 1 passam a ter o evento inicial no histórico.
INSERT INTO "OrderStatusHistory" ("id", "orderId", "fromStatus", "toStatus", "changedAt", "actorType")
SELECT lower(hex(randomblob(12))), "id", NULL, "status", "receivedAt", 'SYSTEM' FROM "Order";
