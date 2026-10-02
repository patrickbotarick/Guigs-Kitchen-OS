import { describe, expect, it } from 'vitest';
import { assemblyReducer, canCompleteOrder, completedPizzas, createAssemblyState, orderStage, pizzasOf, sortOrders, transitionPizza } from './assembly';
import { createMockOrder } from './mockOrders';
import type { AssemblyState } from './assembly';
import { additionalIngredients, catalogReviews, favoriteReprints, featuredFlavorIds, flavorsById, ingredients, ingredientsById, pizzaCrusts, pizzaFlavors } from './catalog';
import { createPizzaDraft, resolveIngredients, validatePizzaDraft } from './pizzaRecipe';
import type { PizzaDraft } from './types';

const now = Date.parse('2026-10-01T22:00:00Z');
const time = new Date(now).toISOString();
function sendAllToOven(state: AssemblyState, orderId: string) {
  const order = state.orders.find(order => order.id === orderId)!;
  for (const pizza of pizzasOf(order)) {
    state = assemblyReducer(state, { type: 'PIZZA_ACTION', orderId, pizzaId: pizza.id, action: 'START' });
    state = assemblyReducer(state, { type: 'PIZZA_ACTION', orderId, pizzaId: pizza.id, action: 'SEND_TO_OVEN' });
  }
  return state;
}

describe('montagem individual e transferência de pedidos', () => {
  it('não permite forno antes de iniciar, durante pausa ou depois de concluída', () => {
    const pizza = pizzasOf(createAssemblyState(now).orders[0])[0];
    expect(transitionPizza(pizza, 'SEND_TO_OVEN')).toBe(pizza);
    expect(transitionPizza(pizza, 'PAUSE')).toBe(pizza);
    const active = transitionPizza(pizza, 'START');
    const paused = transitionPizza(active, 'PAUSE');
    expect(paused.paused).toBe(true);
    expect(transitionPizza(paused, 'SEND_TO_OVEN')).toBe(paused);
    const completed = transitionPizza(transitionPizza(paused, 'RESUME'), 'SEND_TO_OVEN');
    expect(completed.status).toBe('OVEN');
    expect(transitionPizza(completed, 'START')).toBe(completed);
    expect(transitionPizza(completed, 'SEND_TO_OVEN')).toBe(completed);
    expect(pizza.status).toBe('WAITING');
  });

  it('mantém a timeline em montagem quando há forno + montagem + aguardando', () => {
    let state = createAssemblyState(now);
    const orderId = state.orders[0].id;
    const pizzas = pizzasOf(state.orders[0]);
    expect(orderStage(state.orders[0])).toBe('WAITING_PRODUCTION');
    state = assemblyReducer(state, { type: 'PIZZA_ACTION', orderId, pizzaId: pizzas[0].id, action: 'START' });
    state = assemblyReducer(state, { type: 'PIZZA_ACTION', orderId, pizzaId: pizzas[0].id, action: 'SEND_TO_OVEN' });
    state = assemblyReducer(state, { type: 'PIZZA_ACTION', orderId, pizzaId: pizzas[1].id, action: 'START' });
    expect(pizzasOf(state.orders[0]).map(item => item.status)).toEqual(['OVEN', 'IN_PRODUCTION', 'WAITING']);
    expect(completedPizzas(state.orders[0])).toBe(1);
    expect(orderStage(state.orders[0])).toBe('IN_PRODUCTION');
    expect(canCompleteOrder(state.orders[0])).toBe(false);
    expect(assemblyReducer(state, { type: 'COMPLETE_ORDER', orderId, occurredAt: time })).toBe(state);
  });

  it('transfere uma única vez, preservando extras e o estado real do forno', () => {
    let state = createAssemblyState(now);
    const orderId = state.orders[0].id;
    state = sendAllToOven(state, orderId);
    expect(orderStage(state.orders[0])).toBe('OVEN');
    expect(completedPizzas(state.orders[0])).toBe(3);
    state = assemblyReducer(state, { type: 'COMPLETE_ORDER', orderId, occurredAt: time });
    expect(state.orders).toHaveLength(4);
    expect(state.selectedOrderId).toBe(state.orders[0].id);
    expect(state.handoffs).toHaveLength(1);
    expect(state.handoffs[0]).toMatchObject({ type: 'assembly.completed', orderStatus: 'OVEN', destination: 'FINISHING' });
    expect(state.handoffs[0].order.extraCount).toBe(3);
    expect(assemblyReducer(state, { type: 'COMPLETE_ORDER', orderId, occurredAt: time })).toBe(state);
  });

  it('lembra a pizza selecionada por pedido sem alterar estados na seleção', () => {
    let state = createAssemblyState(now);
    const [first, second] = state.orders;
    const pizzaId = pizzasOf(first)[2].id;
    state = assemblyReducer(state, { type: 'SELECT_PIZZA', orderId: first.id, pizzaId });
    state = assemblyReducer(state, { type: 'SELECT_ORDER', orderId: second.id });
    state = assemblyReducer(state, { type: 'SELECT_ORDER', orderId: first.id });
    expect(state.selectedPizzaIds[first.id]).toBe(pizzaId);
    expect(state.orders[0]).toBe(first);
    expect(assemblyReducer(state, { type: 'SELECT_PIZZA', orderId: second.id, pizzaId })).toBe(state);
  });

  it('recebe pedidos sem roubar seleção, numera sem colisões e recupera fila vazia', () => {
    let state = createAssemblyState(now);
    const input = { customerName: 'Novo cliente', channel: 'WHATSAPP' as const, pizzas: Array.from({ length: 6 }, () => createPizzaDraft()), extraCount: 5 };
    state = assemblyReducer(state, { type: 'ARRIVE', input, receivedAt: time });
    expect(state.selectedOrderId).toBe('demo-order-1001');
    expect(state.orders.at(-1)?.number).toBe(1006);
    expect(pizzasOf(state.orders.at(-1)!)).toHaveLength(6);
    expect(state.orders.at(-1)!.extraCount).toBe(5);
    for (const order of [...state.orders]) {
      state = sendAllToOven(state, order.id);
      state = assemblyReducer(state, { type: 'COMPLETE_ORDER', orderId: order.id, occurredAt: time });
    }
    expect(state.selectedOrderId).toBeNull();
    expect(state.orders).toHaveLength(0);
    state = assemblyReducer(state, { type: 'ARRIVE', input, receivedAt: time });
    expect(state.orders[0].number).toBe(1007);
    expect(state.selectedOrderId).toBe(state.orders[0].id);
  });

  it('rejeita quantidades inválidas e não considera pedido sem pizza concluído', () => {
    const input = { customerName: 'Cliente', channel: 'PICKUP' as const, pizzas: [createPizzaDraft()], extraCount: 0 };
    for (const count of [0, 31]) expect(() => createMockOrder(1, { ...input, pizzas: Array.from({ length: count }, () => createPizzaDraft()) }, time)).toThrow();
    expect(() => createMockOrder(1, { ...input, extraCount: -1 }, time)).toThrow();
    const order = createMockOrder(1, input, time);
    expect(order.extraCount).toBe(0);
    expect(canCompleteOrder({ ...order, items: [] })).toBe(false);
  });
});

describe('catálogo oficial e composição por referência', () => {
  it('contém 60 sabores únicos, 50 ingredientes normalizados, 12 adicionais e 5 bordas recheadas', () => {
    expect(pizzaFlavors).toHaveLength(60);
    expect(new Set(pizzaFlavors.map(item => item.id)).size).toBe(60);
    expect(['TRADICIONAL', 'ESPECIAL', 'PREMIUM', 'DOCE'].map(category => pizzaFlavors.filter(item => item.category === category).length)).toEqual([21, 20, 9, 10]);
    expect(ingredients).toHaveLength(50);
    expect(new Set(ingredients.map(item => item.id)).size).toBe(50);
    expect(additionalIngredients).toHaveLength(12);
    expect(pizzaCrusts.filter(item => item.source === 'PDF_PAGE_4')).toHaveLength(5);
    for (const flavor of pizzaFlavors) {
      expect(flavor.ingredientIds.every(id => ingredientsById[id])).toBe(true);
      expect(new Set(flavor.ingredientIds).size).toBe(flavor.ingredientIds.length);
      expect(flavor.pricesInCents.BROTO).toBeGreaterThan(0);
      expect(flavor.pricesInCents.GRANDE).toBeGreaterThan(0);
    }
    expect(pizzaFlavors.filter(item => item.featured).map(item => item.id).sort()).toEqual([...featuredFlavorIds].sort());
    expect(favoriteReprints.every(item => flavorsById[item.flavorId])).toBe(true);
  });

  it('preserva receitas sem completar mussarela, tomate, azeitona ou orégano por suposição', () => {
    expect(flavorsById.calabresa.ingredientIds).toEqual(['molho-de-tomate', 'calabresa', 'cebola', 'azeitona', 'oregano']);
    expect(flavorsById['palmito-com-requeijao'].ingredientIds).not.toContain('mussarela');
    expect(flavorsById.vegetariana.ingredientIds).not.toContain('mussarela');
    expect(flavorsById['salmao-cream-cheese'].ingredientIds).toEqual(['molho-de-tomate', 'mussarela', 'salmao', 'cream-cheese', 'cebola-roxa', 'tomate-cereja']);
    expect(flavorsById['temaki-atum'].ingredientIds).not.toContain('azeitona');
    expect(flavorsById['coalho-com-melado-de-cana'].ingredientIds).toEqual(['molho-de-tomate', 'mussarela', 'queijo-coalho', 'melado-de-cana']);
    expect(flavorsById['banana-nevada'].ingredientIds).toEqual(['rodelas-de-banana', 'cobertura-de-chocolate-branco-caramelizado']);
    expect(pizzaFlavors.filter(item => item.category === 'DOCE').every(item => !item.ingredientIds.includes('mussarela') && !item.ingredientIds.includes('molho-de-tomate'))).toBe(true);
    expect(ingredientsById.catupiry).toBeUndefined();
    expect(catalogReviews.find(item => item.id === 'catupiry-not-listed')?.status).toBe('needs_review');
  });

  it('permite Grande meio a meio e rejeita Broto meio a meio inclusive fora da interface', () => {
    const pizza: PizzaDraft = { ...createPizzaDraft(), size: 'GRANDE', composition: 'HALF_HALF', secondHalf: { flavorId: 'portuguesa', modifiers: [] } };
    expect(() => validatePizzaDraft(pizza)).not.toThrow();
    expect(() => validatePizzaDraft({ ...pizza, size: 'BROTO' } as unknown as PizzaDraft)).toThrow(/Broto/);
    expect(() => validatePizzaDraft({ ...createPizzaDraft('mussarela'), size: 'BROTO' })).not.toThrow();
    expect(() => validatePizzaDraft({ ...pizza, composition: 'WHOLE' } as unknown as PizzaDraft)).toThrow(/segunda metade/);
  });

  it('resolve receitas independentes e modificadores por metade sem copiar ficha para o pedido', () => {
    const pizza: PizzaDraft = { ...createPizzaDraft(), size: 'GRANDE', composition: 'HALF_HALF',
      firstHalf: { flavorId: 'calabresa', modifiers: [{ type: 'REMOVE', ingredientId: 'cebola' }, { type: 'ADD', ingredientId: 'bacon' }] },
      secondHalf: { flavorId: 'portuguesa', modifiers: [] }, crustId: 'cheddar' };
    const order = createMockOrder(99, { customerName: 'Meias', channel: 'COUNTER', pizzas: [pizza], extraCount: 10 }, time);
    expect(order.items).toHaveLength(1);
    expect(order.items[0].crustId).toBe('cheddar');
    expect(order.items[0]).not.toHaveProperty('ingredients');
    expect(order.items[0].firstHalf.modifiers.map(item => item.type)).toEqual(['REMOVE', 'ADD']);
    expect(resolveIngredients(pizza.firstHalf).find(item => item.id === 'cebola')?.kind).toBe('REMOVED');
    expect(resolveIngredients(pizza.firstHalf).find(item => item.id === 'bacon')?.kind).toBe('ADDED');
    expect(resolveIngredients(pizza.secondHalf).find(item => item.id === 'cebola')?.kind).toBe('NORMAL');
    expect(resolveIngredients(pizza.secondHalf).map(item => item.id)).toContain('ervilha');
    expect(resolveIngredients(pizza.firstHalf).map(item => item.id)).not.toContain('ervilha');
    pizza.firstHalf.modifiers.length = 0;
    expect(order.items[0].firstHalf.modifiers).toHaveLength(2);
    const finished = transitionPizza(transitionPizza(order.items[0], 'START'), 'SEND_TO_OVEN');
    expect(canCompleteOrder({ ...order, items: [finished] })).toBe(true);
  });

  it('rejeita adicionais não oficiais, borda inexistente e remoção fora da receita', () => {
    const pizza = createPizzaDraft();
    expect(() => validatePizzaDraft({ ...pizza, crustId: 'catupiry' })).toThrow(/Borda/);
    expect(() => validatePizzaDraft({ ...pizza, firstHalf: { flavorId: 'calabresa', modifiers: [{ type: 'ADD', ingredientId: 'catupiry' }] } })).toThrow(/Adicional/);
    expect(() => validatePizzaDraft({ ...pizza, firstHalf: { flavorId: 'calabresa', modifiers: [{ type: 'REMOVE', ingredientId: 'mussarela' }] } })).toThrow(/remover/);
    expect(() => validatePizzaDraft({ ...pizza, firstHalf: { flavorId: 'calabresa', modifiers: [{ type: 'ADD', ingredientId: 'bacon' }, { type: 'ADD', ingredientId: 'bacon' }] } })).toThrow(/duplicado/);
  });
});

describe('ordenação da fila', () => {
  it('ordena ASC e DESC pelo horário, sem depender da posição nem alterar a lista', () => {
    const state = createAssemblyState(now);
    const unordered = [state.orders[3], state.orders[0], state.orders[4], state.orders[1], state.orders[2]];
    expect(sortOrders(unordered, 'ASC').map(order => order.number)).toEqual([1001, 1002, 1003, 1004, 1005]);
    expect(sortOrders(unordered, 'DESC').map(order => order.number)).toEqual([1005, 1004, 1003, 1002, 1001]);
    expect(unordered[0].number).toBe(1004);
    const sameTime = state.orders.map(order => ({ ...order, receivedAt: time }));
    expect(sortOrders(sameTime, 'DESC')[0].number).toBe(1005);
  });
  it('alterna a ordem preservando seleção e escolhe o próximo pedido na ordem exibida', () => {
    let state = createAssemblyState(now);
    const orderId = state.orders[0].id;
    state = assemblyReducer(state, { type: 'TOGGLE_SORT' });
    expect(state.sortDirection).toBe('DESC');
    expect(state.selectedOrderId).toBe(orderId);
    state = sendAllToOven(state, orderId);
    state = assemblyReducer(state, { type: 'COMPLETE_ORDER', orderId, occurredAt: time });
    expect(state.selectedOrderId).toBe('demo-order-1005');
    expect(assemblyReducer(state, { type: 'TOGGLE_SORT' }).sortDirection).toBe('ASC');
  });
});
