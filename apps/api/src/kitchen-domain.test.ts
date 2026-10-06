import { describe, expect, it } from 'vitest';
import { canTransitionPizza, createRecipeSnapshot, deriveOrderProductionState, extraItemSchema, isLogisticsOrderStatus, pizzaDraftSchema, pizzaItemSchema,
  pizzaProductionStateSchema, pizzaProductionStates, readOrderData, structuredOrderSchema, type PizzaProductionState } from '@guigs/shared';
import { catalog, structuredFixture, time } from './test-fixtures/kitchen.js';

describe('contrato compartilhado Kitchen v2', () => {
  it('aceita os nove estados e rejeita estados agregados/genéricos', () => {
    for (const state of pizzaProductionStates) expect(pizzaProductionStateSchema.parse(state)).toBe(state);
    for (const state of ['OVEN', 'IN_PRODUCTION', 'DONE', 'WAITING']) expect(pizzaProductionStateSchema.safeParse(state).success).toBe(false);
  });
  it('valida a matriz de transições sem saltos, repetições ou reabertura', () => {
    const pairs = new Set(['WAITING_ASSEMBLY:ASSEMBLING', 'ASSEMBLING:ASSEMBLY_PAUSED', 'ASSEMBLY_PAUSED:ASSEMBLING', 'ASSEMBLING:WAITING_OVEN', 'ASSEMBLING:IN_OVEN', 'WAITING_OVEN:IN_OVEN', 'IN_OVEN:BAKED', 'BAKED:FINISHING', 'BAKED:FINISHED', 'FINISHING:FINISHED']);
    for (const from of pizzaProductionStates) for (const to of pizzaProductionStates) {
      expect(canTransitionPizza(from, to)).toBe(pairs.has(`${from}:${to}`) || (to === 'CANCELLED' && from !== 'FINISHED' && from !== 'CANCELLED'));
    }
  });
  it('Broto só permite inteira; Grande permite duas metades', () => {
    const pizza = structuredFixture().items[0];
    if (pizza.kind !== 'PIZZA') throw new Error('Fixture inválida');
    expect(pizzaDraftSchema.safeParse({ ...pizza.recipe, notes: null }).success).toBe(true);
    expect(pizzaDraftSchema.safeParse({ ...pizza.recipe, size: 'BROTO', notes: null }).success).toBe(false);
    const whole = { size: 'BROTO', composition: 'WHOLE', firstHalf: pizza.recipe.firstHalf, crustId: 'tradicional', notes: null };
    expect(pizzaDraftSchema.safeParse(whole).success).toBe(true);
    expect(pizzaDraftSchema.safeParse({ ...whole, secondHalf: whole.firstHalf }).success).toBe(false);
  });
  it('modificadores são independentes por metade e borda pertence à pizza', () => {
    const order = structuredOrderSchema.parse(structuredFixture());
    const pizza = order.items[0];
    if (pizza.kind !== 'PIZZA' || pizza.recipe.composition !== 'HALF_HALF') throw new Error('Fixture inválida');
    expect(pizza.recipe.firstHalf.modifiers).toEqual([{ type: 'REMOVE', ingredientId: 'cebola' }]);
    expect(pizza.recipe.secondHalf.modifiers).toEqual([{ type: 'ADD', ingredientId: 'bacon' }]);
    expect(pizza.snapshot.firstHalf.ingredients.find(item => item.ingredientId === 'cebola')?.kind).toBe('REMOVED');
    expect(pizza.snapshot.secondHalf?.ingredients.find(item => item.ingredientId === 'bacon')?.kind).toBe('ADDED');
    expect(pizzaDraftSchema.safeParse({ ...pizza.recipe, firstHalf: { ...pizza.recipe.firstHalf, crustId: 'tradicional' }, notes: null }).success).toBe(false);
    expect(pizzaDraftSchema.safeParse({ ...pizza.recipe, firstHalf: { ...pizza.recipe.firstHalf, modifiers: [...pizza.recipe.firstHalf.modifiers, ...pizza.recipe.firstHalf.modifiers] }, notes: null }).success).toBe(false);
  });
  it('snapshot preserva nomes/ingredientes/borda após edição do catálogo e do pedido', () => {
    const source = structuredClone(catalog);
    const draft = { size: 'BROTO' as const, composition: 'WHOLE' as const, firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: null };
    const snapshot = createRecipeSnapshot(draft, source);
    source.flavors.calabresa.name = 'Outro nome'; source.ingredients.tomate.name = 'Outro ingrediente'; source.crusts.tradicional.name = 'Outra borda';
    draft.firstHalf.flavorId = 'portuguesa';
    expect(snapshot.firstHalf.name).toBe('Calabresa');
    expect(snapshot.firstHalf.ingredients[0].name).toBe('Tomate');
    expect(snapshot.crust.name).toBe('Tradicional');
    expect(snapshot.crust.priceInCents).toBeNull();
  });
  it('rejeita referências inválidas e snapshot que contradiz a receita', () => {
    const draft = { size: 'BROTO' as const, composition: 'WHOLE' as const, firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: null };
    expect(() => createRecipeSnapshot({ ...draft, crustId: 'catupiry' }, catalog)).toThrow();
    expect(() => createRecipeSnapshot({ ...draft, firstHalf: { flavorId: 'inexistente', modifiers: [] } }, catalog)).toThrow();
    expect(() => createRecipeSnapshot({ ...draft, firstHalf: { flavorId: 'calabresa', modifiers: [{ type: 'REMOVE', ingredientId: 'ovo' }] } }, catalog)).toThrow();
    expect(() => createRecipeSnapshot({ ...draft, firstHalf: { flavorId: 'calabresa', modifiers: [{ type: 'ADD', ingredientId: 'ovo' }] } }, catalog)).toThrow();
    const pizza = structuredFixture().items[0];
    if (pizza.kind !== 'PIZZA') throw new Error('Fixture inválida');
    expect(pizzaItemSchema.safeParse({ ...pizza, snapshot: { ...pizza.snapshot, size: 'BROTO' } }).success).toBe(false);
  });
  it('extras são identificados e exigem conferência integral para finalizar', () => {
    const extra = structuredFixture().items[1];
    expect(extraItemSchema.safeParse(extra).success).toBe(true);
    expect(extraItemSchema.safeParse({ ...extra, quantity: 0 }).success).toBe(false);
    expect(extraItemSchema.safeParse({ ...extra, state: 'FINISHED' }).success).toBe(false);
    expect(extraItemSchema.safeParse({ ...extra, state: 'FINISHED', checkedQuantity: 2, checkedAt: time, checkedBy: 'finalizador' }).success).toBe(true);
  });
  it('leitura v1 mantém texto legado sem inferir tamanho/sabor ou histórico', () => {
    const legacy = { id: 'legacy', number: 1, customerName: 'Legado', customerPhone: null, type: 'DELIVERY', status: 'OVEN', notes: null, receivedAt: time, createdAt: time, updatedAt: time,
      items: [{ id: 'legacy-item', name: 'Frango com Catupiry', size: 'Média', ingredients: 'Texto livre', notes: null, status: 'WAITING', modifiers: [] }] };
    const result = readOrderData(legacy);
    expect(result).toEqual({ schemaVersion: 1, legacy: true, order: legacy });
    expect(result.order.items[0]).not.toHaveProperty('production');
    expect(readOrderData({ ...legacy, schemaVersion: 1 })).toEqual(result);
  });
  it('leitura v2 é explícita; versão desconhecida/malformada nunca cai no legado', () => {
    expect(readOrderData(structuredFixture()).legacy).toBe(false);
    expect(() => readOrderData({ ...structuredFixture(), schemaVersion: 3 })).toThrow();
    expect(() => readOrderData({ ...structuredFixture(), items: [] })).toThrow();
    expect(() => readOrderData({ ...structuredFixture(), items: structuredFixture().items.map(item => ({ ...item, orderId: 'outro' })) })).toThrow();
  });
  it('timestamps de pausa não ficam ativos fora da pausa', () => {
    const pizza = structuredFixture().items[0];
    if (pizza.kind !== 'PIZZA') throw new Error('Fixture inválida');
    expect(pizzaItemSchema.safeParse({ ...pizza, production: { ...pizza.production, state: 'ASSEMBLY_PAUSED', pausedAt: null } }).success).toBe(false);
    expect(pizzaItemSchema.safeParse({ ...pizza, production: { ...pizza.production, pausedAt: time } }).success).toBe(false);
    expect(pizzaItemSchema.safeParse({ ...pizza, production: { ...pizza.production, state: 'ASSEMBLY_PAUSED', assemblyStartedAt: time, pausedAt: time } }).success).toBe(true);
    expect(pizzaItemSchema.safeParse({ ...pizza, production: { ...pizza.production, state: 'BAKED' } }).success).toBe(false);
  });
});

describe('agregação da produção', () => {
  it.each<[PizzaProductionState[], string]>([
    [['WAITING_ASSEMBLY'], 'WAITING_PRODUCTION'], [['WAITING_OVEN', 'ASSEMBLING', 'WAITING_ASSEMBLY'], 'IN_PRODUCTION'],
    [['WAITING_OVEN', 'ASSEMBLY_PAUSED'], 'IN_PRODUCTION'], [['IN_OVEN', 'WAITING_OVEN', 'FINISHED'], 'OVEN'],
    [['BAKED', 'FINISHING'], 'FINISHING'], [['FINISHED'], 'FINISHING'], [['CANCELLED'], 'CANCELLED'],
  ])('agrega %j como %s', (pizzas, expected) => {
    expect(deriveOrderProductionState({ pizzas, extras: [], packingConfirmed: false })).toBe(expected);
  });
  it('despacho exige pizzas, extras e embalagem; cancelados não bloqueiam', () => {
    const extra = { state: 'WAITING_FINISHING' as const, quantity: 2, checkedQuantity: 0 };
    expect(deriveOrderProductionState({ pizzas: ['FINISHED'], extras: [extra], packingConfirmed: true })).toBe('FINISHING');
    expect(deriveOrderProductionState({ pizzas: ['FINISHED'], extras: [{ ...extra, state: 'FINISHED', checkedQuantity: 1 }], packingConfirmed: true })).toBe('FINISHING');
    expect(deriveOrderProductionState({ pizzas: ['FINISHED', 'CANCELLED'], extras: [{ ...extra, state: 'FINISHED', checkedQuantity: 2 }], packingConfirmed: true })).toBe('WAITING_DISPATCH');
    expect(() => deriveOrderProductionState({ pizzas: [], extras: [], packingConfirmed: true })).toThrow();
    expect(isLogisticsOrderStatus('DELIVERED')).toBe(true);
    expect(isLogisticsOrderStatus('OVEN')).toBe(false);
  });
});
