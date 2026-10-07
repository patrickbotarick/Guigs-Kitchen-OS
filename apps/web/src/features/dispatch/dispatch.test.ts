import { describe, expect, it } from 'vitest';
import type { Order } from '@guigs/shared';
import { availableDispatchCommands, dispatchQueue, dispatchWaitingSeconds } from './dispatch';
import { KitchenReconciliation } from '../kitchen/realtime';
import { routeConference } from './routeConference';
import { structuredFixture } from '../../../../api/src/test-fixtures/kitchen';
import type { DispatchRouteView } from '@guigs/shared';
function fixture(status: Order['status'] = 'WAITING_DISPATCH', fulfillmentType: Order['fulfillmentType'] = 'DELIVERY', number = 1, ready = '2026-10-06T12:00:00Z'): Order { return { id: `order-${number}`, number, status, fulfillmentType, channel: 'COUNTER', schemaVersion: 2, customerName: 'Cliente teste', customerPhone: null, notes: null, receivedAt: ready, updatedAt: ready, packingFinishedAt: null, packingFinishedBy: null, createdAt: ready, version: 1, items: [], dispatch: { dispatchReadyAt: ready, completedAt: null, waitingDriverAt: null, dispatchedAt: null, deliveredAt: null, pickupReadyAt: null, pickedUpAt: null } }; }
describe('fila e ações de despacho', () => {
  it('rota parcial permanece bloqueada mesmo quando o pedido já foi liberado', () => {
    const order = structuredFixture(); order.operationalFlowVersion = 2; order.status = 'WAITING_DISPATCH';
    const pizza = order.items[0]; if (pizza.kind !== 'PIZZA') throw new Error('Pizza'); pizza.production.state = 'FINISHED'; pizza.counterCheckedAt = order.receivedAt;
    order.items.push({ ...pizza, id: 'second', position: 2 }); order.packingFinishedAt = order.receivedAt;
    const route = { items: [{ orderId: order.id, pizzaId: pizza.id }] } as DispatchRouteView;
    expect(routeConference(route, [order])).toMatchObject({ pizzas: 2, checkedPizzas: 1, extras: 2, checkedExtras: 0, packing: 1, pending: 1, complete: false });
  });
  it('resumo conta unidades de extras e mantém zero seguro para pedidos ausentes', () => {
    const order = structuredFixture(); order.operationalFlowVersion = 2; order.status = 'WAITING_DISPATCH'; order.packingFinishedAt = order.receivedAt;
    const pizza = order.items[0], extra = order.items[1]; if (pizza.kind !== 'PIZZA' || extra.kind !== 'EXTRA') throw new Error('Itens');
    pizza.production.state = 'FINISHED'; pizza.counterCheckedAt = order.receivedAt; extra.checkedQuantity = 2;
    const route = { items: [{ orderId: order.id, pizzaId: pizza.id }] } as DispatchRouteView;
    expect(routeConference(route, [order])).toMatchObject({ checkedPizzas: 1, extras: 2, checkedExtras: 2, packing: 1, pending: 0, complete: true });
    expect(routeConference(route, []).complete).toBe(false);
  });
  it('só admite pedidos liberados/andamento e separa delivery/retirada', () => {
    const delivery = fixture(), pickup = fixture('READY_FOR_PICKUP', 'PICKUP', 2);
    const orders = [delivery, pickup, fixture('FINISHING', 'PICKUP', 3), fixture('DELIVERED', 'DELIVERY', 4), fixture('PICKED_UP', 'PICKUP', 5)];
    expect(dispatchQueue(orders)).toEqual([delivery, pickup]); expect(dispatchQueue(orders, 'DELIVERY')).toEqual([delivery]); expect(dispatchQueue(orders, 'PICKUP')).toEqual([pickup]);
  });
  it('prioriza WAITING_DISPATCH pela liberação mais antiga e preserva 30 pedidos', () => {
    const older = fixture('WAITING_DISPATCH', 'PICKUP', 20, '2026-10-06T10:00:00Z'), later = fixture('WAITING_DISPATCH', 'DELIVERY', 1), ongoing = fixture('OUT_FOR_DELIVERY', 'DELIVERY', 2, '2026-10-06T09:00:00Z');
    expect(dispatchQueue([later, ongoing, older])).toEqual([older, later, ongoing]); expect(dispatchQueue(Array.from({ length: 30 }, (_, index) => fixture('WAITING_DISPATCH', 'PICKUP', index + 1)))).toHaveLength(30);
  });
  it.each([['WAITING_DISPATCH', 'DELIVERY', 'MARK_WAITING_DRIVER'], ['WAITING_DRIVER', 'DELIVERY', 'MARK_OUT_FOR_DELIVERY'], ['OUT_FOR_DELIVERY', 'DELIVERY', 'MARK_DELIVERED'], ['WAITING_DISPATCH', 'PICKUP', 'MARK_READY_FOR_PICKUP'], ['READY_FOR_PICKUP', 'PICKUP', 'MARK_PICKED_UP']] as const)('%s/%s oferece somente %s', (state, type, command) => { expect(availableDispatchCommands(fixture(state, type))).toEqual([command]); });
  it('Balcão é canal, não altera fluxo; estados finais/produção não permitem comandos', () => {
    expect(availableDispatchCommands(fixture('WAITING_DISPATCH', 'PICKUP'))).toEqual(['MARK_READY_FOR_PICKUP']);
    for (const state of ['DELIVERED', 'PICKED_UP', 'FINISHING', 'CANCELLED'] as const) expect(availableDispatchCommands(fixture(state))).toEqual([]);
    expect(availableDispatchCommands({ ...fixture(), dispatch: { ...fixture().dispatch!, completedAt: '2026-10-06T12:10:00Z' } })).toEqual([]);
  });
  it('GET antigo não ressuscita pedido concluído e refresh preserva fechamento', () => {
    const state = new KitchenReconciliation<Order>(order => order), waiting = fixture(); state.confirm(waiting); const revision = state.beginRead();
    state.confirm({ ...waiting, version: 2, status: 'DELIVERED' }); expect(dispatchQueue(state.reconcile([waiting], revision))).toEqual([]);
    const refreshed = new KitchenReconciliation<Order>(order => order); refreshed.reconcile(state.orders(), 0); expect(dispatchQueue(refreshed.orders())).toEqual([]);
  });
});



it('espera para saída para de contar após handoff e data histórica desconhecida permanece indisponível', () => {
  const order = fixture(); expect(dispatchWaitingSeconds(order, Date.parse('2026-10-06T12:05:00Z'))).toBe(300);
  expect(dispatchWaitingSeconds({ ...order, dispatch: { ...order.dispatch!, dispatchedAt: '2026-10-06T12:02:00Z' } }, Date.parse('2026-10-06T12:05:00Z'))).toBe(120);
  expect(dispatchWaitingSeconds({ ...order, dispatch: undefined }, Date.now())).toBeNull();
});
