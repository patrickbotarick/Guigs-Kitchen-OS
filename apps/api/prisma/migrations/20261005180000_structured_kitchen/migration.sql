-- CreateTable
CREATE TABLE "PizzaItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "size" TEXT NOT NULL,
    "composition" TEXT NOT NULL,
    "crustId" TEXT NOT NULL,
    "catalogRevisionId" TEXT NOT NULL,
    "recipeSnapshot" JSONB NOT NULL,
    "notes" TEXT,
    "state" TEXT NOT NULL DEFAULT 'WAITING_ASSEMBLY',
    "version" INTEGER NOT NULL DEFAULT 0,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assemblyStartedAt" DATETIME,
    "pausedAt" DATETIME,
    "assemblyCompletedAt" DATETIME,
    "ovenStartedAt" DATETIME,
    "ovenExpectedEndAt" DATETIME,
    "bakedAt" DATETIME,
    "finishingStartedAt" DATETIME,
    "finishedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PizzaItem_recipe_check" CHECK ("size" IN ('BROTO', 'GRANDE') AND "composition" IN ('WHOLE', 'HALF_HALF') AND ("size" <> 'BROTO' OR "composition" = 'WHOLE')),
    CONSTRAINT "PizzaItem_position_check" CHECK ("position" >= 0 AND "version" >= 0),
    CONSTRAINT "PizzaItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PizzaHalf" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pizzaId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "flavorId" TEXT NOT NULL,
    CONSTRAINT "PizzaHalf_position_check" CHECK ("position" IN (1, 2)),
    CONSTRAINT "PizzaHalf_pizzaId_fkey" FOREIGN KEY ("pizzaId") REFERENCES "PizzaItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PizzaIngredientModifier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "halfId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    CONSTRAINT "PizzaIngredientModifier_halfId_fkey" FOREIGN KEY ("halfId") REFERENCES "PizzaHalf" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExtraItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "extraCatalogId" TEXT NOT NULL,
    "catalogRevisionId" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "state" TEXT NOT NULL DEFAULT 'WAITING_FINISHING',
    "checkedQuantity" INTEGER NOT NULL DEFAULT 0,
    "checkedAt" DATETIME,
    "checkedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExtraItem_quantity_check" CHECK ("quantity" BETWEEN 1 AND 30 AND "checkedQuantity" BETWEEN 0 AND "quantity" AND "position" >= 0 AND "version" >= 0),
    CONSTRAINT "ExtraItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PizzaProductionHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pizzaId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "workstationId" TEXT,
    "commandId" TEXT NOT NULL,
    "itemVersion" INTEGER NOT NULL,
    "reason" TEXT,
    CONSTRAINT "PizzaProductionHistory_pizzaId_fkey" FOREIGN KEY ("pizzaId") REFERENCES "PizzaItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Add only: preserve existing rows, columns, indices and foreign keys.
ALTER TABLE "Order" ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Order" ADD COLUMN "structuredChannel" TEXT;
ALTER TABLE "Order" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "packingFinishedBy" TEXT;

-- CreateIndex
CREATE INDEX "PizzaItem_state_queuedAt_idx" ON "PizzaItem"("state", "queuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PizzaItem_orderId_position_key" ON "PizzaItem"("orderId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PizzaHalf_pizzaId_position_key" ON "PizzaHalf"("pizzaId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PizzaIngredientModifier_halfId_type_ingredientId_key" ON "PizzaIngredientModifier"("halfId", "type", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtraItem_orderId_position_key" ON "ExtraItem"("orderId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PizzaProductionHistory_commandId_key" ON "PizzaProductionHistory"("commandId");

-- CreateIndex
CREATE INDEX "PizzaProductionHistory_pizzaId_changedAt_idx" ON "PizzaProductionHistory"("pizzaId", "changedAt");
