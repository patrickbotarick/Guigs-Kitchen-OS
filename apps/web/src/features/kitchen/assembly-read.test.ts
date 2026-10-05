import { describe, expect, it, vi } from 'vitest';
import type { Order, PizzaItem as SavedPizza } from '@guigs/shared';
import { structuredFixture } from '../../../../api/src/test-fixtures/kitchen';
import { createAssemblyApi, mapAssemblyOrder } from './api';
import { assemblyReducer, createAssemblyState, sortOrders } from './assembly';
import { crustLabel, halfName, pizzaIngredients, pizzaName } from './pizzaRecipe';

function fixture(): Order { return structuredFixture(); }
describe('leitura persistida do Assembly', () => {
  it('lista v2 pela API e carrega pedido individual usando o contrato compartilhado', async () => {
    const input = fixture();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify([input]))).mockResolvedValueOnce(new Response(JSON.stringify(input)));
    const api = createAssemblyApi('http://kitchen.test', fetcher);
    expect(await api.list()).toEqual([mapAssemblyOrder(input)]);
    expect(await api.load(input.id)).toEqual(mapAssemblyOrder(input));
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['http://kitchen.test/orders/v2', 'http://kitchen.test/orders/v2/order-structured']);
  });
  it('inteira Broto preserva tamanho, estado, borda e observação', () => {
    const input = fixture(), pizza = input.items[0] as SavedPizza;
    pizza.recipe = { ...pizza.recipe, size: 'BROTO', composition: 'WHOLE' };
    delete (pizza.recipe as { secondHalf?: unknown }).secondHalf;
    pizza.snapshot = { ...pizza.snapshot, size: 'BROTO', composition: 'WHOLE' };
    delete pizza.snapshot.secondHalf;
    const result = mapAssemblyOrder(input)!;
    expect(result.items[0]).toMatchObject({ size: 'BROTO', composition: 'WHOLE', status: 'WAITING_ASSEMBLY', notes: 'Bem assada' });
    expect(crustLabel(result.items[0])).toBe('Borda: Tradicional');
  });
  it('meio a meio usa fichas independentes do snapshot, sem catálogo atual', () => {
    const input = fixture(), pizza = input.items[0] as SavedPizza;
    pizza.recipe.firstHalf.flavorId = 'retirado-do-catalogo';
    pizza.snapshot.firstHalf.flavorId = 'retirado-do-catalogo';
    pizza.snapshot.firstHalf.name = 'Nome histórico';
    pizza.snapshot.firstHalf.ingredients[0].name = 'Ingrediente histórico';
    pizza.snapshot.crust.name = 'Borda histórica';
    const read = mapAssemblyOrder(input)!.items[0];
    expect(pizzaName(read)).toBe('Nome histórico / Portuguesa');
    expect(halfName(read, 0)).toBe('Nome histórico');
    expect(crustLabel(read)).toBe('Borda: Borda histórica');
    expect(pizzaIngredients(read, 0)).toMatchObject([{ name: 'Ingrediente histórico' }, { name: 'Cebola', kind: 'REMOVED' }]);
    expect(pizzaIngredients(read, 1).some(item => item.name === 'Bacon' && item.kind === 'ADDED')).toBe(true);
  });
  it('extras são contador de unidades, sem aparecer nas pizzas', () => {
    const result = mapAssemblyOrder(fixture())!;
    expect(result.items).toHaveLength(1); expect(result.extraCount).toBe(2);
  });
  it('ignora explicitamente v1, sem converter texto nem inventar metades', () => {
    expect(mapAssemblyOrder({ id: 'v1', number: 1, customerName: 'Legado', customerPhone: null, type: 'PICKUP', status: 'WAITING_PRODUCTION', notes: null, receivedAt: '2026-10-05T18:00:00.000Z', createdAt: '2026-10-05T18:00:00.000Z', updatedAt: '2026-10-05T18:00:00.000Z', items: [{ id: 'item', name: 'Texto livre', size: 'Média', ingredients: 'Texto', notes: null, status: 'WAITING', modifiers: [] }] })).toBeNull();
  });
  it('exclui pedidos fora da montagem e pedidos sem pizza pendente de montagem', () => {
    const input = fixture(); input.status = 'OVEN'; expect(mapAssemblyOrder(input)).toBeNull();
    input.status = 'IN_PRODUCTION'; const pizza = input.items[0] as SavedPizza;
    pizza.production.state = 'WAITING_OVEN'; pizza.production.assemblyStartedAt = input.receivedAt; pizza.production.assemblyCompletedAt = input.receivedAt;
    expect(mapAssemblyOrder(input)).toBeNull();
  });
  it('preserva estado individual em pedido com etapas diferentes', () => {
    const input = fixture(); input.status = 'IN_PRODUCTION'; const pizza = input.items[0] as SavedPizza;
    pizza.production.state = 'ASSEMBLY_PAUSED'; pizza.production.assemblyStartedAt = input.receivedAt; pizza.production.pausedAt = input.receivedAt;
    expect(mapAssemblyOrder(input)?.items[0]).toMatchObject({ status: 'ASSEMBLY_PAUSED', paused: true });
  });
  it('fila vazia e erro HTTP são explícitos; resposta inválida não vira mock', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('[]')).mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(new Response('{}'));
    const api = createAssemblyApi('http://kitchen.test', fetcher);
    expect(await api.list()).toEqual([]);
    await expect(api.list()).rejects.toThrow('HTTP 503');
    await expect(api.list()).rejects.toThrow('lista de pedidos');
  });
  it('ordenação antigo/recente não altera dados recebidos', () => {
    const one = mapAssemblyOrder(fixture())!, two = { ...one, id: 'second', number: 3, receivedAt: '2026-10-05T19:00:00.000Z' };
    expect(sortOrders([two, one], 'ASC').map(order => order.id)).toEqual([one.id, two.id]);
    expect(sortOrders([one, two], 'DESC').map(order => order.id)).toEqual([two.id, one.id]);
  });
  it('30 pizzas são lidas por posição sem slots artificiais', () => {
    const input = fixture(), first = input.items[0];
    input.items = Array.from({ length: 30 }, (_, index) => ({ ...structuredClone(first), id: `pizza-${index}`, position: index }));
    expect(mapAssemblyOrder(input)?.items).toHaveLength(30);
  });
  it('refetch preserva seleção válida, corrige itens removidos e limpa fila vazia', () => {
    const one = mapAssemblyOrder(fixture())!;
    let state = assemblyReducer(createAssemblyState(Date.now()), { type: 'SYNC_ORDERS', orders: [one] });
    state = assemblyReducer(state, { type: 'SELECT_PIZZA', orderId: one.id, pizzaId: one.items[0].id });
    expect(assemblyReducer(state, { type: 'SYNC_ORDERS', orders: [one] }).selectedPizzaIds).toEqual(state.selectedPizzaIds);
    expect(assemblyReducer(state, { type: 'SYNC_ORDERS', orders: [] }).selectedOrderId).toBeNull();
  });
});
