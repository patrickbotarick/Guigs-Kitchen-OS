import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import type { CreateStructuredOrderInput, KitchenNotification, Order, PizzaCommandInput } from '@guigs/shared';
import { StructuredOrderService } from './structured-orders.js';
import { hashOperatorPin, OperatorSessionService } from './operator-sessions.js';
import { PizzaCommandService } from './pizza-commands.js';
import { createApp } from './app.js';
import { OrderService } from './orders.js';

const name = `test-auto-assignment-${randomUUID()}.db`, path = resolve(process.cwd(), 'prisma', name);
const prisma = new PrismaClient({ datasources: { db: { url: `file:./${name}` } } });
const creation = new StructuredOrderService(prisma), sessions = new OperatorSessionService(prisma), commands = new PizzaCommandService(prisma);
const notifications: KitchenNotification[] = [], publish = vi.fn();
const app = createApp(new OrderService(prisma), publish, 'http://localhost:5173', creation, commands, event => notifications.push(event), sessions);
const operatorIds: string[] = [];
function payload(count = 1): CreateStructuredOrderInput {
  return { clientRequestId: randomUUID(), customerName: 'Distribuição fixture', customerPhone: '', notes: '', channel: 'COUNTER', fulfillmentType: 'PICKUP', extras: [],
    pizzas: Array.from({ length: count }, () => ({ size: 'GRANDE', composition: 'WHOLE', firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: null })) };
}
async function login(index: number) {
  const deviceKey = randomUUID(), result = await sessions.signIn({ pin: String(6100 + index), workstationDeviceKey: deviceKey }, randomUUID());
  return { auth: { token: result.token, deviceKey }, session: result.session, headers: { Authorization: `Bearer ${result.token}`, 'X-Workstation-Device-Key': deviceKey } };
}
async function load() {
  return prisma.pizzaItem.groupBy({ by: ['assignedOperatorId'], where: { assignedOperatorId: { not: null }, state: { in: ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'] } }, _count: { _all: true } });
}
function command(order: Order, action: PizzaCommandInput['command']): PizzaCommandInput {
  const pizza = order.items[0]; if (pizza.kind !== 'PIZZA') throw new Error('Pizza esperada');
  return { command: action, expectedState: pizza.production.state, expectedVersion: pizza.production.version, clientCommandId: randomUUID() };
}
beforeAll(async () => {
  writeFileSync(path, ''); const directory = resolve(process.cwd(), 'prisma/migrations');
  for (const name of readdirSync(directory).filter(name => /^\d/.test(name)).sort()) for (const sql of readFileSync(resolve(directory, name, 'migration.sql'), 'utf8').split(';').map(part => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(sql);
  for (let index = 0; index < 5; index++) operatorIds.push((await prisma.operator.create({ data: { name: `Distribuição ${index} fixture`, pinHash: await hashOperatorPin(String(6100 + index)) } })).id);
});
beforeEach(async () => {
  await prisma.$transaction([
    prisma.pizzaCommandReceipt.deleteMany(), prisma.structuredOrderCreation.deleteMany(), prisma.orderStatusHistory.deleteMany(), prisma.pizzaProductionHistory.deleteMany(),
    prisma.pizzaIngredientModifier.deleteMany(), prisma.pizzaHalf.deleteMany(), prisma.extraItem.deleteMany(), prisma.pizzaItem.deleteMany(), prisma.order.deleteMany(),
    prisma.operatorSession.updateMany({ data: { active: false, endedAt: new Date() } }), prisma.operator.updateMany({ data: { active: true } }), prisma.workstation.updateMany({ data: { active: true } }),
  ]);
  notifications.length = 0; publish.mockClear();
});
afterAll(async () => { await prisma.$disconnect(); for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true }); });

describe('distribuição automática por pizza', () => {
  it.each([1, 2, 5])('balanceia 30 pizzas entre %i operadores sem quantidade fixa', async count => {
    const actors = []; for (let index = 0; index < count; index++) actors.push(await login(index));
    const { order } = await creation.create(payload(30)); expect(order.status).toBe('WAITING_PRODUCTION'); expect(order.version).toBe(1);
    const counts = await load(); expect(counts).toHaveLength(count); expect(counts.map(group => group._count._all)).toEqual(Array(count).fill(30 / count));
    for (const pizza of order.items) {
      expect(pizza).toMatchObject({ kind: 'PIZZA', production: { state: 'WAITING_ASSEMBLY', version: 1, assemblyStartedAt: null }, assignment: { assignedAt: expect.any(String) } });
      if (pizza.kind !== 'PIZZA') throw new Error('Pizza esperada');
      const actor = actors.find(actor => actor.session.operatorId === pizza.assignment?.operatorId)!;
      expect(pizza.assignment).toMatchObject({ sessionId: actor.session.sessionId, workstationId: actor.session.workstationId });
    }
    expect(await prisma.pizzaProductionHistory.count({ where: { eventType: 'AUTO_ASSIGNED' } })).toBe(30);
  });
  it('sem sessão elegível cria normalmente e login posterior não distribui pedidos antigos', async () => {
    const { order } = await creation.create(payload(3)); expect(order.version).toBe(0); expect(order.items.every(item => item.kind === 'PIZZA' && item.assignment === null && item.production.version === 0)).toBe(true);
    await login(0); expect((await creation.get(order.id))?.items.every(item => item.kind === 'PIZZA' && item.assignment === null)).toBe(true);
    expect(await prisma.pizzaProductionHistory.count({ where: { eventType: 'AUTO_ASSIGNED' } })).toBe(0);
  });
  it.each(['inactiveOperator', 'expiredSession', 'endedSession', 'inactiveSession', 'invalidWorkstation', 'unavailable'] as const)('exclui %s', async reason => {
    const actor = await login(0);
    if (reason === 'inactiveOperator') await prisma.operator.update({ where: { id: actor.session.operatorId }, data: { active: false } });
    if (reason === 'invalidWorkstation') await prisma.workstation.update({ where: { id: actor.session.workstationId }, data: { active: false } });
    if (reason === 'expiredSession') await prisma.operatorSession.update({ where: { id: actor.session.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
    if (reason === 'endedSession') await prisma.operatorSession.update({ where: { id: actor.session.sessionId }, data: { endedAt: new Date() } });
    if (reason === 'inactiveSession') await prisma.operatorSession.update({ where: { id: actor.session.sessionId }, data: { active: false } });
    if (reason === 'unavailable') await sessions.setAvailability(actor.auth, false);
    const { order } = await creation.create(payload()); expect(order.items[0]).toMatchObject({ assignment: null, production: { version: 0 } });
  });
  it('deduplica operador com várias sessões e usa a sessão disponível mais recente', async () => {
    const older = await login(0), recent = await login(0); await login(1);
    const { order } = await creation.create(payload(6)); expect((await load()).map(group => group._count._all)).toEqual([3, 3]);
    const owned = order.items.filter(item => item.kind === 'PIZZA' && item.assignment?.operatorId === older.session.operatorId);
    expect(owned.every(item => item.kind === 'PIZZA' && item.assignment?.sessionId === recent.session.sessionId)).toBe(true);
    await sessions.setAvailability(recent.auth, false);
    const next = await creation.create(payload(2)); expect(next.order.items.some(item => item.kind === 'PIZZA' && item.assignment?.sessionId === older.session.sessionId)).toBe(true);
  });
  it('calcula carga anterior, prefere a menor e recalcula por pizza no mesmo pedido', async () => {
    const a = await login(0); await creation.create(payload(4)); const b = await login(1);
    const { order } = await creation.create(payload(3)); expect(order.items.every(item => item.kind === 'PIZZA' && item.assignment?.operatorId === b.session.operatorId)).toBe(true);
    const history = await prisma.pizzaProductionHistory.findMany({ where: { pizza: { orderId: order.id }, eventType: 'AUTO_ASSIGNED' }, orderBy: { pizza: { position: 'asc' } } });
    expect(history.map(event => (event.metadata as { loadBefore: number }).loadBefore)).toEqual([0, 1, 2]);
    const next = await creation.create(payload()); expect(next.order.items[0]).toMatchObject({ assignment: { operatorId: b.session.operatorId } });
    expect((await load()).find(group => group.assignedOperatorId === a.session.operatorId)?._count._all).toBe(4);
  });
  it('desempate usa sorteio entre todos os empatados, sem favorecer a ordem do banco', async () => {
    await login(0); await login(1); await login(2);
    const pick = vi.fn((count: number) => count - 1), service = new StructuredOrderService(prisma, pick);
    const { order } = await service.create(payload(3)); expect(pick.mock.calls.map(call => call[0])).toEqual([3, 2]);
    const events = await prisma.pizzaProductionHistory.findMany({ where: { pizza: { orderId: order.id }, eventType: 'AUTO_ASSIGNED' }, orderBy: { pizza: { position: 'asc' } } });
    const first = events[0].metadata as { tiedOperatorIds: string[] }; expect(events[0].operatorId).toBe(first.tiedOperatorIds[2]);
    expect(new Set(events.map(event => event.operatorId)).size).toBe(3);
  });
  it('pausa/em montagem contam; pizzas aguardando forno ou mais avançadas/canceladas não contam', async () => {
    const a = await login(0); const order = (await creation.create(payload(9))).order;
    const states = ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED', 'WAITING_OVEN', 'IN_OVEN', 'BAKED', 'FINISHING', 'FINISHED', 'CANCELLED'] as const;
    for (const [index, state] of states.entries()) await prisma.pizzaItem.update({ where: { id: order.items[index].id }, data: { state } }); // Synthetic state fixtures only; creation reads just the new order.
    expect((await load())[0]._count._all).toBe(3); const b = await login(1);
    const next = (await creation.create(payload(3))).order; expect(next.items.every(item => item.kind === 'PIZZA' && item.assignment?.operatorId === b.session.operatorId)).toBe(true);
    expect((await load()).find(group => group.assignedOperatorId === a.session.operatorId)?._count._all).toBe(3);
  });
  it('AUTO_ASSIGNED preserva CREATED, autoria SYSTEM e dados para métricas', async () => {
    const actor = await login(0), input = payload(), { order } = await creation.create(input);
    const history = await prisma.pizzaProductionHistory.findMany({ where: { pizzaId: order.items[0].id }, orderBy: { itemVersion: 'asc' } });
    expect(history.map(event => event.eventType)).toEqual(['CREATED', 'AUTO_ASSIGNED']);
    expect(history[1]).toMatchObject({ actorType: 'SYSTEM', actorId: null, operatorId: actor.session.operatorId, operatorSessionId: actor.session.sessionId, workstationId: actor.session.workstationId, itemVersion: 1, commandId: `${input.clientRequestId}:auto:0`, metadata: { policy: 'LEAST_PENDING_RANDOM_TIE_V1', loadBefore: 0, loadAfter: 1 } });
    if (order.items[0].kind !== 'PIZZA') throw new Error('Pizza esperada');
    expect(order.items[0].assignment?.assignedAt).toBe(history[1].changedAt.toISOString()); expect(history[0].operatorId).toBeNull();
  });
  it('publica criação e assignment somente após commit; replay não redistribui nem emite', async () => {
    await login(0); const input = payload(2), response = await request(app).post('/orders/v2').send(input);
    expect(response.status).toBe(201); expect(publish.mock.calls).toHaveLength(1); expect(publish.mock.calls[0][1]).toEqual(await creation.get(response.body.id));
    expect(notifications.map(event => event.type)).toEqual(['kitchen.pizza.updated', 'kitchen.pizza.updated', 'kitchen.order.updated']);
    const events = await prisma.pizzaProductionHistory.findMany({ where: { pizza: { orderId: response.body.id } } });
    await sessions.setAvailability((await login(1)).auth, true);
    const repeated = await request(app).post('/orders/v2').send(input); expect(repeated.status).toBe(200); expect(repeated.body).toEqual(response.body);
    expect(notifications.length).toBe(3); expect(publish.mock.calls).toHaveLength(1); expect(await prisma.pizzaProductionHistory.findMany({ where: { pizza: { orderId: response.body.id } } })).toEqual(events);
  });
  it('seis pedidos simultâneos mantêm distribuição global equilibrada sem duplicar pizzas', async () => {
    for (let index = 0; index < 3; index++) await login(index);
    await Promise.all(Array.from({ length: 6 }, () => creation.create(payload(2))));
    expect((await load()).map(group => group._count._all)).toEqual([4, 4, 4]); expect(await prisma.pizzaItem.count()).toBe(12); expect(await prisma.pizzaProductionHistory.count({ where: { eventType: 'AUTO_ASSIGNED' } })).toBe(12);
  });
  it('mesmo pedido simultâneo distribui uma única vez', async () => {
    await login(0); const input = payload(3), results = await Promise.all([creation.create(input), creation.create(input)]);
    expect(results.filter(result => !result.replayed)).toHaveLength(1); expect(results[0].order).toEqual(results[1].order); expect(await prisma.pizzaItem.count()).toBe(3); expect(await prisma.pizzaProductionHistory.count({ where: { eventType: 'AUTO_ASSIGNED' } })).toBe(3);
  });
  it('clientes Prisma independentes compartilham a serialização e a carga do SQLite', async () => {
    for (let index = 0; index < 3; index++) await login(index);
    const otherClient = new PrismaClient({ datasources: { db: { url: `file:./${name}` } } }), other = new StructuredOrderService(otherClient);
    try {
      await Promise.all(Array.from({ length: 6 }, (_, index) => (index % 2 ? other : creation).create(payload(3))));
      expect((await load()).map(group => group._count._all)).toEqual([6, 6, 6]); expect(await prisma.pizzaItem.count()).toBe(18);
      expect(await prisma.pizzaProductionHistory.count({ where: { eventType: 'AUTO_ASSIGNED' } })).toBe(18);
    } finally { await otherClient.$disconnect(); }
  });
  it('montagem de pizza automática preserva origem e sai da carga ao enviar ao forno', async () => {
    const actor = await login(0); let order = (await creation.create(payload())).order; const pizzaId = order.items[0].id;
    const assignment = order.items[0].kind === 'PIZZA' ? order.items[0].assignment : null;
    for (const action of ['START_ASSEMBLY', 'PAUSE_ASSEMBLY', 'RESUME_ASSEMBLY', 'SEND_TO_OVEN'] as const) order = (await commands.execute(order.id, pizzaId, command(order, action), actor.auth)).order;
    expect(await load()).toEqual([]); expect(order.status).toBe('OVEN'); expect(order.items[0]).toMatchObject({ assignment, production: { version: 5, state: 'WAITING_OVEN', assemblyCompletedAt: expect.any(String) } });
    const next = (await creation.create(payload())).order;
    expect((await prisma.pizzaProductionHistory.findFirstOrThrow({ where: { pizzaId: next.items[0].id, eventType: 'AUTO_ASSIGNED' } })).metadata).toMatchObject({ loadBefore: 0 });
    expect(await prisma.pizzaProductionHistory.count({ where: { pizzaId, eventType: 'CLAIMED' } })).toBe(0);
  });
  it('falha no histórico automático desfaz pedido/contador/assignment e não publica', async () => {
    await login(0); const before = await prisma.orderCounter.findUnique({ where: { id: 1 } });
    await prisma.$executeRawUnsafe('CREATE TRIGGER fail_auto BEFORE INSERT ON "PizzaProductionHistory" WHEN NEW.eventType = \'AUTO_ASSIGNED\' BEGIN SELECT RAISE(ABORT, \'assignment failed\'); END');
    try { expect((await request(app).post('/orders/v2').send(payload(3))).status).toBe(500); expect(await prisma.order.count()).toBe(0); expect(await prisma.pizzaItem.count()).toBe(0); expect(await prisma.pizzaProductionHistory.count()).toBe(0); expect(await prisma.structuredOrderCreation.count()).toBe(0); expect(await prisma.orderCounter.findUnique({ where: { id: 1 } })).toEqual(before); expect(notifications).toEqual([]); expect(publish.mock.calls).toHaveLength(0); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER fail_auto'); }
  });
  it('release fica disponível, não redistribui e mantém claim manual', async () => {
    const a = await login(0), b = await login(1); let order = (await creation.create(payload())).order;
    const pizza = order.items[0]; if (pizza.kind !== 'PIZZA') throw new Error('Pizza esperada');
    const actor = pizza.assignment?.operatorId === a.session.operatorId ? a : b, other = actor === a ? b : a;
    order = (await commands.execute(order.id, pizza.id, command(order, 'RELEASE_PIZZA'), actor.auth)).order; expect(order.items[0]).toMatchObject({ assignment: null });
    await creation.create(payload(2)); expect((await creation.get(order.id))?.items[0]).toMatchObject({ assignment: null });
    order = (await commands.execute(order.id, pizza.id, command(order, 'CLAIM_PIZZA'), other.auth)).order;
    order = (await commands.execute(order.id, pizza.id, command(order, 'START_ASSEMBLY'), other.auth)).order; expect(order.items[0]).toMatchObject({ assignment: { operatorId: other.session.operatorId }, production: { state: 'ASSEMBLING' } });
    expect(await prisma.pizzaProductionHistory.count({ where: { pizzaId: pizza.id, eventType: 'AUTO_ASSIGNED' } })).toBe(1);
  });
  it('disponibilidade é autenticada, persistida e não libera reservas existentes', async () => {
    const actor = await login(0), { order } = await creation.create(payload());
    expect((await request(app).patch('/operators/session').send({ available: false })).status).toBe(401);
    for (const body of [{ available: 'no' }, { available: false, operatorId: actor.session.operatorId }]) expect((await request(app).patch('/operators/session').set(actor.headers).send(body)).status).toBe(400);
    const changed = await request(app).patch('/operators/session').set(actor.headers).send({ available: false }); expect(changed.status).toBe(200); expect(changed.body.available).toBe(false);
    expect((await request(app).get('/operators/session').set(actor.headers)).body.available).toBe(false); expect((await creation.get(order.id))?.items[0]).toMatchObject({ assignment: { operatorId: actor.session.operatorId } });
    const next = await creation.create(payload()); expect(next.order.items[0]).toMatchObject({ assignment: null });
    await sessions.setAvailability(actor.auth, true); expect((await creation.create(payload())).order.items[0]).toMatchObject({ assignment: { operatorId: actor.session.operatorId } });
  });
});
