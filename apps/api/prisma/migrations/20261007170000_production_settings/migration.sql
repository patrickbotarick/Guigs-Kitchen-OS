CREATE TABLE "ProductionStationSettings" (
  "stationKey" TEXT NOT NULL PRIMARY KEY,
  "autoOvenEntry" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL,
  "updatedByOperatorId" TEXT,
  "updatedByWorkstationId" TEXT,
  "updatedBySessionId" TEXT
);
INSERT INTO "ProductionStationSettings" ("stationKey", "updatedAt") VALUES ('PRODUCTION', CURRENT_TIMESTAMP);
CREATE TABLE "ProductionSettingsReceipt" (
  "clientCommandId" TEXT NOT NULL PRIMARY KEY,
  "payloadHash" TEXT NOT NULL,
  "responseSnapshot" JSONB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
