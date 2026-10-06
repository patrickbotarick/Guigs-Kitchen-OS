import { describe, expect, it } from 'vitest';
import type { Order, PizzaItem } from '@guigs/shared';
import { elapsedSeconds, formatDuration, ovenFlavor, ovenQueues, ovenTiming } from './oven';
import { KitchenReconciliation } from '../kitchen/realtime';

const start = '2026-10-06T12:00:00.000Z';
function pizza(id: string, state: PizzaItem['production']['state'], position = 0): PizzaItem {
  return { id, position, orderId: 'order', kind: 'PIZZA', notes: null, assignment: null, releasedAt: null,
    recipe: { size: 'BROTO', composition: 'WHOLE', firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional' },
    snapshot: { schemaVersion: 1, catalogRevisionId: 'fixture', size: 'BROTO', composition: 'WHOLE', firstHalf: { flavorId: 'calabresa', name: 'Calabresa histórica', ingredients: [], modifiers: [] }, crust: { id: 'tradicional', name: 'Tradicional', revisionId: 'fixture', priceInCents: null } },
    production: { state, version: 3, queuedAt: start, assemblyStartedAt: start, pausedAt: null, assemblyCompletedAt: start, ovenStartedAt: state === 'WAITING_OVEN' ? null : start, ovenExpectedEndAt: state === 'WAITING_OVEN' ? null : '2026-10-06T12:07:00.000Z', bakedAt: null, finishingStartedAt: null, finishedAt: null, cancelledAt: null } };
}
function order(items: PizzaItem[], version = 1): Order { return { id: 'order', number: 1, items, version } as Order; }
describe('fila e timer do forno', () => {
  it('ordena dentro do forno por previsão de saída independente da entrada e do pedido', () => {
    const older = pizza('older', 'IN_OVEN'); older.production.ovenExpectedEndAt = '2026-10-06T12:15:00.000Z';
    const newer = pizza('newer', 'IN_OVEN'); newer.production.ovenStartedAt = '2026-10-06T12:01:00.000Z'; newer.production.ovenExpectedEndAt = '2026-10-06T12:05:00.000Z';
    expect(ovenQueues([order([older, newer])]).inside.map(entry => entry.pizza.id)).toEqual(['newer', 'older']);
  });
  it('separa WAITING_OVEN e IN_OVEN por pizza, ignorando montagem/BAKED/extras', () => {
    const queues = ovenQueues([order([pizza('waiting', 'WAITING_OVEN'), pizza('inside', 'IN_OVEN'), pizza('assembling', 'ASSEMBLING'), pizza('baked', 'BAKED')])]);
    expect(queues.waiting.map(entry => entry.pizza.id)).toEqual(['waiting']); expect(queues.inside.map(entry => entry.pizza.id)).toEqual(['inside']);
  });
  it('ordena espera pela conclusão da montagem e preserva desempate por posição', () => {
    const newer = pizza('new', 'WAITING_OVEN', 2); newer.production.assemblyCompletedAt = '2026-10-06T12:01:00.000Z';
    expect(ovenQueues([order([newer, pizza('second', 'WAITING_OVEN', 1), pizza('first', 'WAITING_OVEN', 0)])]).waiting.map(entry => entry.pizza.id)).toEqual(['first', 'second', 'new']);
  });
  it('meio a meio é uma única pizza e usa nomes históricos sem consultar catálogo atual', () => {
    const half = pizza('half', 'WAITING_OVEN'); half.snapshot.composition = 'HALF_HALF'; half.snapshot.secondHalf = { ...half.snapshot.firstHalf, name: 'Portuguesa histórica' };
    expect(ovenFlavor(half)).toBe('Calabresa histórica / Portuguesa histórica'); expect(ovenQueues([order([half])]).waiting).toHaveLength(1);
  });
  it('Broto e Grande usam o mesmo tempo persistido, sem regra culinária por tamanho', () => {
    const broto = pizza('broto', 'IN_OVEN'), grande = pizza('grande', 'IN_OVEN'); grande.snapshot.size = 'GRANDE';
    expect(ovenTiming(broto, Date.parse(start) + 123000)).toEqual(ovenTiming(grande, Date.parse(start) + 123000));
  });
  it.each([[0, 'NORMAL'], [335, 'NORMAL'], [336, 'NEAR'], [419, 'NEAR'], [420, 'REACHED'], [479, 'REACHED'], [480, 'OVER']])('indicador orientativo aos %s segundos: %s', (seconds, phase) => {
    const item = pizza('inside', 'IN_OVEN'); expect(ovenTiming(item, Date.parse(start) + Number(seconds) * 1000).phase).toBe(phase); expect(item.production.state).toBe('IN_OVEN');
  });
  it('refresh/recriação do timer deriva horário persistido e não reinicia contagem', () => {
    const item = pizza('inside', 'IN_OVEN'), now = Date.parse(start) + 92000;
    expect(ovenTiming(item, now).elapsed).toBe(92); expect(ovenTiming(structuredClone(item), now + 3000).elapsed).toBe(95); expect(formatDuration(95)).toBe('01:35');
  });
  it('sem estimativa mantém indicador normal e sem data de saída não inventa BAKED', () => {
    const item = pizza('inside', 'IN_OVEN'); item.production.ovenExpectedEndAt = null;
    expect(ovenTiming(item, Date.parse(start) + 999999)).toMatchObject({ duration: null, phase: 'NORMAL' }); expect(item.production.bakedAt).toBeNull();
  });
  it('contagem não fica negativa e mantém minutos acima de uma hora', () => { expect(elapsedSeconds(start, Date.parse(start) - 1)).toBe(0); expect(formatDuration(3661)).toBe('61:01'); });
  it('30 pizzas permanecem uma por card sem limite fictício de capacidade', () => { expect(ovenQueues([order(Array.from({ length: 30 }, (_, index) => pizza(String(index), 'WAITING_OVEN', index)))]).waiting).toHaveLength(30); });
  it('reconciliação preserva comando novo contra GET antigo em voo e reconhece saída', () => {
    const state = new KitchenReconciliation<Order>(order => order); const first = order([pizza('inside', 'IN_OVEN')]); state.confirm(first);
    const read = state.beginRead(), newer = order([pizza('inside', 'BAKED')], 2); state.confirm(newer);
    expect(state.reconcile([first], read)[0].items[0]).toMatchObject({ production: { state: 'BAKED' } }); expect(ovenQueues(state.orders()).inside).toEqual([]);
  });
});
