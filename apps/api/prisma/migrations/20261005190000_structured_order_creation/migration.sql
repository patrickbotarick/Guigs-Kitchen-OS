-- CreateTable
CREATE TABLE "StructuredOrderCreation" (
    "clientRequestId" TEXT NOT NULL PRIMARY KEY,
    "payloadHash" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "responseSnapshot" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StructuredOrderCreation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StructuredOrderCreation_orderId_key" ON "StructuredOrderCreation"("orderId");
