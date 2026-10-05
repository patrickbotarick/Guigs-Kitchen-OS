import { createRecipeSnapshot, type Order, type PizzaDraft, type RecipeCatalog } from '@guigs/shared';

export const time = '2026-10-05T18:00:00.000Z';
export const catalog: RecipeCatalog = {
  revisionId: 'menu-2026',
  flavors: {
    calabresa: { id: 'calabresa', name: 'Calabresa', ingredientIds: ['tomate', 'cebola'] },
    portuguesa: { id: 'portuguesa', name: 'Portuguesa', ingredientIds: ['tomate', 'ovo'] },
  },
  ingredients: { tomate: { id: 'tomate', name: 'Tomate' }, cebola: { id: 'cebola', name: 'Cebola' }, ovo: { id: 'ovo', name: 'Ovo' }, bacon: { id: 'bacon', name: 'Bacon' } },
  crusts: { tradicional: { id: 'tradicional', revisionId: 'menu-2026', name: 'Tradicional', priceInCents: null } },
  additionalIngredientIds: ['bacon'],
};
export function structuredFixture(): Order {
  const draft: PizzaDraft = { size: 'GRANDE', composition: 'HALF_HALF', firstHalf: { flavorId: 'calabresa', modifiers: [{ type: 'REMOVE', ingredientId: 'cebola' }] },
    secondHalf: { flavorId: 'portuguesa', modifiers: [{ type: 'ADD', ingredientId: 'bacon' }] }, crustId: 'tradicional', notes: 'Bem assada' };
  const { notes, ...recipe } = draft;
  return {
    schemaVersion: 2, id: 'order-structured', number: 2, customerName: 'Cliente estruturado', customerPhone: null, fulfillmentType: 'PICKUP', channel: 'COUNTER', notes: null,
    receivedAt: time, createdAt: time, updatedAt: time, version: 0, status: 'WAITING_PRODUCTION', packingFinishedAt: null, packingFinishedBy: null,
    items: [{ id: 'pizza-structured', orderId: 'order-structured', position: 0, kind: 'PIZZA', notes, recipe, snapshot: createRecipeSnapshot(draft, catalog),
      production: { state: 'WAITING_ASSEMBLY', version: 0, queuedAt: time, assemblyStartedAt: null, pausedAt: null, assemblyCompletedAt: null,
        ovenStartedAt: null, ovenExpectedEndAt: null, bakedAt: null, finishingStartedAt: null, finishedAt: null, cancelledAt: null } },
    { id: 'extra-structured', orderId: 'order-structured', position: 1, kind: 'EXTRA', notes: null, extraCatalogId: 'coca-2l', catalogRevisionId: 'extras-2026',
      snapshot: { name: 'Coca-Cola 2L' }, quantity: 2, state: 'WAITING_FINISHING', checkedQuantity: 0, checkedAt: null, checkedBy: null, version: 0 }],
  };
}
