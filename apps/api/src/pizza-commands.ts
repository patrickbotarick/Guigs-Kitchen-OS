import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { assemblyCommandTransitions, canTransitionPizza, deriveOrderProductionState, isLogisticsOrderStatus, pizzaCommandSchema, pizzaCommandResultSchema, type PizzaCommandInput, type PizzaCommandResult } from '@guigs/shared';
import { loadCompatibleOrder } from './kitchen-data.js';

export class PizzaCommandConflictError extends Error {}
export class PizzaCommandNotFoundError extends Error {}
class RetryAggregationError extends Error {}
export class PizzaCommandService {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(orderId: string, pizzaId: string, payload: PizzaCommandInput): Promise<PizzaCommandResult> {
    const input = pizzaCommandSchema.parse(payload);
    const { clientCommandId, ...intent } = input;
    const hash = createHash('sha256').update(JSON.stringify({ orderId, pizzaId, ...intent })).digest('hex');
    const replay = (saved: { payloadHash: string; responseSnapshot: Prisma.JsonValue }) => {
      if (saved.payloadHash !== hash) throw new PizzaCommandConflictError('Identificador de comando já utilizado com outro conteúdo.');
      return pizzaCommandResultSchema.parse({ ...(saved.responseSnapshot as object), replayed: true });
    };
    const previous = await this.prisma.pizzaCommandReceipt.findUnique({ where: { clientCommandId } });
    if (previous) return replay(previous);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          const previous = await tx.pizzaCommandReceipt.findUnique({ where: { clientCommandId } });
          if (previous) return replay(previous);
          const order = await tx.order.findUnique({ where: { id: orderId } });
          const pizza = await tx.pizzaItem.findUnique({ where: { id: pizzaId } });
          if (!order || order.schemaVersion !== 2 || !pizza || pizza.orderId !== orderId) throw new PizzaCommandNotFoundError('Pizza não encontrada neste pedido v2.');
          const transition = assemblyCommandTransitions[input.command];
          if (isLogisticsOrderStatus(order.status) || order.status === 'CANCELLED' || pizza.state !== input.expectedState || pizza.version !== input.expectedVersion || pizza.state !== transition.from || !canTransitionPizza(pizza.state, transition.to)) {
            throw new PizzaCommandConflictError('Esta pizza foi atualizada ou o comando não é permitido no estado atual. Recarregue os dados.');
          }
          const now = new Date();
          const changed = await tx.pizzaItem.updateMany({ where: { id: pizzaId, orderId, state: input.expectedState, version: input.expectedVersion }, data: {
            state: transition.to, version: { increment: 1 },
            ...(input.command === 'START_ASSEMBLY' ? { assemblyStartedAt: now } : {}),
            ...(input.command === 'PAUSE_ASSEMBLY' ? { pausedAt: now } : { pausedAt: null }),
            ...(input.command === 'SEND_TO_OVEN' ? { assemblyCompletedAt: now } : {}),
          } });
          if (changed.count !== 1) throw new PizzaCommandConflictError('Esta pizza foi atualizada em outro dispositivo.');
          await tx.pizzaProductionHistory.create({ data: { pizzaId, eventType: input.command, fromState: pizza.state, toState: transition.to, changedAt: now,
            actorType: 'SYSTEM', commandId: clientCommandId, itemVersion: pizza.version + 1, reason: 'Comando de montagem via Assembly' } });
          const pizzas = await tx.pizzaItem.findMany({ where: { orderId }, select: { state: true } });
          const extras = await tx.extraItem.findMany({ where: { orderId }, select: { state: true, quantity: true, checkedQuantity: true } });
          const status = deriveOrderProductionState({ pizzas: pizzas.map(pizza => pizza.state), extras, packingConfirmed: Boolean(order.packingFinishedAt && order.packingFinishedBy) });
          const changedOrder = await tx.order.updateMany({ where: { id: orderId, version: order.version }, data: { status, version: { increment: 1 },
            ...(!order.productionStartedAt ? { productionStartedAt: now } : {}) } });
          if (changedOrder.count !== 1) throw new RetryAggregationError();
          if (status !== order.status) await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: status, changedAt: now, actorType: 'SYSTEM', metadata: JSON.stringify({ command: input.command, clientCommandId, pizzaId }) } });
          const read = await loadCompatibleOrder(tx, orderId);
          if (!read || read.legacy) throw new Error('Falha na leitura do pedido atualizado.');
          const result = pizzaCommandResultSchema.parse({ order: read.order, pizzaId, clientCommandId, replayed: false });
          await tx.pizzaCommandReceipt.create({ data: { clientCommandId, payloadHash: hash, orderId, pizzaId, responseSnapshot: result as unknown as Prisma.InputJsonValue } });
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
