ALTER TABLE "OperatorSession" ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PizzaProductionHistory" ADD COLUMN "metadata" JSONB;
