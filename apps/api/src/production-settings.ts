import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { productionSettingsSchema, productionSettingsCommandSchema, type ProductionSettings, type ProductionSettingsCommand } from '@guigs/shared';
import { OperatorSessionService, transactionRetry, type SessionCredentials } from './operator-sessions.js';
import { PizzaCommandConflictError } from './pizza-commands.js';

export class ProductionSettingsService {
  constructor(private readonly prisma: PrismaClient) {}
  async get(): Promise<ProductionSettings> {
    const row = await this.prisma.productionStationSettings.findUnique({ where: { stationKey: 'PRODUCTION' } });
    return productionSettingsSchema.parse({ stationKey: 'PRODUCTION', autoOvenEntry: row?.autoOvenEntry ?? true, version: row?.version ?? 0 });
  }
  async execute(payload: ProductionSettingsCommand, credentials?: SessionCredentials) {
    const input = productionSettingsCommandSchema.parse(payload), sessions = new OperatorSessionService(this.prisma);
    const actor = await sessions.validate(credentials);
    const { clientCommandId, ...intent } = input;
    const hash = createHash('sha256').update(JSON.stringify({ ...intent, sessionId: actor.sessionId })).digest('hex');
    return transactionRetry(this.prisma, async tx => {
      const currentActor = await sessions.validate(credentials, tx);
      if (currentActor.view.presenceStatus !== 'ONLINE') throw new PizzaCommandConflictError('Confirme presença para alterar a estação.');
      const receipt = await tx.productionSettingsReceipt.findUnique({ where: { clientCommandId } });
      if (receipt) {
        if (receipt.payloadHash !== hash) throw new PizzaCommandConflictError('Identificador já usado com outro conteúdo.');
        return { productionSettings: productionSettingsSchema.parse(receipt.responseSnapshot), clientCommandId, replayed: true };
      }
      const row = await tx.productionStationSettings.upsert({ where: { stationKey: 'PRODUCTION' }, create: { stationKey: 'PRODUCTION' }, update: {} });
      if (row.version !== input.expectedVersion) throw new PizzaCommandConflictError('Configuração atualizada em outro terminal.');
      const now = new Date();
      const updated = await tx.productionStationSettings.updateMany({ where: { stationKey: 'PRODUCTION', version: input.expectedVersion }, data: {
        autoOvenEntry: input.autoOvenEntry, version: { increment: 1 }, updatedAt: now,
        updatedByOperatorId: actor.operatorId, updatedByWorkstationId: actor.workstationId, updatedBySessionId: actor.sessionId,
      } });
      if (updated.count !== 1) throw new PizzaCommandConflictError('Configuração atualizada em outro terminal.');
      await tx.operatorSessionEvent.create({ data: {
        sessionId: actor.sessionId, eventType: 'PRODUCTION_SETTINGS_CHANGED', changedAt: now,
        presenceStatus: currentActor.view.presenceStatus, available: currentActor.view.available,
        metadata: { stationKey: 'PRODUCTION', previousAutoOvenEntry: row.autoOvenEntry, autoOvenEntry: input.autoOvenEntry, version: row.version + 1, clientCommandId, workstationId: actor.workstationId, operatorId: actor.operatorId },
      } });
      const productionSettings: ProductionSettings = { stationKey: 'PRODUCTION', autoOvenEntry: input.autoOvenEntry, version: row.version + 1 };
      await tx.productionSettingsReceipt.create({ data: { clientCommandId, payloadHash: hash, responseSnapshot: productionSettings as unknown as Prisma.InputJsonValue } });
      return { productionSettings, clientCommandId, replayed: false };
    });
  }
}
