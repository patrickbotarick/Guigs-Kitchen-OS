-- Additive only: preserve all historical rows and existing workstationId values.
CREATE TABLE "Operator" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "pinHash" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Operator_name_key" ON "Operator"("name");
CREATE TABLE "Workstation" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "deviceKey" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Workstation_deviceKey_key" ON "Workstation"("deviceKey");
CREATE TABLE "OperatorSession" (
  "id" TEXT NOT NULL PRIMARY KEY, "operatorId" TEXT NOT NULL, "workstationId" TEXT NOT NULL, "tokenHash" TEXT NOT NULL,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" DATETIME, "expiresAt" DATETIME NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "OperatorSession_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatorSession_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OperatorSession_tokenHash_key" ON "OperatorSession"("tokenHash");
CREATE INDEX "OperatorSession_workstationId_active_idx" ON "OperatorSession"("workstationId", "active");
CREATE INDEX "OperatorSession_operatorId_startedAt_idx" ON "OperatorSession"("operatorId", "startedAt");
ALTER TABLE "PizzaProductionHistory" ADD COLUMN "operatorId" TEXT REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PizzaProductionHistory" ADD COLUMN "operatorSessionId" TEXT REFERENCES "OperatorSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PizzaCommandReceipt" ADD COLUMN "operatorSessionId" TEXT REFERENCES "OperatorSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PizzaProductionHistory_operatorId_changedAt_idx" ON "PizzaProductionHistory"("operatorId", "changedAt");
