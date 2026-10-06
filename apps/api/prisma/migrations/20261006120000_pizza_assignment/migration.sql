ALTER TABLE "PizzaItem" ADD COLUMN "assignedOperatorId" TEXT REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PizzaItem" ADD COLUMN "assignedWorkstationId" TEXT REFERENCES "Workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PizzaItem" ADD COLUMN "assignedSessionId" TEXT REFERENCES "OperatorSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PizzaItem" ADD COLUMN "assignedAt" DATETIME;
ALTER TABLE "PizzaItem" ADD COLUMN "releasedAt" DATETIME;
CREATE INDEX "PizzaItem_assignedOperatorId_state_idx" ON "PizzaItem"("assignedOperatorId", "state");
