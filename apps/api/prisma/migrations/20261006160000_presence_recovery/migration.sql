ALTER TABLE "Operator" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'ASSEMBLER';
ALTER TABLE "OperatorSession" ADD COLUMN "lastSeenAt" DATETIME;
ALTER TABLE "OperatorSession" ADD COLUMN "presenceStatus" TEXT NOT NULL DEFAULT 'OFFLINE';
CREATE TABLE "OperatorSessionEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "presenceStatus" TEXT NOT NULL,
  "available" BOOLEAN NOT NULL,
  "metadata" JSONB,
  CONSTRAINT "OperatorSessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OperatorSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OperatorSessionEvent_sessionId_changedAt_idx" ON "OperatorSessionEvent"("sessionId", "changedAt");
