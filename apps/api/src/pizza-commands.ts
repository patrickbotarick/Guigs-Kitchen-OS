import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { assemblyCommandTransitions, canTransitionPizza, deriveOrderProductionState, isLogisticsOrderStatus, pizzaCommandSchema, pizzaCommandResultSchema, type PizzaCommandInput, type PizzaCommandResult } from '@guigs/shared';
import { loadCompatibleOrder } from './kitchen-data.js';
import { OperatorSessionService, type SessionCredentials } from './operator-sessions.js';

export class PizzaCommandConflictError extends Error {}
export class PizzaCommandNotFoundError extends Error {}
class RetryAggregationError extends Error {}
export class PizzaCommandService {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(orderId: string, pizzaId: string, payload: PizzaCommandInput, credentials?: SessionCredentials): Promise<PizzaCommandResult> {
    const sessions = new OperatorSessionService(this.prisma);
    const actor = await sessions.validate(credentials);
    const input = pizzaCommandSchema.parse(payload);
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
          await sessions.validate(credentials, tx); // Revocation/expiry must also be checked inside the command transaction.
          const previous = await tx.pizzaCommandReceipt.findUnique({ where: { clientCommandId } });
          if (previous) return replay(previous);
          const order = await tx.order.findUnique({ where: { id: orderId } });
          const pizza = await tx.pizzaItem.findUnique({ where: { id: pizzaId } });
          if (!order || order.schemaVersion !== 2 || !pizza || pizza.orderId !== orderId) throw new PizzaCommandNotFoundError('Pizza não encontrada neste pedido v2.');
          const assignmentCommand = input.command === 'CLAIM_PIZZA' || input.command === 'RELEASE_PIZZA';
          const transition = assignmentCommand ? { from: pizza.state, to: pizza.state } : assemblyCommandTransitions[input.command as keyof typeof assemblyCommandTransitions];
          if (isLogisticsOrderStatus(order.status) || order.status === 'CANCELLED' || pizza.state !== input.expectedState || pizza.version !== input.expectedVersion || pizza.state !== transition.from || (!assignmentCommand && !canTransitionPizza(pizza.state, transition.to))) {
            throw new PizzaCommandConflictError('Esta pizza foi atualizada ou o comando não é permitido no estado atual. Recarregue os dados.');
          }
          const owned = pizza.assignedOperatorId === actor.operatorId;
          const eligible = ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'].includes(pizza.state);
          if (!eligible || (pizza.assignedOperatorId && !owned)) throw new PizzaCommandConflictError('Pizza reservada por outro montador ou fora da montagem. Recarregue os dados.');
          if (input.command === 'RELEASE_PIZZA' && (!owned || pizza.state === 'ASSEMBLING')) throw new PizzaCommandConflictError('Somente o responsável pode liberar. Pause a montagem antes de liberar.');
          if (!assignmentCommand && input.command !== 'START_ASSEMBLY' && !owned) throw new PizzaCommandConflictError('Assuma esta pizza antes de executar ações de montagem.');
          // A fresh command confirming an existing own reservation is a no-op, not a second claim event.
          if (input.command === 'CLAIM_PIZZA' && owned) {
            const read = await loadCompatibleOrder(tx, orderId);
            if (!read || read.legacy) throw new Error('Falha na leitura da reserva.');
            const result = pizzaCommandResultSchema.parse({ order: read.order, pizzaId, clientCommandId, replayed: true });
            await tx.pizzaCommandReceipt.create({ data: { clientCommandId, payloadHash: hash, orderId, pizzaId, operatorSessionId: actor.sessionId, responseSnapshot: result as unknown as Prisma.InputJsonValue } });
            return result;
          }
          const now = new Date();
          const claiming = !pizza.assignedOperatorId && (input.command === 'CLAIM_PIZZA' || input.command === 'START_ASSEMBLY');
          const releasing = input.command === 'RELEASE_PIZZA';
          const changed = await tx.pizzaItem.updateMany({ where: { id: pizzaId, orderId, state: input.expectedState, version: input.expectedVersion, assignedOperatorId: pizza.assignedOperatorId }, data: {
            state: transition.to, version: { increment: 1 },
            ...(claiming ? { assignedOperatorId: actor.operatorId, assignedWorkstationId: actor.workstationId, assignedSessionId: actor.sessionId, assignedAt: now } : {}),
            ...(releasing ? { assignedOperatorId: null, assignedWorkstationId: null, assignedSessionId: null, assignedAt: null, releasedAt: now } : {}),
            ...(input.command === 'START_ASSEMBLY' ? { assemblyStartedAt: now } : {}),
            ...(assignmentCommand ? {} : input.command === 'PAUSE_ASSEMBLY' ? { pausedAt: now } : { pausedAt: null }),
            ...(input.command === 'SEND_TO_OVEN' ? { assemblyCompletedAt: now } : {}),
          } });
          if (changed.count !== 1) throw new PizzaCommandConflictError('Esta pizza foi atualizada em outro dispositivo.');
          if (claiming && !assignmentCommand) await tx.pizzaProductionHistory.create({ data: { pizzaId, eventType: 'CLAIMED', fromState: pizza.state, toState: pizza.state, changedAt: now,
            actorType: 'OPERATOR', actorId: actor.operatorId, operatorId: actor.operatorId, workstationId: actor.workstationId, operatorSessionId: actor.sessionId,
            commandId: `${clientCommandId}:claim`, itemVersion: pizza.version + 1, reason: 'Reserva atômica ao iniciar montagem' } });
          await tx.pizzaProductionHistory.create({ data: { pizzaId, eventType: input.command === 'CLAIM_PIZZA' ? 'CLAIMED' : releasing ? 'RELEASED' : input.command, fromState: pizza.state, toState: transition.to, changedAt: now,
            actorType: 'OPERATOR', actorId: actor.operatorId, operatorId: actor.operatorId, workstationId: actor.workstationId, operatorSessionId: actor.sessionId,
            commandId: clientCommandId, itemVersion: pizza.version + 1, reason: 'Comando de montagem via Assembly' } });
          const pizzas = await tx.pizzaItem.findMany({ where: { orderId }, select: { state: true } });
          const extras = await tx.extraItem.findMany({ where: { orderId }, select: { state: true, quantity: true, checkedQuantity: true } });
          const status = deriveOrderProductionState({ pizzas: pizzas.map(pizza => pizza.state), extras, packingConfirmed: Boolean(order.packingFinishedAt && order.packingFinishedBy) });
          const changedOrder = await tx.order.updateMany({ where: { id: orderId, version: order.version }, data: { status, version: { increment: 1 },
            ...(!assignmentCommand && !order.productionStartedAt ? { productionStartedAt: now } : {}) } });
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
