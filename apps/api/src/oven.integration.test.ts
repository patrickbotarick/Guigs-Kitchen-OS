import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import type { KitchenNotification, Order, PizzaCommandInput } from '@guigs/shared';
import { createApp } from './app.js';
import { OrderService } from './orders.js';
import { StructuredOrderService } from './structured-orders.js';
import { PizzaCommandService } from './pizza-commands.js';
import { hashOperatorPin, OperatorSessionService } from './operator-sessions.js';
import { ovenConfiguration } from './oven-config.js';

const name = `test-oven-${randomUUID()}.db`, path = resolve(process.cwd(), 'prisma', name);
const prisma = new PrismaClient({ datasources: { db: { url: `file:./${name}` } } });
const creation = new StructuredOrderService(prisma), commands = new PizzaCommandService(prisma), notifications: KitchenNotification[] = [];
let sessions: OperatorSessionService, app: ReturnType<typeof createApp>;
async function login(index: number, available = false) {
  const deviceKey = randomUUID(), login = await sessions.signIn({ pin: String(8100 + index), workstationDeviceKey: deviceKey }, randomUUID()), auth = { token: login.token, deviceKey };
  await sessions.heartbeat(auth); await sessions.setAvailability(auth, available);
  return { auth, session: login.session, headers: { Authorization: `Bearer ${auth.token}`, 'X-Workstation-Device-Key': deviceKey } };
}
function input(order: Order, command: PizzaCommandInput['command'], index = 0): PizzaCommandInput {
  const pizza = order.items[index]; if (pizza.kind !== 'PIZZA') throw new Error('Pizza esperada');
  return { command, expectedState: pizza.production.state, expectedVersion: pizza.production.version, clientCommandId: randomUUID() };
}
const endpoint = (order: Order, index = 0) => `/orders/v2/${order.id}/pizzas/${order.items[index].id}/commands`;
async function setup(count = 1, assembled = true) {
  const assembler = await login(0, true);
  let order = (await creation.create({ clientRequestId: randomUUID(), customerName: 'Forno fixture', customerPhone: '', fulfillmentType: 'PICKUP', channel: 'COUNTER', notes: 'Conferir pedido', extras: [],
    pizzas: Array.from({ length: count }, (_, index) => index === 0 ? { size: 'BROTO' as const, composition: 'WHOLE' as const, firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: 'Observação pizza' } : index === 1 ? { size: 'GRANDE' as const, composition: 'HALF_HALF' as const, firstHalf: { flavorId: 'calabresa', modifiers: [] }, secondHalf: { flavorId: 'portuguesa', modifiers: [] }, crustId: 'tradicional', notes: null } : { size: 'GRANDE' as const, composition: 'WHOLE' as const, firstHalf: { flavorId: 'portuguesa', modifiers: [] }, crustId: 'tradicional', notes: null }) })).order;
  if (assembled) for (let index = 0; index < count; index++) for (const action of ['START_ASSEMBLY', 'SEND_TO_OVEN'] as const) order = (await commands.execute(order.id, order.items[index].id, input(order, action, index), assembler.auth)).order;
  const a = await login(1), b = await login(2); notifications.length = 0;
  return { assembler, order, a, b };
}
beforeAll(async () => {
  writeFileSync(path, ''); const directory = resolve(process.cwd(), 'prisma/migrations');
  for (const name of readdirSync(directory).filter(name => /^\d/.test(name)).sort()) for (const sql of readFileSync(resolve(directory, name, 'migration.sql'), 'utf8').split(';').map(part => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(sql);
  for (let index = 0; index < 3; index++) await prisma.operator.create({ data: { name: `Forno operador ${index}`, pinHash: await hashOperatorPin(String(8100 + index)) } });
});
beforeEach(async () => {
  await prisma.$transaction([prisma.pizzaCommandReceipt.deleteMany(), prisma.structuredOrderCreation.deleteMany(), prisma.pizzaProductionHistory.deleteMany(), prisma.orderStatusHistory.deleteMany(), prisma.pizzaIngredientModifier.deleteMany(), prisma.pizzaHalf.deleteMany(), prisma.extraItem.deleteMany(), prisma.pizzaItem.deleteMany(), prisma.order.deleteMany(), prisma.operatorSession.updateMany({ data: { active: false, endedAt: new Date(), presenceStatus: 'OFFLINE' } })]);
  sessions = new OperatorSessionService(prisma); notifications.length = 0;
  app = createApp(new OrderService(prisma), () => {}, 'http://localhost:5173', creation, commands, event => notifications.push(event), sessions);
});
afterAll(async () => { await prisma.$disconnect(); for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true }); });

describe('forno operacional', () => {
  it('SEND_TO_OVEN torna pizza legível na fila v2 com snapshot e montador preservados', async () => {
    const { order, assembler } = await setup(3);
    const response = await request(app).get('/orders/v2'); expect(response.status).toBe(200);
    expect(response.body[0].items).toHaveLength(3); expect(response.body[0].items.every((pizza: { production: { state: string } }) => pizza.production.state === 'WAITING_OVEN')).toBe(true);
    expect(response.body[0]).toMatchObject({ status: 'OVEN', notes: 'Conferir pedido' }); expect(response.body[0].items[0]).toMatchObject({ assignment: { operatorId: assembler.session.operatorId }, snapshot: { size: 'BROTO', notes: 'Observação pizza' } });
    expect(response.body[0].items[1]).toMatchObject({ snapshot: { composition: 'HALF_HALF', firstHalf: { name: 'Calabresa' }, secondHalf: { name: 'Portuguesa' } } }); expect(response.body[0].id).toBe(order.id);
  });
  it('ENTER_OVEN persiste horário/estimativa do servidor, estado, versão, história e eventos', async () => {
    const { order, a, assembler } = await setup(), payload = input(order, 'ENTER_OVEN'), before = Date.now();
    const response = await request(app).post(endpoint(order)).set(a.headers).send(payload); expect(response.status).toBe(200);
    const pizza = await prisma.pizzaItem.findUniqueOrThrow({ where: { id: order.items[0].id } });
    expect(pizza.state).toBe('IN_OVEN'); expect(pizza.version).toBe(4); expect(pizza.ovenStartedAt!.getTime()).toBeGreaterThanOrEqual(before); expect(pizza.ovenStartedAt!.getTime()).toBeLessThanOrEqual(Date.now()); expect(pizza.ovenExpectedEndAt!.getTime() - pizza.ovenStartedAt!.getTime()).toBe(420000);
    expect(pizza.assignedOperatorId).toBe(assembler.session.operatorId); expect(pizza.bakedAt).toBeNull(); expect(response.body.order.status).toBe('OVEN');
    expect(await prisma.pizzaProductionHistory.findUnique({ where: { commandId: payload.clientCommandId } })).toMatchObject({ eventType: 'ENTER_OVEN', fromState: 'WAITING_OVEN', toState: 'IN_OVEN', operatorId: a.session.operatorId, operatorSessionId: a.session.sessionId, workstationId: a.session.workstationId, itemVersion: 4 });
    expect(notifications.map(event => event.type)).toEqual(['kitchen.pizza.updated', 'kitchen.order.updated']);
  });
  it('REMOVE_FROM_OVEN por outro operador persiste BAKED e FINISHING sem alterar entrada/snapshot', async () => {
    const { order, a, b } = await setup(); const started = (await commands.execute(order.id, order.items[0].id, input(order, 'ENTER_OVEN'), a.auth)).order;
    const before = await prisma.pizzaItem.findUniqueOrThrow({ where: { id: order.items[0].id } }), payload = input(started, 'REMOVE_FROM_OVEN');
    const response = await request(app).post(endpoint(order)).set(b.headers).send(payload); expect(response.status).toBe(200);
    const pizza = await prisma.pizzaItem.findUniqueOrThrow({ where: { id: order.items[0].id } }); expect(pizza).toMatchObject({ state: 'BAKED', version: 5, ovenStartedAt: before.ovenStartedAt, ovenExpectedEndAt: before.ovenExpectedEndAt, recipeSnapshot: before.recipeSnapshot, bakedAt: expect.any(Date) });
    expect(pizza.bakedAt!.getTime()).toBeGreaterThanOrEqual(pizza.ovenStartedAt!.getTime()); expect(response.body.order.status).toBe('FINISHING'); expect(response.body.order.packingFinishedAt).toBeNull();
    expect(await prisma.pizzaProductionHistory.findUnique({ where: { commandId: payload.clientCommandId } })).toMatchObject({ eventType: 'REMOVE_FROM_OVEN', fromState: 'IN_OVEN', toState: 'BAKED', operatorId: b.session.operatorId });
    expect((await request(app).get(`/orders/v2/${order.id}`)).body.items[0].production.bakedAt).toBe(pizza.bakedAt!.toISOString());
  });
  it.each(['ENTER_OVEN', 'REMOVE_FROM_OVEN'] as const)('autenticação e presença válidas obrigatórias para %s', async action => {
    const { order, a } = await setup(), payload = input(order, action);
    expect((await request(app).post(endpoint(order)).send(payload)).status).toBe(401);
    await prisma.operatorSession.update({ where: { id: a.session.sessionId }, data: { lastSeenAt: new Date(Date.now() - 60001) } });
    expect((await request(app).post(endpoint(order)).set(a.headers).send(payload)).status).toBe(409);
    expect(notifications).toEqual([]);
  });
  it('não permite forno antes do fim de montagem ou retirar pizza ainda aguardando', async () => {
    const { order, a } = await setup(1, false);
    for (const action of ['ENTER_OVEN', 'REMOVE_FROM_OVEN'] as const) expect((await request(app).post(endpoint(order)).set(a.headers).send(input(order, action))).status).toBe(409);
    expect(notifications).toEqual([]);
  });
  it('versão/estado esperados incorretos conflitam sem mudanças', async () => {
    const { order, a } = await setup(), payload = input(order, 'ENTER_OVEN'), before = await prisma.pizzaItem.findUnique({ where: { id: order.items[0].id } });
    for (const incorrect of [{ ...payload, expectedVersion: 2 }, { ...payload, expectedState: 'IN_OVEN' }]) expect((await request(app).post(endpoint(order)).set(a.headers).send(incorrect)).status).toBe(409);
    expect(await prisma.pizzaItem.findUnique({ where: { id: order.items[0].id } })).toEqual(before); expect(notifications).toEqual([]);
  });
  it('pedido/pizza incorretos não podem ser alterados', async () => {
    const { order, a } = await setup();
    expect((await request(app).post(`/orders/v2/cmissingorder0000000000000/pizzas/${order.items[0].id}/commands`).set(a.headers).send(input(order, 'ENTER_OVEN'))).status).toBe(404);
    expect((await request(app).post(`/orders/v2/${order.id}/pizzas/cmissingpizza0000000000000/commands`).set(a.headers).send(input(order, 'ENTER_OVEN'))).status).toBe(404);
  });
  it('estimativa é configurável e preservada na entrada mesmo após mudar configuração', async () => {
    const { order, a, b } = await setup(); const temporary = new PizzaCommandService(prisma, 0.5);
    const started = (await temporary.execute(order.id, order.items[0].id, input(order, 'ENTER_OVEN'), a.auth)).order;
    const removed = (await commands.execute(order.id, order.items[0].id, input(started, 'REMOVE_FROM_OVEN'), b.auth)).order;
    const pizza = removed.items[0]; if (pizza.kind !== 'PIZZA') throw new Error('Pizza esperada'); expect(Date.parse(pizza.production.ovenExpectedEndAt!) - Date.parse(pizza.production.ovenStartedAt!)).toBe(30000);
  });
  it('timer atingido não muda estado automaticamente', async () => {
    const { order, a } = await setup(); await commands.execute(order.id, order.items[0].id, input(order, 'ENTER_OVEN'), a.auth);
    await prisma.pizzaItem.update({ where: { id: order.items[0].id }, data: { ovenExpectedEndAt: new Date(Date.now() - 1) } });
    expect((await request(app).get(`/orders/v2/${order.id}`)).body.items[0].production.state).toBe('IN_OVEN'); expect(await prisma.pizzaProductionHistory.count({ where: { eventType: 'REMOVE_FROM_OVEN' } })).toBe(0);
  });
  it('idempotência mantém timestamps/histórico e não emite outra vez; outro conteúdo conflita', async () => {
    const { order, a } = await setup(), payload = input(order, 'ENTER_OVEN');
    const first = await request(app).post(endpoint(order)).set(a.headers).send(payload), events = notifications.length;
    const second = await request(app).post(endpoint(order)).set(a.headers).send(payload); expect(second.status).toBe(200); expect(second.body).toEqual({ ...first.body, replayed: true }); expect(notifications.length).toBe(events);
    expect(await prisma.pizzaProductionHistory.count({ where: { commandId: payload.clientCommandId } })).toBe(1);
    expect((await request(app).post(endpoint(order)).set(a.headers).send({ ...payload, command: 'REMOVE_FROM_OVEN' })).status).toBe(409);
  });
  it('replay após retirada retorna recibo anterior; GET retorna estado atual BAKED', async () => {
    const { order, a } = await setup(), payload = input(order, 'ENTER_OVEN');
    const started = (await commands.execute(order.id, order.items[0].id, payload, a.auth)).order;
    await commands.execute(order.id, order.items[0].id, input(started, 'REMOVE_FROM_OVEN'), a.auth);
    const replay = await commands.execute(order.id, order.items[0].id, payload, a.auth); expect(replay.replayed).toBe(true); expect(replay.order.items[0]).toMatchObject({ production: { state: 'IN_OVEN' } }); expect((await creation.get(order.id))?.items[0]).toMatchObject({ production: { state: 'BAKED' } });
  });
  it.each(['ENTER_OVEN', 'REMOVE_FROM_OVEN'] as const)('dois tablets disputando %s têm um vencedor e um 409', async action => {
    const { order, a, b } = await setup(); const current = action === 'ENTER_OVEN' ? order : (await commands.execute(order.id, order.items[0].id, input(order, 'ENTER_OVEN'), a.auth)).order;
    const results = await Promise.all([a, b].map(actor => request(app).post(endpoint(order)).set(actor.headers).send(input(current, action)))); expect(results.map(result => result.status).sort()).toEqual([200, 409]); expect(await prisma.pizzaProductionHistory.count({ where: { eventType: action } })).toBe(1);
  });
  it('duplicado simultâneo grava uma única entrada e um replay', async () => {
    const { order, a } = await setup(), payload = input(order, 'ENTER_OVEN');
    const results = await Promise.all([1, 2].map(() => request(app).post(endpoint(order)).set(a.headers).send(payload))); expect(results.map(result => result.status)).toEqual([200, 200]); expect(results.filter(result => result.body.replayed)).toHaveLength(1);
  });
  it('pedido com três pizzas preserva agregação parcial e só passa FINISHING quando todas assadas', async () => {
    const { order, a, b } = await setup(3); let current = order;
    for (const [index, action, actor] of [[0, 'ENTER_OVEN', a], [1, 'ENTER_OVEN', b], [0, 'REMOVE_FROM_OVEN', a], [2, 'ENTER_OVEN', b]] as const) current = (await commands.execute(order.id, order.items[index].id, input(current, action, index), actor.auth)).order;
    expect(current.status).toBe('OVEN'); expect(current.items.map(pizza => pizza.kind === 'PIZZA' && pizza.production.state)).toEqual(['BAKED', 'IN_OVEN', 'IN_OVEN']);
    for (const index of [1, 2]) current = (await commands.execute(order.id, order.items[index].id, input(current, 'REMOVE_FROM_OVEN', index), a.auth)).order;
    expect(current.status).toBe('FINISHING'); expect(current.items.every(pizza => pizza.kind === 'PIZZA' && pizza.production.finishingStartedAt === null)).toBe(true);
  });
  it('pizza em montagem mantém pedido IN_PRODUCTION mesmo com outra no forno ou BAKED', async () => {
    const { order, a, assembler } = await setup(2, false); let current = order;
    for (const action of ['START_ASSEMBLY', 'SEND_TO_OVEN'] as const) current = (await commands.execute(order.id, order.items[0].id, input(current, action), assembler.auth)).order;
    for (const action of ['ENTER_OVEN', 'REMOVE_FROM_OVEN'] as const) current = (await commands.execute(order.id, order.items[0].id, input(current, action), a.auth)).order;
    expect(current.status).toBe('IN_PRODUCTION');
  });
  it('30 pizzas e entradas concorrentes não impõem capacidade inventada nem perdem versões', async () => {
    const { order, a, b } = await setup(30); expect((await creation.get(order.id))?.items).toHaveLength(30);
    // Independent writers operate different pizzas in the same order; aggregation is retried atomically.
    for (let start = 0; start < 30; start += 3) await Promise.all([start, start + 1, start + 2].map(index => commands.execute(order.id, order.items[index].id, input(order, 'ENTER_OVEN', index), index % 2 ? a.auth : b.auth)));
    expect(await prisma.pizzaItem.count({ where: { orderId: order.id, state: 'IN_OVEN' } })).toBe(30); expect(await prisma.pizzaProductionHistory.count({ where: { eventType: 'ENTER_OVEN' } })).toBe(30);
    expect((await creation.get(order.id))?.version).toBe(order.version + 30);
  }, 20000);
  it.each(['history', 'order', 'receipt'] as const)('rollback ao falhar %s preserva estado/timestamps/agregação e não emite', async part => {
    const { order, a } = await setup(), payload = input(order, 'ENTER_OVEN'), before = await prisma.pizzaItem.findUnique({ where: { id: order.items[0].id } });
    const table = part === 'history' ? 'PizzaProductionHistory' : part === 'order' ? 'Order' : 'PizzaCommandReceipt', verb = part === 'order' ? 'UPDATE' : 'INSERT';
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_oven BEFORE ${verb} ON "${table}" BEGIN SELECT RAISE(ABORT, 'oven failed'); END`);
    try { expect((await request(app).post(endpoint(order)).set(a.headers).send(payload)).status).toBe(500); expect(await prisma.pizzaItem.findUnique({ where: { id: order.items[0].id } })).toEqual(before); expect((await creation.get(order.id))?.version).toBe(order.version); expect(await prisma.pizzaCommandReceipt.findUnique({ where: { clientCommandId: payload.clientCommandId } })).toBeNull(); expect(notifications).toEqual([]); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER fail_oven'); }
  });
  it('configuração central é legível sem cache; valores inválidos rejeitados', async () => {
    const response = await request(app).get('/kitchen/oven/config'); expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store'); expect(response.body).toMatchObject({ defaultOvenMinutes: 7, serverTime: expect.any(String) });
    const previous = process.env.OVEN_DEFAULT_MINUTES;
    try { for (const value of ['0', '-1', 'invalid', '241']) { process.env.OVEN_DEFAULT_MINUTES = value; expect(() => ovenConfiguration()).toThrow('OVEN_DEFAULT_MINUTES'); } }
    finally { if (previous === undefined) delete process.env.OVEN_DEFAULT_MINUTES; else process.env.OVEN_DEFAULT_MINUTES = previous; }
  });
});
