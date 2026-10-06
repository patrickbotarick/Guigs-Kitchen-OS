import { z } from 'zod';
import { itemStatuses, modifierKinds, orderStatuses, orderTypes, type OrderStatus } from './legacy.js';

const id = z.string().trim().min(1).max(120);
const instant = z.string().datetime();
const notes = z.string().max(1000).nullable();
export const pizzaSizes = ['BROTO', 'GRANDE'] as const;
export const pizzaCompositions = ['WHOLE', 'HALF_HALF'] as const;
export const pizzaProductionStates = ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED', 'WAITING_OVEN', 'IN_OVEN', 'BAKED', 'FINISHING', 'FINISHED', 'CANCELLED'] as const;
export type PizzaSize = typeof pizzaSizes[number];
export type PizzaComposition = typeof pizzaCompositions[number];
export type PizzaProductionState = typeof pizzaProductionStates[number];
export const pizzaProductionStateSchema = z.enum(pizzaProductionStates);
export const pizzaFlavorReferenceSchema = z.object({ flavorId: id }).strict();
export type PizzaFlavorReference = z.infer<typeof pizzaFlavorReferenceSchema>;
export const ingredientModifierSchema = z.object({ type: z.enum(['REMOVE', 'ADD']), ingredientId: id }).strict();
export type IngredientModifier = z.infer<typeof ingredientModifierSchema>;
export const pizzaHalfSchema = pizzaFlavorReferenceSchema.extend({ modifiers: z.array(ingredientModifierSchema).max(30) }).superRefine((half, ctx) => {
  const keys = half.modifiers.map(modifier => `${modifier.type}:${modifier.ingredientId}`);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'Modificador duplicado na metade.' });
});
export type PizzaHalf = z.infer<typeof pizzaHalfSchema>;
const whole = z.object({ size: z.enum(pizzaSizes), composition: z.literal('WHOLE'), firstHalf: pizzaHalfSchema, crustId: id, notes }).strict();
const halfHalf = z.object({ size: z.literal('GRANDE'), composition: z.literal('HALF_HALF'), firstHalf: pizzaHalfSchema, secondHalf: pizzaHalfSchema, crustId: id, notes }).strict();
export const pizzaDraftSchema = z.discriminatedUnion('composition', [whole, halfHalf]);
export const pizzaRecipeSchema = z.discriminatedUnion('composition', [whole.omit({ notes: true }), halfHalf.omit({ notes: true })]);
export type PizzaDraft = z.infer<typeof pizzaDraftSchema>;
export type PizzaRecipe =
  | { size: PizzaSize; composition: 'WHOLE'; firstHalf: PizzaHalf; secondHalf?: never }
  | { size: 'GRANDE'; composition: 'HALF_HALF'; firstHalf: PizzaHalf; secondHalf: PizzaHalf };
export const pizzaCrustSchema = z.object({ id, revisionId: id, name: id, priceInCents: z.number().int().nonnegative().nullable() }).strict();
export type PizzaCrust = z.infer<typeof pizzaCrustSchema>;

const snapshotHalfSchema = z.object({
  flavorId: id, name: id, modifiers: z.array(ingredientModifierSchema),
  ingredients: z.array(z.object({ ingredientId: id, name: id, kind: z.enum(['NORMAL', 'REMOVED', 'ADDED']) }).strict()).min(1),
}).strict();
export const recipeSnapshotSchema = z.object({
  schemaVersion: z.literal(1), catalogRevisionId: id,
  size: z.enum(pizzaSizes), composition: z.enum(pizzaCompositions),
  firstHalf: snapshotHalfSchema, secondHalf: snapshotHalfSchema.optional(),
  crust: pizzaCrustSchema,
  // Optional for reading snapshots created before Phase 3B; new snapshots always preserve notes.
  notes: notes.optional(),
}).strict().superRefine((snapshot, ctx) => {
  if ((snapshot.composition === 'HALF_HALF') !== Boolean(snapshot.secondHalf) || (snapshot.size === 'BROTO' && snapshot.composition !== 'WHOLE')) {
    ctx.addIssue({ code: 'custom', message: 'Snapshot incompatível com tamanho/composição.' });
  }
  if (snapshot.crust.revisionId !== snapshot.catalogRevisionId) ctx.addIssue({ code: 'custom', message: 'Revisão da borda incompatível.' });
});
export type RecipeSnapshot = z.infer<typeof recipeSnapshotSchema>;
export interface RecipeCatalog {
  revisionId: string;
  flavors: Record<string, { id: string; name: string; ingredientIds: string[] }>;
  ingredients: Record<string, { id: string; name: string }>;
  crusts: Record<string, PizzaCrust>;
  additionalIngredientIds: readonly string[];
}

// Future creation service must call this with a trusted catalog, never accept a client snapshot.
export function createRecipeSnapshot(input: PizzaDraft, catalog: RecipeCatalog): RecipeSnapshot {
  const pizza = pizzaDraftSchema.parse(input);
  const resolveHalf = (half: PizzaHalf) => {
    const flavor = catalog.flavors[half.flavorId];
    if (!flavor || flavor.id !== half.flavorId) throw new Error('Sabor não cadastrado.');
    for (const modifier of half.modifiers) {
      if (modifier.type === 'REMOVE' && !flavor.ingredientIds.includes(modifier.ingredientId)) throw new Error('Remoção fora da receita.');
      if (modifier.type === 'ADD' && !catalog.additionalIngredientIds.includes(modifier.ingredientId)) throw new Error('Adicional não permitido.');
    }
    const ingredient = (ingredientId: string, kind: 'NORMAL' | 'REMOVED' | 'ADDED') => {
      const source = catalog.ingredients[ingredientId];
      if (!source || source.id !== ingredientId) throw new Error('Ingrediente não cadastrado.');
      return { ingredientId, name: source.name, kind };
    };
    return {
      flavorId: flavor.id, name: flavor.name, modifiers: half.modifiers,
      ingredients: [
        ...flavor.ingredientIds.map(ingredientId => ingredient(ingredientId, half.modifiers.some(modifier => modifier.type === 'REMOVE' && modifier.ingredientId === ingredientId) ? 'REMOVED' : 'NORMAL')),
        ...half.modifiers.filter(modifier => modifier.type === 'ADD').map(modifier => ingredient(modifier.ingredientId, 'ADDED')),
      ],
    };
  };
  const crust = catalog.crusts[pizza.crustId];
  if (!crust || crust.id !== pizza.crustId) throw new Error('Borda não cadastrada.');
  // Zod creates detached data; later catalog/input edits cannot mutate the snapshot.
  return recipeSnapshotSchema.parse({ schemaVersion: 1, catalogRevisionId: catalog.revisionId, size: pizza.size, composition: pizza.composition,
    firstHalf: resolveHalf(pizza.firstHalf), ...(pizza.composition === 'HALF_HALF' ? { secondHalf: resolveHalf(pizza.secondHalf) } : {}), crust, notes: pizza.notes });
}

export const pizzaProductionSchema = z.object({
  state: pizzaProductionStateSchema, version: z.number().int().nonnegative(), queuedAt: instant,
  assemblyStartedAt: instant.nullable(), pausedAt: instant.nullable(), assemblyCompletedAt: instant.nullable(),
  ovenStartedAt: instant.nullable(), ovenExpectedEndAt: instant.nullable(), bakedAt: instant.nullable(),
  finishingStartedAt: instant.nullable(), finishedAt: instant.nullable(), cancelledAt: instant.nullable(),
}).strict().superRefine((production, ctx) => {
  if ((production.state === 'ASSEMBLY_PAUSED') !== (production.pausedAt !== null)) ctx.addIssue({ code: 'custom', message: 'pausedAt deve representar apenas a pausa atual.' });
  const stages = ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED', 'WAITING_OVEN', 'IN_OVEN', 'BAKED', 'FINISHING', 'FINISHED'];
  const stage = stages.indexOf(production.state);
  const milestones = [
    [1, production.assemblyStartedAt], [3, production.assemblyCompletedAt], [4, production.ovenStartedAt],
    [5, production.bakedAt], [6, production.finishingStartedAt], [7, production.finishedAt],
  ] as const;
  if (milestones.some(([threshold, value]) => stage >= threshold && value === null) || (production.state === 'CANCELLED' && production.cancelledAt === null)) {
    ctx.addIssue({ code: 'custom', message: 'Estado exige timestamps dos marcos já percorridos.' });
  }
  const dates = [production.queuedAt, production.assemblyStartedAt, production.assemblyCompletedAt, production.ovenStartedAt, production.bakedAt, production.finishingStartedAt, production.finishedAt].filter((date): date is string => date !== null);
  if (dates.some((date, index) => index > 0 && Date.parse(date) < Date.parse(dates[index - 1]))) ctx.addIssue({ code: 'custom', message: 'Timestamps de produção fora de ordem.' });
});
const baseItem = { id, orderId: id, position: z.number().int().nonnegative(), notes };
export const pizzaAssignmentSchema = z.object({ operatorId: id, operatorName: id, workstationId: id, sessionId: id, assignedAt: instant }).strict();
export type PizzaAssignment = z.infer<typeof pizzaAssignmentSchema>;
export const pizzaItemSchema = z.object({ ...baseItem, kind: z.literal('PIZZA'), recipe: pizzaRecipeSchema,
  snapshot: recipeSnapshotSchema, production: pizzaProductionSchema,
  assignment: pizzaAssignmentSchema.nullable().default(null), releasedAt: instant.nullable().default(null),
}).strict().superRefine((pizza, ctx) => {
  const { recipe, snapshot } = pizza;
  const modifierKeys = (modifiers: IngredientModifier[]) => modifiers.map(modifier => `${modifier.type}:${modifier.ingredientId}`).sort().join('|');
  const sameHalf = (half: PizzaHalf, saved: z.infer<typeof snapshotHalfSchema>) => half.flavorId === saved.flavorId
    && modifierKeys(half.modifiers) === modifierKeys(saved.modifiers);
  if ((snapshot.notes !== undefined && snapshot.notes !== pizza.notes) || recipe.size !== snapshot.size || recipe.composition !== snapshot.composition || recipe.crustId !== snapshot.crust.id
    || !sameHalf(recipe.firstHalf, snapshot.firstHalf)
    || (recipe.composition === 'HALF_HALF' && (!snapshot.secondHalf || !sameHalf(recipe.secondHalf, snapshot.secondHalf)))) {
    ctx.addIssue({ code: 'custom', message: 'Receita e snapshot incompatíveis.' });
  }
});
export type PizzaItem = z.infer<typeof pizzaItemSchema>;
export const extraItemSchema = z.object({ ...baseItem, kind: z.literal('EXTRA'), extraCatalogId: id, catalogRevisionId: id,
  quantity: z.number().int().min(1).max(30),
  snapshot: z.object({ name: id }).strict(),
  state: z.enum(['WAITING_FINISHING', 'FINISHED', 'CANCELLED']), checkedQuantity: z.number().int().nonnegative(),
  checkedAt: instant.nullable(), checkedBy: id.nullable(), version: z.number().int().nonnegative(),
}).strict().superRefine((extra, ctx) => {
  if (extra.checkedQuantity > extra.quantity || (extra.state === 'FINISHED' && (extra.checkedQuantity !== extra.quantity || !extra.checkedAt || !extra.checkedBy))) {
    ctx.addIssue({ code: 'custom', message: 'Conferência do extra incompleta ou quantidade inválida.' });
  }
});
export type ExtraItem = z.infer<typeof extraItemSchema>;
export type OrderItem = PizzaItem | ExtraItem;
export const structuredOrderSchema = z.object({
  schemaVersion: z.literal(2), id, number: z.number().int().positive(), customerName: id, customerPhone: z.string().max(30).nullable(),
  fulfillmentType: z.enum(orderTypes), channel: z.enum(['COUNTER', 'WHATSAPP', 'IFOOD', 'OTHER']), notes,
  receivedAt: instant, createdAt: instant, updatedAt: instant, version: z.number().int().nonnegative(), status: z.enum(orderStatuses),
  items: z.array(z.union([pizzaItemSchema, extraItemSchema])).min(1).max(60), packingFinishedAt: instant.nullable(), packingFinishedBy: id.nullable(),
}).strict().superRefine((order, ctx) => {
  if (order.items.some(item => item.orderId !== order.id) || new Set(order.items.map(item => item.id)).size !== order.items.length
    || new Set(order.items.map(item => item.position)).size !== order.items.length) ctx.addIssue({ code: 'custom', message: 'Itens devem ter IDs/posições únicos e pertencer ao pedido.' });
  const pizzas = order.items.filter(item => item.kind === 'PIZZA');
  const extras = order.items.filter(item => item.kind === 'EXTRA');
  if (pizzas.length < 1 || pizzas.length > 30 || extras.reduce((sum, item) => sum + item.quantity, 0) > 30) ctx.addIssue({ code: 'custom', message: 'Exige 1–30 pizzas e até 30 unidades de extras.' });
  if (Boolean(order.packingFinishedAt) !== Boolean(order.packingFinishedBy)) ctx.addIssue({ code: 'custom', message: 'Embalagem exige data e responsável.' });
});
export type Order = z.infer<typeof structuredOrderSchema>;

// Creation accepts intent only, never client IDs/positions/status/timestamps/snapshots.
export const createStructuredOrderSchema = z.object({
  clientRequestId: z.string().uuid(),
  customerName: id, customerPhone: z.string().trim().max(30).default(''),
  fulfillmentType: z.enum(orderTypes), channel: z.enum(['COUNTER', 'WHATSAPP', 'IFOOD', 'OTHER']),
  notes: z.string().trim().max(1000).default(''),
  pizzas: z.array(pizzaDraftSchema).min(1).max(30),
  extras: z.array(z.object({ extraCatalogId: id, quantity: z.number().int().min(1).max(30), notes }).strict()).max(30).default([]),
}).strict().superRefine((input, ctx) => {
  if (input.extras.reduce((sum, extra) => sum + extra.quantity, 0) > 30) ctx.addIssue({ code: 'custom', message: 'Máximo de 30 unidades de extras.' });
  if (new Set(input.extras.map(extra => extra.extraCatalogId)).size !== input.extras.length) ctx.addIssue({ code: 'custom', message: 'Use quantidade em vez de duplicar o mesmo extra.' });
});
export type CreateStructuredOrderInput = z.infer<typeof createStructuredOrderSchema>;

export const assemblyCommands = ['START_ASSEMBLY', 'PAUSE_ASSEMBLY', 'RESUME_ASSEMBLY', 'SEND_TO_OVEN', 'CLAIM_PIZZA', 'RELEASE_PIZZA'] as const;
export const ovenCommands = ['ENTER_OVEN', 'REMOVE_FROM_OVEN'] as const;
export const pizzaCommandSchema = z.object({
  command: z.enum([...assemblyCommands, ...ovenCommands]), expectedState: pizzaProductionStateSchema,
  expectedVersion: z.number().int().nonnegative(), clientCommandId: z.string().uuid(),
}).strict();
export type PizzaCommandInput = z.infer<typeof pizzaCommandSchema>;
export const pizzaCommandResultSchema = z.object({ order: structuredOrderSchema, pizzaId: id, clientCommandId: z.string().uuid(), replayed: z.boolean() }).strict();
export type PizzaCommandResult = z.infer<typeof pizzaCommandResultSchema>;
export const assemblyCommandTransitions = {
  START_ASSEMBLY: { from: 'WAITING_ASSEMBLY', to: 'ASSEMBLING' },
  PAUSE_ASSEMBLY: { from: 'ASSEMBLING', to: 'ASSEMBLY_PAUSED' },
  RESUME_ASSEMBLY: { from: 'ASSEMBLY_PAUSED', to: 'ASSEMBLING' },
  SEND_TO_OVEN: { from: 'ASSEMBLING', to: 'WAITING_OVEN' },
} as const;
export const ovenCommandTransitions = {
  ENTER_OVEN: { from: 'WAITING_OVEN', to: 'IN_OVEN' },
  REMOVE_FROM_OVEN: { from: 'IN_OVEN', to: 'BAKED' },
} as const;
export const ovenConfigurationSchema = z.object({ defaultOvenMinutes: z.number().positive().max(240), serverTime: z.string().datetime() }).strict();

const transitions: Record<PizzaProductionState, readonly PizzaProductionState[]> = {
  WAITING_ASSEMBLY: ['ASSEMBLING', 'CANCELLED'], ASSEMBLING: ['ASSEMBLY_PAUSED', 'WAITING_OVEN', 'CANCELLED'],
  ASSEMBLY_PAUSED: ['ASSEMBLING', 'CANCELLED'], WAITING_OVEN: ['IN_OVEN', 'CANCELLED'],
  IN_OVEN: ['BAKED', 'CANCELLED'], BAKED: ['FINISHING', 'CANCELLED'], FINISHING: ['FINISHED', 'CANCELLED'], FINISHED: [], CANCELLED: [],
};
export function canTransitionPizza(from: PizzaProductionState, to: PizzaProductionState): boolean {
  return transitions[from]?.includes(to) ?? false;
}
export type OrderProductionState = 'WAITING_PRODUCTION' | 'IN_PRODUCTION' | 'OVEN' | 'FINISHING' | 'WAITING_DISPATCH' | 'CANCELLED';
export function deriveOrderProductionState(input: {
  pizzas: readonly PizzaProductionState[];
  extras: readonly Pick<ExtraItem, 'state' | 'quantity' | 'checkedQuantity'>[];
  packingConfirmed: boolean;
}): OrderProductionState {
  // Runtime validation also protects API callers passing unchecked JSON.
  z.array(pizzaProductionStateSchema).parse(input.pizzas);
  z.array(z.object({ state: z.enum(['WAITING_FINISHING', 'FINISHED', 'CANCELLED']), quantity: z.number().int().positive(), checkedQuantity: z.number().int().nonnegative() })
    .refine(extra => extra.checkedQuantity <= extra.quantity)).parse(input.extras);
  z.boolean().parse(input.packingConfirmed);
  if (!input.pizzas.length && !input.extras.length) throw new Error('Pedido vazio não tem estágio de produção.');
  const pizzas = input.pizzas.filter(state => state !== 'CANCELLED');
  const extras = input.extras.filter(extra => extra.state !== 'CANCELLED');
  if (!pizzas.length && !extras.length) return 'CANCELLED';
  if (pizzas.length && pizzas.every(state => state === 'WAITING_ASSEMBLY')) return 'WAITING_PRODUCTION';
  if (pizzas.some(state => ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'].includes(state))) return 'IN_PRODUCTION';
  if (pizzas.some(state => state === 'WAITING_OVEN' || state === 'IN_OVEN')) return 'OVEN';
  if (pizzas.some(state => state !== 'FINISHED') || extras.some(extra => extra.state !== 'FINISHED' || extra.checkedQuantity !== extra.quantity) || !input.packingConfirmed) return 'FINISHING';
  return 'WAITING_DISPATCH';
}

const legacyOrderSchema = z.object({
  id, number: z.number().int().positive(), customerName: id, customerPhone: z.string().nullable(), type: z.enum(orderTypes), status: z.enum(orderStatuses), notes,
  receivedAt: instant, createdAt: instant, updatedAt: instant,
  items: z.array(z.object({ id, name: id, size: id, ingredients: z.string().nullable(), notes, status: z.enum(itemStatuses),
    modifiers: z.array(z.object({ id, kind: z.enum(modifierKinds), name: id }).strict()),
  }).strict()),
}).strict();
export type CompatibleOrder =
  | { schemaVersion: 1; legacy: true; order: z.infer<typeof legacyOrderSchema> }
  | { schemaVersion: 2; legacy: false; order: Order };
export function readOrderData(input: unknown): CompatibleOrder {
  if (typeof input !== 'object' || input === null) throw new Error('Pedido inválido.');
  const version = 'schemaVersion' in input ? input.schemaVersion : 1;
  if (version === 2) return { schemaVersion: 2, legacy: false, order: structuredOrderSchema.parse(input) };
  if (version !== 1) throw new Error('Versão de pedido não suportada.');
  const { schemaVersion: _version, ...legacy } = input as Record<string, unknown>;
  void _version;
  return { schemaVersion: 1, legacy: true, order: legacyOrderSchema.parse(legacy) };
}

// Production aggregation must not roll back a dispatched/delivered order.
export function isLogisticsOrderStatus(status: OrderStatus): boolean {
  return ['WAITING_DRIVER', 'OUT_FOR_DELIVERY', 'DELIVERED', 'READY_FOR_PICKUP', 'PICKED_UP'].includes(status);
}
