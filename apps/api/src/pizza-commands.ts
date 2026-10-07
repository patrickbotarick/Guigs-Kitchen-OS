import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { assemblyCommandTransitions, ovenCommandTransitions, canTransitionPizza, deriveOrderProductionState, isLogisticsOrderStatus, pizzaCommandSchema, pizzaCommandResultSchema, type PizzaCommandInput, type PizzaCommandResult } from '@guigs/shared';
import { loadCompatibleOrder } from './kitchen-data.js';
import { OperatorSessionService, type SessionCredentials } from './operator-sessions.js';
import { ovenConfiguration } from './oven-config.js';

export class PizzaCommandConflictError extends Error {}
export class PizzaCommandNotFoundError extends Error {}
class RetryAggregationError extends Error {}
export class PizzaCommandService {
  constructor(private readonly prisma: PrismaClient, private readonly ovenMinutes?: number) {
    ovenConfiguration();
    if (ovenMinutes !== undefined && (!Number.isFinite(ovenMinutes) || ovenMinutes <= 0 || ovenMinutes > 240)) throw new Error('Tempo de forno inválido.');
  }

  async configuration() {
    const configuration = ovenConfiguration();
    const ovenOccupancy = await this.prisma.pizzaItem.count({ where: { state: 'IN_OVEN' } });
    return { ...configuration, ovenOccupancy };
  }

  async execute(orderId: string, pizzaId: string, payload: PizzaCommandInput, credentials?: SessionCredentials): Promise<PizzaCommandResult> {
    const sessions = new OperatorSessionService(this.prisma);
    const actor = await sessions.validate(credentials);
    const input = pizzaCommandSchema.parse(payload);
    const ovenCommand = input.command === 'ENTER_OVEN' || input.command === 'REMOVE_FROM_OVEN' || input.command === 'FINISH_PIZZA';
    if (ovenCommand && actor.view.presenceStatus !== 'ONLINE') throw new PizzaCommandConflictError('Confirme sua presença operacional antes de executar comandos de forno.');
    const { clientCommandId, ...intent } = input;
    const hash = createHash('sha256').update(JSON.stringify({ orderId, pizzaId, ...intent, operatorSessionId: actor.sessionId, operatorId: actor.operatorId, workstationId: actor.workstationId })).digest('hex');
    const replay = (saved: { payloadHash: string; responseSnapshot: Prisma.JsonValue }) => {
      if (saved.payloadHash !== hash) throw new PizzaCommandConflictError('Identificador de comando já utilizado com outro conteúdo.');
      return pizzaCommandResultSchema.parse({ ...(saved.responseSnapshot as object), replayed: true });
    };
    const previous = await this.prisma.pizzaCommandReceipt.findUnique({ where: { clientCommandId } });
    if (previous) return replay(previous);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          const currentActor = await sessions.validate(credentials, tx); // Revocation/expiry must also be checked inside the command transaction.
          if (ovenCommand && currentActor.view.presenceStatus !== 'ONLINE') throw new PizzaCommandConflictError('Confirme sua presença operacional antes de executar comandos de forno.');
          const previous = await tx.pizzaCommandReceipt.findUnique({ where: { clientCommandId } });
          if (previous) return replay(previous);
          const order = await tx.order.findUnique({ where: { id: orderId } });
          const pizza = await tx.pizzaItem.findUnique({ where: { id: pizzaId } });
          if (!order || order.schemaVersion !== 2 || !pizza || pizza.orderId !== orderId) throw new PizzaCommandNotFoundError('Pizza não encontrada neste pedido v2.');
          const assignmentCommand = input.command === 'CLAIM_PIZZA' || input.command === 'RELEASE_PIZZA';
          const allTransitions = { ...assemblyCommandTransitions, ...ovenCommandTransitions };
          const settings = order.operationalFlowVersion === 2 && input.command === 'SEND_TO_OVEN'
            ? await tx.productionStationSettings.findUnique({ where: { stationKey: 'PRODUCTION' } }) : null;
          const directOven = order.operationalFlowVersion === 2 && input.command === 'SEND_TO_OVEN' && (settings?.autoOvenEntry ?? true);
          const transition = assignmentCommand ? { from: pizza.state, to: pizza.state } : directOven ? { from: 'ASSEMBLING' as const, to: 'IN_OVEN' as const } : input.command === 'FINISH_PIZZA' && pizza.state === 'FINISHING' ? { from: 'FINISHING' as const, to: 'FINISHED' as const } : allTransitions[input.command as keyof typeof allTransitions];
          if (order.operationalFlowVersion === 2 && input.command === 'SEND_TO_OVEN' && currentActor.view.presenceStatus !== 'ONLINE') throw new PizzaCommandConflictError('Confirme presença para concluir montagem.');
          if (isLogisticsOrderStatus(order.status) || order.status === 'CANCELLED' || pizza.state !== input.expectedState || pizza.version !== input.expectedVersion || pizza.state !== transition.from || (!assignmentCommand && !canTransitionPizza(pizza.state, transition.to))) {
            throw new PizzaCommandConflictError('Esta pizza foi atualizada ou o comando não é permitido no estado atual. Recarregue os dados.');
          }
          const owned = pizza.assignedOperatorId === actor.operatorId;
          const eligible = ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'].includes(pizza.state);
          if (!ovenCommand && (!eligible || (pizza.assignedOperatorId && !owned))) throw new PizzaCommandConflictError('Pizza reservada por outro montador ou fora da montagem. Recarregue os dados.');
          if (input.command === 'RELEASE_PIZZA' && (!owned || pizza.state === 'ASSEMBLING')) throw new PizzaCommandConflictError('Somente o responsável pode liberar. Pause a montagem antes de liberar.');
          if (!ovenCommand && !assignmentCommand && input.command !== 'START_ASSEMBLY' && !owned) throw new PizzaCommandConflictError('Assuma esta pizza antes de executar ações de montagem.');
          // A fresh command confirming an existing own reservation is a no-op, not a second claim event.
          if (input.command === 'CLAIM_PIZZA' && owned) {
            const read = await loadCompatibleOrder(tx, orderId);
            if (!read || read.legacy) throw new Error('Falha na leitura da reserva.');
            const result = pizzaCommandResultSchema.parse({ order: read.order, pizzaId, clientCommandId, replayed: true });
            await tx.pizzaCommandReceipt.create({ data: { clientCommandId, payloadHash: hash, orderId, pizzaId, operatorSessionId: actor.sessionId, responseSnapshot: result as unknown as Prisma.InputJsonValue } });
            return result;
          }
          const oven = ovenConfiguration();
          if (order.operationalFlowVersion === 1 && input.command === 'ENTER_OVEN' && oven.ovenCapacity !== null) {
            // Count and CAS write share the SQLite transaction. A competing writer
            // cannot commit against this stale snapshot: retry rechecks capacity.
            const occupied = await tx.pizzaItem.count({ where: { state: 'IN_OVEN' } });
            if (occupied >= oven.ovenCapacity) throw new PizzaCommandConflictError('Forno cheio. Aguarde uma retirada antes de colocar outra pizza.');
          }
          const now = new Date();
          const claiming = !pizza.assignedOperatorId && (input.command === 'CLAIM_PIZZA' || input.command === 'START_ASSEMBLY');
          const releasing = input.command === 'RELEASE_PIZZA';
          const changed = await tx.pizzaItem.updateMany({ where: { id: pizzaId, orderId, state: input.expectedState, version: input.expectedVersion, assignedOperatorId: pizza.assignedOperatorId }, data: {
            state: transition.to, version: { increment: 1 },
            ...(claiming ? { assignedOperatorId: actor.operatorId, assignedWorkstationId: actor.workstationId, assignedSessionId: actor.sessionId, assignedAt: now } : {}),
            ...(releasing ? { assignedOperatorId: null, assignedWorkstationId: null, assignedSessionId: null, assignedAt: null, releasedAt: now } : {}),
            ...(input.command === 'START_ASSEMBLY' ? { assemblyStartedAt: now } : {}),
            ...(assignmentCommand || ovenCommand ? {} : input.command === 'PAUSE_ASSEMBLY' ? { pausedAt: now } : { pausedAt: null }),
            ...(input.command === 'SEND_TO_OVEN' ? { assemblyCompletedAt: now } : {}),
            ...(input.command === 'ENTER_OVEN' || directOven ? { ovenStartedAt: now, ovenExpectedEndAt: new Date(now.getTime() + (this.ovenMinutes ?? oven.defaultOvenMinutes) * 60000) } : {}),
            ...(input.command === 'REMOVE_FROM_OVEN' ? { bakedAt: now } : {}),
            ...(input.command === 'FINISH_PIZZA' ? { finishingStartedAt: pizza.finishingStartedAt ?? pizza.bakedAt ?? now, finishedAt: now } : {}),
            ...(order.operationalFlowVersion === 2 && input.command === 'SEND_TO_OVEN' ? { releasedAt: now } : {}),
          } });
          if (changed.count !== 1) throw new PizzaCommandConflictError('Esta pizza foi atualizada em outro dispositivo.');
          if (claiming && !assignmentCommand) await tx.pizzaProductionHistory.create({ data: { pizzaId, eventType: 'CLAIMED', fromState: pizza.state, toState: pizza.state, changedAt: now,
            actorType: 'OPERATOR', actorId: actor.operatorId, operatorId: actor.operatorId, workstationId: actor.workstationId, operatorSessionId: actor.sessionId,
            commandId: `${clientCommandId}:claim`, itemVersion: pizza.version + 1, reason: 'Reserva atômica ao iniciar montagem' } });
          await tx.pizzaProductionHistory.create({ data: { pizzaId, eventType: input.command === 'CLAIM_PIZZA' ? 'CLAIMED' : releasing ? 'RELEASED' : input.command === 'FINISH_PIZZA' ? 'PIZZA_FINISHED' : input.command, fromState: pizza.state, toState: transition.to, changedAt: now,
            actorType: 'OPERATOR', actorId: actor.operatorId, operatorId: actor.operatorId, workstationId: actor.workstationId, operatorSessionId: actor.sessionId,
            commandId: clientCommandId, itemVersion: pizza.version + 1, reason: ovenCommand ? 'Comando operacional de forno/acabamento' : 'Comando de montagem via Assembly', ...(input.command === 'SEND_TO_OVEN' && order.operationalFlowVersion === 2 ? { metadata: { assemblyCompleted: true, ovenStarted: directOven, autoOvenEntry: directOven, productionSettingsVersion: settings?.version ?? 0, capacityPolicy: 'INDICATOR' } } : {}) } });
          const pizzas = await tx.pizzaItem.findMany({ where: { orderId }, select: { state: true } });
          const extras = await tx.extraItem.findMany({ where: { orderId }, select: { state: true, quantity: true, checkedQuantity: true } });
          const status = deriveOrderProductionState({ pizzas: pizzas.map(pizza => pizza.state), extras, packingConfirmed: Boolean(order.packingFinishedAt && order.packingFinishedBy) });
          const changedOrder = await tx.order.updateMany({ where: { id: orderId, version: order.version }, data: { status, version: { increment: 1 },
            ...(!assignmentCommand && !ovenCommand && !order.productionStartedAt ? { productionStartedAt: now } : {}) } });
          if (changedOrder.count !== 1) throw new RetryAggregationError();
          if (status !== order.status) await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: status, changedAt: now, actorType: 'OPERATOR', actorId: actor.operatorId, metadata: JSON.stringify({ command: input.command, clientCommandId, pizzaId, operatorSessionId: actor.sessionId, workstationId: actor.workstationId }) } });
          const read = await loadCompatibleOrder(tx, orderId);
          if (!read || read.legacy) throw new Error('Falha na leitura do pedido atualizado.');
          const result = pizzaCommandResultSchema.parse({ order: read.order, pizzaId, clientCommandId, replayed: false });
          await tx.pizzaCommandReceipt.create({ data: { clientCommandId, payloadHash: hash, orderId, pizzaId, operatorSessionId: actor.sessionId, responseSnapshot: result as unknown as Prisma.InputJsonValue } });
          return result;
        }, { timeout: 10000, maxWait: 5000 });
      } catch (error) {
        const retryable = error instanceof RetryAggregationError || (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034', 'P2028', 'P1008'].includes(error.code));
        if (!retryable) throw error;
        const previous = await this.prisma.pizzaCommandReceipt.findUnique({ where: { clientCommandId } });
        if (previous) return replay(previous);
        if (attempt === 3) throw error;
        await new Promise(done => setTimeout(done, 50 * (attempt + 1)));
      }
    }
    throw new Error('Não foi possível executar o comando.');
  }
}
