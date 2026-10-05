-- CreateTable
CREATE TABLE "PizzaCommandReceipt" (
    "clientCommandId" TEXT NOT NULL PRIMARY KEY,
    "payloadHash" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "pizzaId" TEXT NOT NULL,
    "responseSnapshot" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PizzaCommandReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PizzaCommandReceipt_pizzaId_fkey" FOREIGN KEY ("pizzaId") REFERENCES "PizzaItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
