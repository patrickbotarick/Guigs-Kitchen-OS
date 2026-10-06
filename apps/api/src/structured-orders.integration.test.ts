import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRecipeSnapshot, type CreateStructuredOrderInput } from '@guigs/shared';
import { additionalIngredients, extraCatalog, pizzaCrusts, recipeCatalog } from '@guigs/shared/catalog';
import { createApp } from './app.js';
import { OrderService } from './orders.js';
import { IdempotencyConflictError, StructuredOrderService } from './structured-orders.js';

const name = `test-structured-${randomUUID()}.db`;
const path = resolve(process.cwd(), 'prisma', name);
const prisma = new PrismaClient({ datasources: { db: { url: `file:./${name}` } } });
const service = new StructuredOrderService(prisma, undefined, 1);
const legacy = new OrderService(prisma);
const publish = vi.fn();
const app = createApp(legacy, publish, 'http://localhost:5173', service);
function payload(): CreateStructuredOrderInput {
  return { clientRequestId: randomUUID(), customerName: 'Pedido estruturado', customerPhone: '', fulfillmentType: 'DELIVERY', channel: 'COUNTER', notes: 'Portão lateral',
    pizzas: [{ size: 'GRANDE', composition: 'WHOLE', firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: 'Cortar em 8' }], extras: [] };
}
async function counts() {
  return Promise.all([prisma.order.count(), prisma.pizzaItem.count(), prisma.pizzaHalf.count(), prisma.pizzaIngredientModifier.count(), prisma.extraItem.count(), prisma.pizzaProductionHistory.count(), prisma.orderStatusHistory.count(), prisma.structuredOrderCreation.count(), prisma.orderCounter.findUnique({ where: { id: 1 } }).then(counter => counter?.value ?? 0)]);
}
beforeAll(async () => {
  writeFileSync(path, '');
  const migrations = resolve(process.cwd(), 'prisma/migrations');
  for (const directory of readdirSync(migrations).filter(name => /^\d/.test(name)).sort()) {
    const sql = readFileSync(resolve(migrations, directory, 'migration.sql'), 'utf8');
    for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
  }
});
afterAll(async () => {
  await prisma.$disconnect();
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
});

describe('criação persistente v2', () => {
  it('cria inteira, snapshot confiável, estado/timestamps e históricos iniciais', async () => {
    const input = payload();
    const { order, replayed } = await service.create(input);
    expect(replayed).toBe(false); expect(order.status).toBe('WAITING_PRODUCTION');
    const pizza = order.items[0];
    if (pizza.kind !== 'PIZZA') throw new Error('Pizza esperada');
    expect(pizza.position).toBe(0);
    expect(pizza.snapshot).toEqual(createRecipeSnapshot(input.pizzas[0], recipeCatalog));
    expect(pizza.snapshot.notes).toBe('Cortar em 8');
    expect(pizza.production).toMatchObject({ state: 'WAITING_ASSEMBLY', version: 0, queuedAt: order.receivedAt, assemblyStartedAt: null, assemblyCompletedAt: null, ovenStartedAt: null });
    expect(await prisma.pizzaProductionHistory.findMany({ where: { pizzaId: pizza.id } })).toMatchObject([{ eventType: 'CREATED', fromState: null, toState: 'WAITING_ASSEMBLY', changedAt: new Date(order.receivedAt), commandId: `${input.clientRequestId}:pizza:0`, itemVersion: 0 }]);
    expect((await legacy.history(order.id))).toBeNull();
    expect(await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } })).toMatchObject([{ fromStatus: null, toStatus: 'WAITING_PRODUCTION' }]);
  });
  it('meio a meio preserva modificadores independentes, borda e extras', async () => {
    const input = payload();
    input.pizzas = [{ size: 'GRANDE', composition: 'HALF_HALF', firstHalf: { flavorId: 'calabresa', modifiers: [{ type: 'REMOVE', ingredientId: 'cebola' }] }, secondHalf: { flavorId: 'mussarela', modifiers: [{ type: 'ADD', ingredientId: additionalIngredients[0].ingredientId }] }, crustId: pizzaCrusts.find(crust => crust.id !== 'tradicional')!.id, notes: null }];
    input.extras = [{ extraCatalogId: extraCatalog[0].id, quantity: 2, notes: 'Gelado' }];
    const { order } = await service.create(input);
    const pizza = order.items[0], extra = order.items[1];
    if (pizza.kind !== 'PIZZA' || pizza.recipe.composition !== 'HALF_HALF' || extra.kind !== 'EXTRA') throw new Error('Tipos incorretos');
    expect(pizza.recipe.firstHalf.modifiers).toEqual(input.pizzas[0].firstHalf.modifiers);
    if (input.pizzas[0].composition !== 'HALF_HALF') throw new Error('Fixture incorreta');
    expect(pizza.recipe.secondHalf.modifiers).toEqual(input.pizzas[0].secondHalf.modifiers);
    expect(pizza.snapshot.firstHalf.ingredients.find(item => item.ingredientId === 'cebola')?.kind).toBe('REMOVED');
    expect(pizza.snapshot.secondHalf?.ingredients.some(item => item.kind === 'ADDED')).toBe(true);
    expect(pizza.snapshot.crust.name).toBe(pizzaCrusts.find(crust => crust.id === pizza.recipe.crustId)?.name);
    expect(extra).toMatchObject({ position: 1, quantity: 2, notes: 'Gelado', snapshot: { name: extraCatalog[0].name }, state: 'WAITING_FINISHING', checkedQuantity: 0, checkedAt: null });
    expect(await service.get(order.id)).toEqual(order);
  });
  it('aceita Broto inteiro', async () => {
    const input = payload(); input.pizzas[0].size = 'BROTO';
    expect((await service.create(input)).order.items[0]).toMatchObject({ recipe: { size: 'BROTO', composition: 'WHOLE' } });
  });
  it.each([
    ['Broto meio a meio', { size: 'BROTO', composition: 'HALF_HALF', firstHalf: { flavorId: 'calabresa', modifiers: [] }, secondHalf: { flavorId: 'mussarela', modifiers: [] }, crustId: 'tradicional', notes: null }],
    ['meio a meio sem segunda metade', { size: 'GRANDE', composition: 'HALF_HALF', firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: null }],
    ['inteira com segunda metade', { size: 'GRANDE', composition: 'WHOLE', firstHalf: { flavorId: 'calabresa', modifiers: [] }, secondHalf: { flavorId: 'mussarela', modifiers: [] }, crustId: 'tradicional', notes: null }],
  ])('rejeita %s sem qualquer persistência', async (_label, pizza) => {
    const before = await counts();
    expect((await request(app).post('/orders/v2').send({ ...payload(), pizzas: [pizza] })).status).toBe(400);
    expect(await counts()).toEqual(before);
  });
  it.each([
    ['sabor', { firstHalf: { flavorId: 'inexistente', modifiers: [] } }],
    ['borda', { crustId: 'inexistente' }],
    ['ingrediente desconhecido', { firstHalf: { flavorId: 'calabresa', modifiers: [{ type: 'ADD', ingredientId: 'inexistente' }] } }],
    ['remoção fora da receita', { firstHalf: { flavorId: 'calabresa', modifiers: [{ type: 'REMOVE', ingredientId: 'mussarela' }] } }],
    ['adicional fora da lista permitida', { firstHalf: { flavorId: 'calabresa', modifiers: [{ type: 'ADD', ingredientId: 'molho-de-tomate' }] } }],
    ['modificador repetido', { firstHalf: { flavorId: 'calabresa', modifiers: [{ type: 'REMOVE', ingredientId: 'cebola' }, { type: 'REMOVE', ingredientId: 'cebola' }] } }],
    ['posição fornecida pelo cliente', { position: 7 }],
    ['snapshot fornecido pelo cliente', { snapshot: { name: 'Falso' } }],
  ])('rejeita %s e não consome número', async (_label, patch) => {
    const input = payload(), before = await counts();
    const response = await request(app).post('/orders/v2').send({ ...input, pizzas: [{ ...input.pizzas[0], ...patch }] });
    expect(response.status).toBe(400); expect(await counts()).toEqual(before);
  });
  it('rejeita extras inválidos, duplicados e soma superior a 30', async () => {
    const before = await counts();
    for (const extras of [ [{ extraCatalogId: 'falso', quantity: 1, notes: null }], [{ extraCatalogId: extraCatalog[0].id, quantity: 0, notes: null }], [1, 2].map(() => ({ extraCatalogId: extraCatalog[0].id, quantity: 1, notes: null })), extraCatalog.slice(0, 2).map(entry => ({ extraCatalogId: entry.id, quantity: 20, notes: null })) ]) {
      expect((await request(app).post('/orders/v2').send({ ...payload(), extras })).status).toBe(400);
    }
    expect(await counts()).toEqual(before);
  });
  it('gera posições únicas e contíguas com 30 pizzas e extras', async () => {
    const input = payload(); input.pizzas = Array.from({ length: 30 }, () => structuredClone(input.pizzas[0])); input.extras = [{ extraCatalogId: extraCatalog[0].id, quantity: 1, notes: null }];
    const { order } = await service.create(input);
    expect(order.items.map(item => item.position)).toEqual(Array.from({ length: 31 }, (_, index) => index));
    expect((await request(app).post('/orders/v2').send({ ...payload(), pizzas: [...input.pizzas, input.pizzas[0]] })).status).toBe(400);
  });
  it('aceita payload legítimo acima de 100kb com 30 pizzas e notas/modificadores', async () => {
    const input = payload();
    const flavor = Object.values(recipeCatalog.flavors).sort((a, b) => b.ingredientIds.length - a.ingredientIds.length)[0];
    const half = { flavorId: flavor.id, modifiers: [...flavor.ingredientIds.map(ingredientId => ({ type: 'REMOVE' as const, ingredientId })), ...additionalIngredients.map(entry => ({ type: 'ADD' as const, ingredientId: entry.ingredientId }))] };
    input.pizzas = Array.from({ length: 30 }, () => ({ size: 'GRANDE', composition: 'HALF_HALF', firstHalf: half, secondHalf: half, crustId: 'tradicional', notes: 'á'.repeat(1000) }));
    input.extras = extraCatalog.map(entry => ({ extraCatalogId: entry.id, quantity: 1, notes: 'x'.repeat(1000) }));
    expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(100 * 1024);
    const response = await request(app).post('/orders/v2').send(input);
    expect(response.status).toBe(201); expect(response.body.items).toHaveLength(33);
  });
  it('reenvio retorna a resposta original e emite apenas uma criação', async () => {
    const input = payload(); publish.mockClear();
    const first = await request(app).post('/orders/v2').send(input), before = await counts();
    const second = await request(app).post('/orders/v2').send(input);
    expect(first.status).toBe(201); expect(second.status).toBe(200);
    expect(second.headers['idempotency-replayed']).toBe('true'); expect(second.body).toEqual(first.body);
    expect(await counts()).toEqual(before); expect(publish).toHaveBeenCalledOnce();
    // Retry still returns the creation response if the persisted order changes later.
    await prisma.order.update({ where: { id: first.body.id }, data: { notes: 'Alterada depois' } });
    expect((await service.create(input)).order).toEqual(first.body);
    await expect(service.create({ ...input, notes: 'Outro conteúdo' })).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect((await request(app).post('/orders/v2').send({ ...input, notes: 'Outro conteúdo' })).status).toBe(409);
  });
  it('requisições concorrentes com a mesma chave criam apenas um pedido', async () => {
    const input = payload(), before = await prisma.order.count();
    const results = await Promise.all([service.create(input), service.create(input)]);
    expect(results[0].order).toEqual(results[1].order);
    expect(results.filter(result => !result.replayed)).toHaveLength(1);
    expect(await prisma.order.count()).toBe(before + 1);
  });
  it('falha na gravação do histórico desfaz tudo, inclusive contador e idempotência', async () => {
    const before = await counts(), input = payload();
    await prisma.$executeRawUnsafe("CREATE TRIGGER fail_pizza_history BEFORE INSERT ON PizzaProductionHistory BEGIN SELECT RAISE(ABORT, 'history failed'); END");
    try { await expect(service.create(input)).rejects.toThrow(); expect(await counts()).toEqual(before); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER fail_pizza_history'); }
    expect((await service.create(input)).replayed).toBe(false);
  });
  it('leitura e fluxo v1 preservados; leitura v2 explícita, contador compartilhado', async () => {
    const v1 = await request(app).post('/orders').send({ customerName: 'Legado', type: 'PICKUP', items: [{ name: 'Texto antigo', size: 'Média', ingredients: 'Texto livre', modifiers: [] }] });
    const v2 = await request(app).post('/orders/v2').send(payload());
    expect(v1.status).toBe(201); expect(v2.status).toBe(201); expect(v2.body.number).toBe(v1.body.number + 1);
    expect((await request(app).get(`/orders/${v1.body.id}`)).body).toEqual(v1.body);
    expect((await request(app).get(`/orders/v2/${v2.body.id}`)).body).toEqual(v2.body);
    expect((await request(app).get('/orders')).body.some((order: { id: string }) => order.id === v2.body.id)).toBe(false);
    expect((await request(app).get('/orders/v2')).body.some((order: { id: string }) => order.id === v2.body.id)).toBe(true);
    expect((await request(app).get(`/orders/v2/${v1.body.id}`)).status).toBe(404);
    expect((await request(app).get(`/orders/${v2.body.id}`)).status).toBe(404);
    expect(await prisma.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
  });
});
