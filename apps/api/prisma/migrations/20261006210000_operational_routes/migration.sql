ALTER TABLE "Order" ADD COLUMN "operationalFlowVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PizzaItem" ADD COLUMN "counterCheckedAt" DATETIME;
ALTER TABLE "PizzaItem" ADD COLUMN "counterCheckedBy" TEXT;
CREATE TABLE "DispatchRouteCounter" ("id" INTEGER NOT NULL PRIMARY KEY, "value" INTEGER NOT NULL);
CREATE TABLE "DispatchRoute" (
 "id" TEXT NOT NULL PRIMARY KEY, "routeNumber" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN', "version" INTEGER NOT NULL DEFAULT 0,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "closedAt" DATETIME, "reopenedAt" DATETIME, "dispatchedAt" DATETIME,
 "createdByOperatorId" TEXT NOT NULL, "workstationId" TEXT NOT NULL, "sessionId" TEXT NOT NULL
);
CREATE UNIQUE INDEX "DispatchRoute_routeNumber_key" ON "DispatchRoute"("routeNumber");
CREATE TABLE "DispatchRouteItem" (
 "pizzaId" TEXT NOT NULL PRIMARY KEY, "routeId" TEXT NOT NULL, "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "DispatchRouteItem_pizzaId_fkey" FOREIGN KEY ("pizzaId") REFERENCES "PizzaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "DispatchRouteItem_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "DispatchRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DispatchRouteItem_routeId_idx" ON "DispatchRouteItem"("routeId");
CREATE TABLE "DispatchRouteHistory" (
 "id" TEXT NOT NULL PRIMARY KEY, "routeId" TEXT NOT NULL, "eventType" TEXT NOT NULL, "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "operatorId" TEXT NOT NULL, "workstationId" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "commandId" TEXT NOT NULL, "version" INTEGER NOT NULL, "metadata" JSONB NOT NULL,
 CONSTRAINT "DispatchRouteHistory_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "DispatchRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DispatchRouteHistory_routeId_changedAt_idx" ON "DispatchRouteHistory"("routeId", "changedAt");
CREATE TABLE "DispatchRouteReceipt" ("clientCommandId" TEXT NOT NULL PRIMARY KEY, "payloadHash" TEXT NOT NULL, "responseSnapshot" JSONB NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
