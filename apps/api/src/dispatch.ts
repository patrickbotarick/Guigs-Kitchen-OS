import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { dispatchCommandSchema, dispatchCommandResultSchema, dispatchTransitions, kitchenOrderUpdatedSchema, type DispatchCommandInput, type DispatchCommandResult, type KitchenNotification } from '@guigs/shared';
import { OperatorSessionService, type SessionCredentials } from './operator-sessions.js';
import { PizzaCommandConflictError, PizzaCommandNotFoundError } from './pizza-commands.js';
import { loadCompatibleOrder } from './kitchen-data.js';

export function dispatchNotifications(result: DispatchCommandResult): KitchenNotification[] {
  return result.replayed ? [] : [{ type: 'kitchen.order.updated', payload: kitchenOrderUpdatedSchema.parse({ schemaVersion: 1, eventId: randomUUID(), orderId: result.order.id, status: result.order.status, version: result.order.version, commandId: result.clientCommandId, timestamp: new Date().toISOString() }) }];
}
export class DispatchService {
  constructor(private readonly prisma: PrismaClient) {}
  async execute(orderId: string, payload: DispatchCommandInput, credentials?: SessionCredentials): Promise<DispatchCommandResult> {
    const sessions = new OperatorSessionService(this.prisma), actor = await sessions.validate(credentials), input = dispatchCommandSchema.parse(payload);
    if (actor.view.presenceStatus !== 'ONLINE') throw new PizzaCommandConflictError('Confirme sua presença antes de operar o despacho.');
    const { clientCommandId, ...intent } = input;
    const hash = createHash('sha256').update(JSON.stringify({ orderId, ...intent, sessionId: actor.sessionId, operatorId: actor.operatorId, workstationId: actor.workstationId })).digest('hex');
    const replay = (saved: { payloadHash: string; responseSnapshot: Prisma.JsonValue }) => {
      if (saved.payloadHash !== hash) throw new PizzaCommandConflictError('Identificador de comando já utilizado com outro conteúdo.');
      return dispatchCommandResultSchema.parse({ ...(saved.responseSnapshot as object), replayed: true });
    };
    const saved = await this.prisma.dispatchCommandReceipt.findUnique({ where: { clientCommandId } });
    if (saved) return replay(saved);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          const currentActor = await sessions.validate(credentials, tx);
          if (currentActor.view.presenceStatus !== 'ONLINE') throw new PizzaCommandConflictError('Presença operacional inválida.');
          const previous = await tx.dispatchCommandReceipt.findUnique({ where: { clientCommandId } });
          if (previous) return replay(previous);
          const order = await tx.order.findUnique({ where: { id: orderId }, include: { pizzaItems: true, extraItems: true } });
          if (!order || order.schemaVersion !== 2) throw new PizzaCommandNotFoundError('Pedido v2 não encontrado.');
          const transition = dispatchTransitions[input.command];
          if (order.version !== input.expectedVersion || order.type !== transition.fulfillmentType || order.status !== transition.from || order.completedAt) throw new PizzaCommandConflictError('Pedido atualizado, concluído ou transição incompatível com o atendimento. Recarregue os dados.');
          // A persisted aggregate alone must not bypass the finishing barrier.
          if (order.operationalFlowVersion === 2) {
            const links = await tx.dispatchRouteItem.findMany({ where: { pizza: { orderId, state: { not: 'CANCELLED' } } }, include: { route: true } });
            if (!['MARK_DELIVERED', 'MARK_PICKED_UP'].includes(input.command) || links.length !== order.pizzaItems.filter(pizza => pizza.state !== 'CANCELLED').length || new Set(links.map(link => link.routeId)).size !== 1 || links.some(link => link.route.status !== 'DISPATCHED') || order.pizzaItems.some(pizza => pizza.state !== 'CANCELLED' && !pizza.counterCheckedAt)) throw new PizzaCommandConflictError('A saída deve ser realizada pela rota fechada no Balcão.');
          }
          if (!order.packingFinishedAt || !order.packingFinishedBy || !order.pizzaItems.some(pizza => pizza.state !== 'CANCELLED') || order.pizzaItems.some(pizza => !['FINISHED', 'CANCELLED'].includes(pizza.state)) || order.extraItems.some(extra => extra.state !== 'CANCELLED' && (extra.state !== 'FINISHED' || extra.checkedQuantity !== extra.quantity))) throw new PizzaCommandConflictError('Pedido ainda não foi conferido e embalado.');
          const now = new Date();
          const milestones: Prisma.OrderUpdateManyMutationInput = {
            ...(input.command === 'MARK_WAITING_DRIVER' ? { waitingDriverAt: now } : {}),
            ...(input.command === 'MARK_OUT_FOR_DELIVERY' ? { dispatchedAt: now } : {}),
            ...(input.command === 'MARK_DELIVERED' ? { deliveredAt: now, completedAt: now } : {}),
            ...(input.command === 'MARK_READY_FOR_PICKUP' ? { pickupReadyAt: now } : {}),
            ...(input.command === 'MARK_PICKED_UP' ? { pickedUpAt: now, completedAt: now } : {}),
          };
          const changed = await tx.order.updateMany({ where: { id: orderId, version: input.expectedVersion, status: transition.from, type: transition.fulfillmentType, completedAt: null }, data: { ...milestones, status: transition.to, version: { increment: 1 } } });
          if (changed.count !== 1) throw new PizzaCommandConflictError('Pedido atualizado por outro terminal.');
          await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: transition.to, changedAt: now, actorType: 'OPERATOR', actorId: actor.operatorId, metadata: JSON.stringify({ event: input.command, command: input.command, clientCommandId, operatorId: actor.operatorId, workstationId: actor.workstationId, operatorSessionId: actor.sessionId, orderVersion: order.version + 1, fulfillmentType: order.type }) } });
          const read = await loadCompatibleOrder(tx, orderId);
          if (!read || read.legacy) throw new Error('Falha na leitura do despacho.');
          const result = dispatchCommandResultSchema.parse({ order: read.order, clientCommandId, replayed: false });
          await tx.dispatchCommandReceipt.create({ data: { clientCommandId, payloadHash: hash, orderId, responseSnapshot: result as unknown as Prisma.InputJsonValue } });
          return result;
        }, { timeout: 10000, maxWait: 5000 });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034', 'P2028', 'P1008'].includes(error.code)) throw error;
        const saved = await this.prisma.dispatchCommandReceipt.findUnique({ where: { clientCommandId } }); if (saved) return replay(saved);
        if (attempt === 3) throw error;
        await new Promise(done => setTimeout(done, 50 * (attempt + 1)));
      }
    }
    throw new Error('Não foi possível confirmar despacho.');
  }
}
