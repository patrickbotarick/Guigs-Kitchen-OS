import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { routeCommandSchema, type RouteCommandInput, type DispatchRouteView, type Order } from '@guigs/shared';
import { OperatorSessionService, transactionRetry, type SessionCredentials } from './operator-sessions.js';
import { PizzaCommandConflictError, PizzaCommandNotFoundError } from './pizza-commands.js';
import { loadCompatibleOrder } from './kitchen-data.js';

type RouteRow = Prisma.DispatchRouteGetPayload<{ include: { items: { include: { pizza: true } } } }>;
function view(row: RouteRow): DispatchRouteView { return { id: row.id, routeNumber: row.routeNumber, status: row.status as DispatchRouteView['status'], version: row.version, createdAt: row.createdAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null, reopenedAt: row.reopenedAt?.toISOString() ?? null, dispatchedAt: row.dispatchedAt?.toISOString() ?? null, items: row.items.map(item => ({ pizzaId: item.pizzaId, orderId: item.pizza.orderId, addedAt: item.addedAt.toISOString() })) }; }
const include = { items: { include: { pizza: true } } } as const;
export type RouteResult = { routes: DispatchRouteView[]; orders: Order[]; replayed: boolean; clientCommandId: string };
export class DispatchRouteService {
  constructor(private readonly prisma: PrismaClient) {}
  async list() { return (await this.prisma.dispatchRoute.findMany({ include, orderBy: { routeNumber: 'asc' } })).map(view); }
  async history(id: string) { return this.prisma.dispatchRouteHistory.findMany({ where: { routeId: id }, orderBy: [{ changedAt: 'asc' }, { version: 'asc' }] }); }
  async execute(routeId: string | null, payload: RouteCommandInput, credentials?: SessionCredentials): Promise<RouteResult> {
    const input = routeCommandSchema.parse(payload), sessions = new OperatorSessionService(this.prisma), actor = await sessions.validate(credentials);
    if (actor.view.presenceStatus !== 'ONLINE') throw new PizzaCommandConflictError('Confirme presença para operar rotas.');
    if ((input.command === 'CREATE') !== (routeId === null)) throw new PizzaCommandConflictError('Comando incompatível com a rota.');
    const { clientCommandId, ...intent } = input, hash = createHash('sha256').update(JSON.stringify({ routeId, ...intent, sessionId: actor.sessionId })).digest('hex');
    const replay = (saved: { payloadHash: string; responseSnapshot: Prisma.JsonValue }): RouteResult => {
      if (saved.payloadHash !== hash) throw new PizzaCommandConflictError('Identificador de comando já usado com outro conteúdo.');
      return { ...(saved.responseSnapshot as unknown as RouteResult), replayed: true };
    };
    const saved = await this.prisma.dispatchRouteReceipt.findUnique({ where: { clientCommandId } }); if (saved) return replay(saved);
    return transactionRetry(this.prisma, async tx => {
      const currentActor = await sessions.validate(credentials, tx); if (currentActor.view.presenceStatus !== 'ONLINE') throw new PizzaCommandConflictError('Presença operacional inválida.');
      const saved = await tx.dispatchRouteReceipt.findUnique({ where: { clientCommandId } }); if (saved) return replay(saved);
      const now = new Date(), touched = new Set<string>(), changedRoutes = new Set<string>();
      let route = routeId ? await tx.dispatchRoute.findUnique({ where: { id: routeId }, include }) : null;
      if (input.command === 'CREATE') {
        const counter = await tx.dispatchRouteCounter.upsert({ where: { id: 1 }, create: { id: 1, value: 1 }, update: { value: { increment: 1 } } });
        route = await tx.dispatchRoute.create({ data: { routeNumber: counter.value, createdByOperatorId: actor.operatorId, workstationId: actor.workstationId, sessionId: actor.sessionId, createdAt: now }, include });
      } else if (!route) throw new PizzaCommandNotFoundError('Rota não encontrada.');
      if (!route) throw new Error('Rota ausente.');
      if (input.command !== 'CREATE' && (route.version !== input.expectedVersion || route.status === 'DISPATCHED')) throw new PizzaCommandConflictError('Rota atualizada ou já despachada. Recarregue os dados.');
      const log = async (id: string, version: number, eventType: string, metadata: Prisma.InputJsonValue) => tx.dispatchRouteHistory.create({ data: { routeId: id, version, eventType, changedAt: now, operatorId: actor.operatorId, workstationId: actor.workstationId, sessionId: actor.sessionId, commandId: clientCommandId, metadata } });
      const bump = async (row: RouteRow, data: Prisma.DispatchRouteUpdateManyMutationInput = {}) => {
        const updated = await tx.dispatchRoute.updateMany({ where: { id: row.id, version: row.version, status: row.status }, data: { ...data, version: { increment: 1 } } });
        if (updated.count !== 1) throw new PizzaCommandConflictError('Rota atualizada por outro terminal.'); changedRoutes.add(row.id);
      };
      if (input.command === 'ADD' || input.command === 'REMOVE' || input.command === 'MOVE') {
        if (route.status !== 'OPEN') throw new PizzaCommandConflictError('Reabra a rota antes de alterar a composição.');
        const pizza = await tx.pizzaItem.findUnique({ where: { id: input.pizzaId }, include: { order: true, routeItem: true } });
        if (!pizza) throw new PizzaCommandNotFoundError('Pizza não encontrada.');
        if (pizza.state !== 'FINISHED' || pizza.order.completedAt || ['OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'WAITING_DRIVER', 'CANCELLED'].includes(pizza.order.status)) throw new PizzaCommandConflictError('Somente pizza finalizada, sem saída, pode compor uma rota.');
        if (input.command === 'ADD') {
          if (pizza.routeItem) throw new PizzaCommandConflictError('Esta pizza já pertence a uma rota.');
          await tx.dispatchRouteItem.create({ data: { routeId: route.id, pizzaId: pizza.id, addedAt: now } });
        } else {
          if (pizza.routeItem?.routeId !== route.id) throw new PizzaCommandConflictError('Pizza não pertence a esta rota.');
          if (input.command === 'MOVE') {
            const target = await tx.dispatchRoute.findUnique({ where: { id: input.targetRouteId }, include });
            if (!target || target.id === route.id || target.status !== 'OPEN' || target.version !== input.targetExpectedVersion) throw new PizzaCommandConflictError('Destino deve ser outra rota aberta com versão atual.');
            await bump(target); await tx.dispatchRouteItem.update({ where: { pizzaId: pizza.id }, data: { routeId: target.id, addedAt: now } });
            await log(target.id, target.version + 1, 'ROUTE_ITEM_ADDED', { pizzaId: pizza.id, fromRouteId: route.id });
          } else await tx.dispatchRouteItem.delete({ where: { pizzaId: pizza.id } });
        }
        await bump(route); touched.add(pizza.orderId);
        await log(route.id, route.version + 1, input.command === 'ADD' ? 'ROUTE_ITEM_ADDED' : 'ROUTE_ITEM_REMOVED', { pizzaId: pizza.id, targetRouteId: input.targetRouteId ?? null });
      } else if (input.command === 'CLOSE' || input.command === 'REOPEN') {
        if (route.status !== (input.command === 'CLOSE' ? 'OPEN' : 'CLOSED') || (input.command === 'CLOSE' && !route.items.length)) throw new PizzaCommandConflictError('Estado incompatível ou rota vazia.');
        const involved = [...new Set(route.items.map(item => item.pizza.orderId))];
        if (input.command === 'REOPEN' && await tx.order.count({ where: { id: { in: involved }, status: { in: ['WAITING_DRIVER', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'DELIVERED', 'PICKED_UP'] } } })) throw new PizzaCommandConflictError('Rota já possui saída iniciada e não pode reabrir.');
        await bump(route, input.command === 'CLOSE' ? { status: 'CLOSED', closedAt: now } : { status: 'OPEN', reopenedAt: now, closedAt: null });
        involved.forEach(id => touched.add(id)); await log(route.id, route.version + 1, input.command === 'CLOSE' ? 'ROUTE_CLOSED' : 'ROUTE_REOPENED', { pizzaIds: route.items.map(item => item.pizzaId) });
      } else if (input.command === 'DISPATCH') {
        if (route.status !== 'CLOSED' || !route.items.length) throw new PizzaCommandConflictError('Feche uma rota com pizzas antes de despachar.');
        const ids = [...new Set(route.items.map(item => item.pizza.orderId))];
        const orders = await tx.order.findMany({ where: { id: { in: ids } }, include: { pizzaItems: { include: { routeItem: true } }, extraItems: true } });
        for (const order of orders) {
          const pizzas = order.pizzaItems.filter(pizza => pizza.state !== 'CANCELLED');
          if (order.completedAt || order.status !== 'WAITING_DISPATCH' || !pizzas.length || pizzas.some(pizza => pizza.state !== 'FINISHED' || pizza.routeItem?.routeId !== route!.id || (order.operationalFlowVersion === 2 && !pizza.counterCheckedAt)) || !order.packingFinishedAt || !order.packingFinishedBy || order.extraItems.some(extra => extra.state !== 'CANCELLED' && (extra.state !== 'FINISHED' || extra.checkedQuantity !== extra.quantity))) throw new PizzaCommandConflictError(`Pedido #${order.number} incompleto: confira todas as pizzas na mesma rota, extras e embalagem no Balcão.`);
          const status = order.type === 'DELIVERY' ? 'OUT_FOR_DELIVERY' : 'READY_FOR_PICKUP';
          const updated = await tx.order.updateMany({ where: { id: order.id, version: order.version, status: order.status }, data: { status, version: { increment: 1 }, ...(order.type === 'DELIVERY' ? { dispatchedAt: now } : { pickupReadyAt: now }) } });
          if (updated.count !== 1) throw new PizzaCommandConflictError('Pedido atualizado durante despacho.');
          await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: status, changedAt: now, actorType: 'OPERATOR', actorId: actor.operatorId, metadata: JSON.stringify({ event: 'ROUTE_DISPATCHED', routeId: route.id, clientCommandId, workstationId: actor.workstationId, sessionId: actor.sessionId }) } }); touched.add(order.id);
        }
        await bump(route, { status: 'DISPATCHED', dispatchedAt: now }); await log(route.id, route.version + 1, 'ROUTE_DISPATCHED', { orderIds: ids, pizzaIds: route.items.map(item => item.pizzaId) });
      } else { changedRoutes.add(route.id); await log(route.id, 0, 'ROUTE_CREATED', {}); }
      // Composition changes invalidate prior physical conference and packing, never production.
      if (['ADD', 'REMOVE', 'MOVE', 'REOPEN'].includes(input.command)) for (const orderId of touched) {
        const conferences = await tx.pizzaItem.findMany({ where: { orderId, counterCheckedAt: { not: null } } });
        for (const pizza of conferences) await tx.pizzaProductionHistory.create({ data: { pizzaId: pizza.id, eventType: 'COUNTER_CONFERENCE_INVALIDATED', fromState: pizza.state, toState: pizza.state, changedAt: now, actorType: 'OPERATOR', actorId: actor.operatorId, operatorId: actor.operatorId, workstationId: actor.workstationId, operatorSessionId: actor.sessionId, commandId: `${clientCommandId}:${pizza.id}`, itemVersion: pizza.version + 1, reason: 'Composição/reabertura da rota', metadata: { routeId: route.id, previousCounterCheckedAt: pizza.counterCheckedAt!.toISOString(), previousCounterCheckedBy: pizza.counterCheckedBy } } });
        await tx.pizzaItem.updateMany({ where: { orderId, counterCheckedAt: { not: null } }, data: { counterCheckedAt: null, counterCheckedBy: null, version: { increment: 1 } } });
        const old = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
        await tx.order.update({ where: { id: orderId }, data: { packingFinishedAt: null, packingFinishedBy: null, ...(old.status === 'WAITING_DISPATCH' ? { status: 'FINISHING' } : {}) } });
        await tx.orderStatusHistory.create({ data: { orderId, fromStatus: old.status, toStatus: old.status === 'WAITING_DISPATCH' ? 'FINISHING' : old.status, actorType: 'OPERATOR', actorId: actor.operatorId, changedAt: now, metadata: JSON.stringify({ event: 'ROUTE_CONFERENCE_INVALIDATED', routeId: route.id, clientCommandId }) } });
      }
      if (input.command !== 'DISPATCH') for (const orderId of touched) await tx.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } });
      const orders: Order[] = []; for (const id of touched) { const read = await loadCompatibleOrder(tx, id); if (read && !read.legacy) orders.push(read.order); }
      const result: RouteResult = { routes: (await tx.dispatchRoute.findMany({ where: { id: { in: [...changedRoutes] } }, include })).map(view), orders, replayed: false, clientCommandId };
      await tx.dispatchRouteReceipt.create({ data: { clientCommandId, payloadHash: hash, responseSnapshot: result as unknown as Prisma.InputJsonValue } }); return result;
    });
  }
}
