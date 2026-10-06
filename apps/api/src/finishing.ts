import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { finishingCommandSchema, finishingCommandResultSchema, deriveOrderProductionState, kitchenOrderUpdatedSchema, type FinishingCommandInput, type FinishingCommandResult, type KitchenNotification } from '@guigs/shared';
import { OperatorSessionService, type SessionCredentials } from './operator-sessions.js';
import { PizzaCommandConflictError, PizzaCommandNotFoundError } from './pizza-commands.js';
import { loadCompatibleOrder } from './kitchen-data.js';

export function finishingNotifications(result: FinishingCommandResult): KitchenNotification[] {
  return result.replayed ? [] : [{ type: 'kitchen.order.updated', payload: kitchenOrderUpdatedSchema.parse({ schemaVersion: 1, eventId: randomUUID(), orderId: result.order.id, status: result.order.status, version: result.order.version, commandId: result.clientCommandId, timestamp: new Date().toISOString() }) }];
}
export class FinishingService {
  constructor(private readonly prisma: PrismaClient) {}
  async execute(orderId: string, payload: FinishingCommandInput, credentials?: SessionCredentials): Promise<FinishingCommandResult> {
    const sessions = new OperatorSessionService(this.prisma), actor = await sessions.validate(credentials), input = finishingCommandSchema.parse(payload);
    if (actor.view.presenceStatus !== 'ONLINE') throw new PizzaCommandConflictError('Confirme sua presença antes de operar a finalização.');
    const { clientCommandId, ...intent } = input;
    const hash = createHash('sha256').update(JSON.stringify({ orderId, ...intent, sessionId: actor.sessionId, operatorId: actor.operatorId, workstationId: actor.workstationId })).digest('hex');
    const replay = (saved: { payloadHash: string; responseSnapshot: Prisma.JsonValue }) => {
      if (saved.payloadHash !== hash) throw new PizzaCommandConflictError('Identificador de comando já utilizado com outro conteúdo.');
      return finishingCommandResultSchema.parse({ ...(saved.responseSnapshot as object), replayed: true });
    };
    const saved = await this.prisma.finishingCommandReceipt.findUnique({ where: { clientCommandId } });
    if (saved) return replay(saved);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          const currentActor = await sessions.validate(credentials, tx);
          if (currentActor.view.presenceStatus !== 'ONLINE') throw new PizzaCommandConflictError('Presença operacional inválida.');
          const previous = await tx.finishingCommandReceipt.findUnique({ where: { clientCommandId } });
          if (previous) return replay(previous);
          const order = await tx.order.findUnique({ where: { id: orderId }, include: { pizzaItems: true, extraItems: true } });
          if (!order || order.schemaVersion !== 2) throw new PizzaCommandNotFoundError('Pedido v2 não encontrado.');
          if (order.version !== input.expectedVersion || !['IN_PRODUCTION', 'OVEN', 'FINISHING'].includes(order.status)) throw new PizzaCommandConflictError('Este pedido foi atualizado ou não aceita conferência. Recarregue os dados.');
          if (!order.pizzaItems.some(pizza => ['BAKED', 'FINISHING', 'FINISHED'].includes(pizza.state))) throw new PizzaCommandConflictError('Ainda não há pizza disponível para finalização.');
          const now = new Date();
          let event = '', metadata: Record<string, unknown> = { command: input.command, clientCommandId, operatorId: actor.operatorId, workstationId: actor.workstationId, operatorSessionId: actor.sessionId };
          const correction = input.command === 'UNCHECK_PIZZA' || input.command === 'UNCHECK_EXTRA' || input.command === 'UNCONFIRM_PACKAGING';
          if (correction) metadata.reason = input.reason || null;
          if (input.command === 'UNCHECK_PIZZA') {
            const pizza = order.pizzaItems.find(pizza => pizza.id === input.pizzaId);
            if (!pizza) throw new PizzaCommandNotFoundError('Pizza não pertence a este pedido.');
            if (pizza.version !== input.expectedItemVersion || pizza.state !== 'FINISHED') throw new PizzaCommandConflictError('Pizza atualizada ou ainda não conferida.');
            const changed = await tx.pizzaItem.updateMany({ where: { id: pizza.id, version: input.expectedItemVersion, state: 'FINISHED' }, data: { state: 'FINISHING', finishedAt: null, version: { increment: 1 } } });
            if (changed.count !== 1) throw new PizzaCommandConflictError('Pizza atualizada por outro terminal.');
            event = 'PIZZA_UNCHECKED';
            metadata = { ...metadata, pizzaId: pizza.id, itemVersion: pizza.version + 1, previousFinishedAt: pizza.finishedAt?.toISOString() ?? null };
            await tx.pizzaProductionHistory.create({ data: { pizzaId: pizza.id, eventType: event, fromState: 'FINISHED', toState: 'FINISHING', changedAt: now, actorType: 'OPERATOR', actorId: actor.operatorId, operatorId: actor.operatorId, workstationId: actor.workstationId, operatorSessionId: actor.sessionId, commandId: clientCommandId, itemVersion: pizza.version + 1, reason: input.reason || null, metadata: metadata as Prisma.InputJsonValue } });
          } else if (input.command === 'UNCHECK_EXTRA') {
            const extra = order.extraItems.find(extra => extra.id === input.extraId);
            if (!extra) throw new PizzaCommandNotFoundError('Extra não pertence a este pedido.');
            if (extra.version !== input.expectedItemVersion || extra.state === 'CANCELLED' || input.checkedQuantity >= extra.checkedQuantity) throw new PizzaCommandConflictError('Reduza a quantidade conferida; extra atualizado ou cancelado.');
            const changed = await tx.extraItem.updateMany({ where: { id: extra.id, version: input.expectedItemVersion, state: extra.state }, data: { checkedQuantity: input.checkedQuantity, state: 'WAITING_FINISHING', checkedAt: input.checkedQuantity ? now : null, checkedBy: input.checkedQuantity ? actor.operatorId : null, version: { increment: 1 } } });
            if (changed.count !== 1) throw new PizzaCommandConflictError('Extra atualizado por outro terminal.');
            event = 'EXTRA_UNCHECKED'; metadata = { ...metadata, extraId: extra.id, checkedQuantity: input.checkedQuantity, previousCheckedQuantity: extra.checkedQuantity, previousCheckedAt: extra.checkedAt?.toISOString() ?? null, previousCheckedBy: extra.checkedBy, itemVersion: extra.version + 1 };
          } else if (input.command === 'UNCONFIRM_PACKAGING') {
            if (!order.packingFinishedAt || !order.packingFinishedBy) throw new PizzaCommandConflictError('Embalagem ainda não confirmada.');
            await tx.order.update({ where: { id: orderId }, data: { packingFinishedAt: null, packingFinishedBy: null } });
            event = 'PACKAGING_UNCONFIRMED'; metadata = { ...metadata, automatic: false, previousPackingFinishedAt: order.packingFinishedAt.toISOString(), previousPackingFinishedBy: order.packingFinishedBy };
          } else if (input.command === 'START_FINISHING' || input.command === 'CHECK_PIZZA') {
            const pizza = order.pizzaItems.find(pizza => pizza.id === input.pizzaId), from = input.command === 'START_FINISHING' ? 'BAKED' : 'FINISHING', to = input.command === 'START_FINISHING' ? 'FINISHING' : 'FINISHED';
            if (!pizza) throw new PizzaCommandNotFoundError('Pizza não pertence a este pedido.');
            if (pizza.version !== input.expectedItemVersion || pizza.state !== from) throw new PizzaCommandConflictError('Pizza atualizada ou ainda não disponível para esta conferência.');
            const changed = await tx.pizzaItem.updateMany({ where: { id: pizza.id, version: input.expectedItemVersion, state: from }, data: { state: to, version: { increment: 1 }, ...(to === 'FINISHING' ? { finishingStartedAt: now } : { finishedAt: now }) } });
            if (changed.count !== 1) throw new PizzaCommandConflictError('Pizza atualizada por outro terminal.');
            event = to === 'FINISHING' ? 'FINISHING_STARTED' : 'PIZZA_CHECKED';
            await tx.pizzaProductionHistory.create({ data: { pizzaId: pizza.id, eventType: event, fromState: from, toState: to, changedAt: now, actorType: 'OPERATOR', actorId: actor.operatorId, operatorId: actor.operatorId, workstationId: actor.workstationId, operatorSessionId: actor.sessionId, commandId: clientCommandId, itemVersion: pizza.version + 1, reason: 'Conferência na estação de finalização' } });
            metadata = { ...metadata, pizzaId: pizza.id, itemVersion: pizza.version + 1 };
          } else if (input.command === 'CHECK_EXTRA') {
            const extra = order.extraItems.find(extra => extra.id === input.extraId);
            if (!extra) throw new PizzaCommandNotFoundError('Extra não pertence a este pedido.');
            if (extra.version !== input.expectedItemVersion || extra.state !== 'WAITING_FINISHING' || input.checkedQuantity <= extra.checkedQuantity || input.checkedQuantity > extra.quantity) throw new PizzaCommandConflictError('Quantidade inválida ou extra atualizado.');
            const changed = await tx.extraItem.updateMany({ where: { id: extra.id, version: input.expectedItemVersion, state: 'WAITING_FINISHING' }, data: { checkedQuantity: input.checkedQuantity, state: input.checkedQuantity === extra.quantity ? 'FINISHED' : 'WAITING_FINISHING', checkedAt: now, checkedBy: actor.operatorId, version: { increment: 1 } } });
            if (changed.count !== 1) throw new PizzaCommandConflictError('Extra atualizado por outro terminal.');
            event = 'EXTRA_CHECKED'; metadata = { ...metadata, extraId: extra.id, checkedQuantity: input.checkedQuantity, previousCheckedQuantity: extra.checkedQuantity, itemVersion: extra.version + 1 };
          } else {
            const pizzasReady = order.pizzaItems.filter(pizza => pizza.state !== 'CANCELLED').every(pizza => pizza.state === 'FINISHED');
            const extrasReady = order.extraItems.filter(extra => extra.state !== 'CANCELLED').every(extra => extra.state === 'FINISHED' && extra.checkedQuantity === extra.quantity);
            if (!pizzasReady || !extrasReady) throw new PizzaCommandConflictError('Confira todas as pizzas e todas as unidades dos extras antes de confirmar embalagem ou liberar.');
            if (input.command === 'CONFIRM_PACKAGING') {
              if (order.packingFinishedAt || order.packingFinishedBy) throw new PizzaCommandConflictError('Embalagem já confirmada.');
              await tx.order.update({ where: { id: orderId }, data: { packingFinishedAt: now, packingFinishedBy: actor.operatorId } }); event = 'PACKAGING_CONFIRMED';
            } else {
              if (!order.packingFinishedAt || !order.packingFinishedBy) throw new PizzaCommandConflictError('Confirme a embalagem antes de liberar.');
              event = 'RELEASED_TO_DISPATCH';
            }
          }
          const pizzas = await tx.pizzaItem.findMany({ where: { orderId }, select: { state: true } }), extras = await tx.extraItem.findMany({ where: { orderId }, select: { state: true, quantity: true, checkedQuantity: true } });
          // Packaging does not release implicitly: only the explicit release command
          // asks the existing aggregate to include confirmed packing.
          const status = deriveOrderProductionState({ pizzas: pizzas.map(pizza => pizza.state), extras, packingConfirmed: input.command === 'RELEASE_TO_DISPATCH' });
          if (input.command === 'RELEASE_TO_DISPATCH' && status !== 'WAITING_DISPATCH') throw new PizzaCommandConflictError('Pedido ainda incompleto para despacho.');
          const changedOrder = await tx.order.updateMany({ where: { id: orderId, version: input.expectedVersion }, data: { status, version: { increment: 1 }, ...(input.command === 'RELEASE_TO_DISPATCH' ? { dispatchReadyAt: now } : {}) } });
          if (changedOrder.count !== 1) throw new PizzaCommandConflictError('Pedido atualizado por outro terminal.');
          await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: status, changedAt: now, actorType: 'OPERATOR', actorId: actor.operatorId, metadata: JSON.stringify({ ...metadata, event, orderVersion: order.version + 1 }) } });
          // A corrected required item invalidates packing in this same transaction.
          // Append a separate event: never erase the original packing confirmation.
          if ((input.command === 'UNCHECK_PIZZA' || input.command === 'UNCHECK_EXTRA') && (order.packingFinishedAt || order.packingFinishedBy)) {
            await tx.order.update({ where: { id: orderId }, data: { packingFinishedAt: null, packingFinishedBy: null } });
            await tx.orderStatusHistory.create({ data: { orderId, fromStatus: status, toStatus: status, changedAt: now, actorType: 'OPERATOR', actorId: actor.operatorId, metadata: JSON.stringify({ ...metadata, event: 'PACKAGING_UNCONFIRMED', automatic: true, triggerEvent: event, previousPackingFinishedAt: order.packingFinishedAt?.toISOString() ?? null, previousPackingFinishedBy: order.packingFinishedBy, orderVersion: order.version + 1 }) } });
          }
          const read = await loadCompatibleOrder(tx, orderId);
          if (!read || read.legacy) throw new Error('Falha na leitura da finalização.');
          const result = finishingCommandResultSchema.parse({ order: read.order, clientCommandId, replayed: false });
          await tx.finishingCommandReceipt.create({ data: { clientCommandId, payloadHash: hash, orderId, responseSnapshot: result as unknown as Prisma.InputJsonValue } });
          return result;
        }, { timeout: 10000, maxWait: 5000 });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034', 'P2028', 'P1008'].includes(error.code)) throw error;
        const saved = await this.prisma.finishingCommandReceipt.findUnique({ where: { clientCommandId } }); if (saved) return replay(saved);
        if (attempt === 3) throw error;
        await new Promise(done => setTimeout(done, 50 * (attempt + 1)));
      }
    }
    throw new Error('Não foi possível confirmar finalização.');
  }
}
