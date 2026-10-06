import { describe, expect, it } from 'vitest';
import type { Order, PizzaItem, ExtraItem } from '@guigs/shared';
import { finishingProgress, finishingQueue } from './finishing';
import { KitchenReconciliation } from '../kitchen/realtime';

function pizza(state: PizzaItem['production']['state'], id = 'pizza', bakedAt: string | null = '2026-10-06T12:00:00.000Z'): PizzaItem { return { kind: 'PIZZA', id, production: { state, bakedAt } } as PizzaItem; }
function extra(quantity = 2, checkedQuantity = 0, state: ExtraItem['state'] = 'WAITING_FINISHING'): ExtraItem { return { kind: 'EXTRA', id: 'extra', quantity, checkedQuantity, state } as ExtraItem; }
function order(items: Order['items'], number = 1, status: Order['status'] = 'FINISHING', packed = false): Order { return { id: `order-${number}`, number, items, status, version: 1, packingFinishedAt: packed ? '2026-10-06T12:10:00Z' : null, packingFinishedBy: packed ? 'operator' : null } as Order; }
describe('fila e critérios de finalização', () => {
  it('inclui pedido parcial com BAKED e exclui pedidos sem pizza assada, cancelados ou liberados', () => {
    const partial = order([pizza('BAKED'), pizza('IN_OVEN', 'second', null)], 1, 'OVEN');
    expect(finishingQueue([partial, order([pizza('IN_OVEN')], 2, 'OVEN'), order([pizza('FINISHED')], 3, 'WAITING_DISPATCH'), order([pizza('CANCELLED')], 4, 'CANCELLED')])).toEqual([partial]);
    expect(finishingProgress(partial)).toMatchObject({ available: 1, pizzas: 2, canRelease: false });
  });
  it('mais antiga pela primeira pizza pronta independentemente da criação/número', () => {
    const first = order([pizza('BAKED', 'p', '2026-10-06T11:00:00Z')], 5), later = order([pizza('BAKED', 'p', '2026-10-06T12:00:00Z')], 1);
    expect(finishingQueue([later, first]).map(value => value.number)).toEqual([5, 1]);
  });
  it.each(['BAKED', 'FINISHING', 'IN_OVEN', 'WAITING_ASSEMBLY'] as const)('%s não equivale a pizza conferida', state => { expect(finishingProgress(order([pizza(state)], 1, 'FINISHING', true)).canRelease).toBe(false); });
  it('sem extras: basta pizzas conferidas e embalagem', () => { expect(finishingProgress(order([pizza('FINISHED')], 1, 'FINISHING', true))).toMatchObject({ allChecked: true, canRelease: true, extraUnits: 0 }); });
  it('não exige só embalagem: conferir todos os itens não libera antes dela', () => { expect(finishingProgress(order([pizza('FINISHED')])).canRelease).toBe(false); });
  it('unidades do mesmo extra entram no progresso e bloqueiam enquanto incompletas', () => {
    expect(finishingProgress(order([pizza('FINISHED'), extra(2, 1)], 1, 'FINISHING', true))).toMatchObject({ checked: 2, total: 3, canRelease: false });
    expect(finishingProgress(order([pizza('FINISHED'), extra(2, 2, 'FINISHED')], 1, 'FINISHING', true)).canRelease).toBe(true);
  });
  it('cancelados não bloqueiam nem entram no denominador; extras-only não são liberados', () => {
    expect(finishingProgress(order([pizza('FINISHED'), pizza('CANCELLED', 'c'), extra(2, 0, 'CANCELLED')], 1, 'FINISHING', true))).toMatchObject({ total: 1, canRelease: true });
    expect(finishingProgress(order([extra(1, 1, 'FINISHED')], 1, 'FINISHING', true)).canRelease).toBe(false);
  });
  it('30 pedidos com itens prontos preservam a fila completa e ordenação', () => { expect(finishingQueue(Array.from({ length: 30 }, (_, index) => order([pizza('BAKED')], 30 - index))).map(order => order.number)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1)); });
  it('liberação confirmada não é desfeita por GET antigo; refresh usa estado persistido', () => {
    const state = new KitchenReconciliation<Order>(order => order), pending = order([pizza('FINISHED')]); state.confirm(pending); const read = state.beginRead();
    state.confirm({ ...pending, version: 2, status: 'WAITING_DISPATCH' }); expect(finishingQueue(state.reconcile([pending], read))).toEqual([]);
    const refreshed = new KitchenReconciliation<Order>(order => order); refreshed.reconcile(state.orders(), 0); expect(finishingQueue(refreshed.orders())).toEqual([]);
  });
});
