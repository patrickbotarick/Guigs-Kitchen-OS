import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCompatibleOrder } from './kitchen-data.js';
import { OrderService } from './orders.js';
import { structuredFixture, time } from './test-fixtures/kitchen.js';

const name = `test-kitchen-${randomUUID()}.db`;
const path = resolve(process.cwd(), 'prisma', name);
const prisma = new PrismaClient({ datasources: { db: { url: `file:./${name}` } } });
const migration = readFileSync(resolve(process.cwd(), 'prisma/migrations/20261005180000_structured_kitchen/migration.sql'), 'utf8');
let legacyBefore: unknown;
let historyBefore: unknown;
const selectLegacy = 'SELECT id, number, customerName, type, status, receivedAt, updatedAt FROM "Order" WHERE id = \'legacy-order\'';
async function apply(sql: string) {
  for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
}
beforeAll(async () => {
  writeFileSync(path, '');
  await apply(readFileSync(resolve(process.cwd(), 'prisma/migrations/20261001120000_init/migration.sql'), 'utf8'));
  await apply(readFileSync(resolve(process.cwd(), 'prisma/migrations/20261001150000_order_history/migration.sql'), 'utf8'));
  await prisma.$executeRaw`INSERT INTO "OrderCounter" (id, value) VALUES (1, 7)`;
  await prisma.$executeRaw`INSERT INTO "Order" (id, number, customerName, type, status, receivedAt, updatedAt) VALUES ('legacy-order', 7, 'Legado', 'DELIVERY', 'OVEN', ${new Date(time)}, ${new Date(time)})`;
  await prisma.$executeRaw`INSERT INTO "OrderItem" (id, orderId, name, size, ingredients, updatedAt) VALUES ('legacy-item', 'legacy-order', 'Frango com Catupiry', 'Média', 'Texto livre', ${new Date(time)})`;
  await prisma.$executeRaw`INSERT INTO "OrderItemModifier" (id, itemId, kind, name) VALUES ('legacy-modifier', 'legacy-item', 'CRUST', 'Catupiry')`;
  await prisma.$executeRaw`INSERT INTO "OrderStatusHistory" (id, orderId, toStatus, actorType) VALUES ('legacy-history', 'legacy-order', 'OVEN', 'OPERATOR')`;
  legacyBefore = await prisma.$queryRawUnsafe(selectLegacy);
  historyBefore = await prisma.$queryRaw`SELECT * FROM "OrderStatusHistory"`;
  await apply(migration);
  await apply(readFileSync(resolve(process.cwd(), 'prisma/migrations/20261005190000_structured_order_creation/migration.sql'), 'utf8'));
});
afterAll(async () => {
  await prisma.$disconnect();
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
});

describe('migração aditiva Kitchen e leitura compatível', () => {
  it('migration não remove/reconstrói tabelas nem atualiza registros legados', async () => {
    expect(migration).not.toMatch(/^\s*(DROP|DELETE|UPDATE|INSERT)\b/m);
    expect(await prisma.$queryRawUnsafe(selectLegacy)).toEqual(legacyBefore);
    expect(await prisma.$queryRaw`SELECT * FROM "OrderStatusHistory"`).toEqual(historyBefore);
    expect((await prisma.orderCounter.findUniqueOrThrow({ where: { id: 1 } })).value).toBe(7);
    expect(await prisma.pizzaProductionHistory.count()).toBe(0);
    expect(await prisma.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
  });
  it('legacy continua carregando sem receitas inferidas nem histórico individual', async () => {
    const result = await loadCompatibleOrder(prisma, 'legacy-order');
    expect(result?.legacy).toBe(true);
    if (!result?.legacy) throw new Error('Formato incorreto');
    expect(result.order.items[0]).toMatchObject({ name: 'Frango com Catupiry', size: 'Média', status: 'WAITING' });
    expect(result.order.items[0].modifiers[0].name).toBe('Catupiry');
    expect(result.order.status).toBe('OVEN');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: 'legacy-order' } })).schemaVersion).toBe(1);
    expect(await loadCompatibleOrder(prisma, 'inexistente')).toBeNull();
  });
  it('persiste e lê metades, modificadores, borda, timestamps, snapshot e extras v2', async () => {
    const fixture = structuredFixture();
    const pizza = fixture.items[0], extra = fixture.items[1];
    if (pizza.kind !== 'PIZZA' || pizza.recipe.composition !== 'HALF_HALF' || extra.kind !== 'EXTRA') throw new Error('Fixture inválida');
    await prisma.order.create({ data: {
      id: fixture.id, number: fixture.number, customerName: fixture.customerName, type: fixture.fulfillmentType, schemaVersion: 2, structuredChannel: fixture.channel,
      receivedAt: new Date(time), createdAt: new Date(time), updatedAt: new Date(time),
      pizzaItems: { create: { id: pizza.id, position: pizza.position, size: pizza.recipe.size, composition: pizza.recipe.composition, crustId: pizza.recipe.crustId,
        notes: pizza.notes, catalogRevisionId: pizza.snapshot.catalogRevisionId, recipeSnapshot: pizza.snapshot as unknown as Prisma.InputJsonValue, queuedAt: new Date(time),
        halves: { create: [pizza.recipe.firstHalf, pizza.recipe.secondHalf].map((half, index) => ({ position: index + 1, flavorId: half.flavorId, modifiers: { create: half.modifiers } })) },
      } },
      extraItems: { create: { id: extra.id, position: extra.position, extraCatalogId: extra.extraCatalogId, catalogRevisionId: extra.catalogRevisionId, nameSnapshot: extra.snapshot.name, quantity: extra.quantity } },
    } });
    const read = await loadCompatibleOrder(prisma, fixture.id);
    expect(read).toEqual({ schemaVersion: 2, legacy: false, order: fixture });
    expect(await prisma.pizzaProductionHistory.count()).toBe(0); // No fabricated history even for this raw test fixture.
  });
  it('escrita/leitura legacy permanece funcional após migration, com número sequencial', async () => {
    const service = new OrderService(prisma);
    const created = await service.create({ customerName: 'Novo legado', customerPhone: '', type: 'PICKUP', notes: '', items: [{ name: 'Livre', size: 'Pequena', ingredients: '', notes: '', modifiers: [] }] });
    expect(created.number).toBe(8);
    expect((await service.get(created.id))?.items[0].size).toBe('Pequena');
    expect((await loadCompatibleOrder(prisma, created.id))?.legacy).toBe(true);
  });
  it('rejeita referência órfã e impede apagar pedido com estrutura v2', async () => {
    await expect(prisma.extraItem.create({ data: { orderId: 'nao-existe', position: 0, extraCatalogId: 'molho', catalogRevisionId: 'v1', nameSnapshot: 'Molho', quantity: 1 } })).rejects.toThrow();
    await expect(prisma.order.delete({ where: { id: 'order-structured' } })).rejects.toThrow();
    await expect(prisma.extraItem.create({ data: { orderId: 'order-structured', position: 10, extraCatalogId: 'molho', catalogRevisionId: 'v1', nameSnapshot: 'Molho', quantity: 0 } })).rejects.toThrow();
    await expect(prisma.pizzaItem.update({ where: { id: 'pizza-structured' }, data: { size: 'BROTO' } })).rejects.toThrow();
  });
  it('rotas legacy não mascaram pedido v2 nem avançam seu estado agregado', async () => {
    const service = new OrderService(prisma);
    expect(await service.get('order-structured')).toBeNull();
    expect((await service.listActive()).some(order => order.id === 'order-structured')).toBe(false);
    await expect(service.transition('order-structured', { expectedStatus: 'WAITING_PRODUCTION', toStatus: 'IN_PRODUCTION' })).rejects.toThrow('comandos por pizza');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: 'order-structured' } })).status).toBe('WAITING_PRODUCTION');
    expect(await prisma.orderStatusHistory.count({ where: { orderId: 'order-structured' } })).toBe(0);
  });
});
