import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { FinishingService } from './finishing.js';
import type { FinishingCommandInput } from '@guigs/shared';

const name = `test-finishing-${randomUUID()}.db`, path = resolve(process.cwd(), 'prisma', name);
const prisma = new PrismaClient({ datasources: { db: { url: `file:./${name}` } } });
const creation = new StructuredOrderService(prisma), commands = new PizzaCommandService(prisma), notifications: KitchenNotification[] = [];

const originalCapacity = process.env.OVEN_CAPACITY, originalMinutes = process.env.OVEN_DEFAULT_MINUTES;
afterEach(() => {
  if (originalCapacity === undefined) delete process.env.OVEN_CAPACITY; else process.env.OVEN_CAPACITY = originalCapacity;
  if (originalMinutes === undefined) delete process.env.OVEN_DEFAULT_MINUTES; else process.env.OVEN_DEFAULT_MINUTES = originalMinutes;
});
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
async function setup(count = 1, bakedCount = count, withExtras = true) {
  const assembler = await login(0, true);
  let order = (await creation.create({ clientRequestId: randomUUID(), customerName: 'Forno fixture', customerPhone: '', fulfillmentType: 'PICKUP', channel: 'COUNTER', notes: 'Conferir pedido', extras: withExtras ? [{ extraCatalogId: 'coca-cola-2l', quantity: 1, notes: 'Gelada' }, { extraCatalogId: 'molho-extra', quantity: 2, notes: 'Separado' }] : [],
    pizzas: Array.from({ length: count }, (_, index) => index === 0 ? { size: 'BROTO' as const, composition: 'WHOLE' as const, firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: 'Observação pizza' } : index === 1 ? { size: 'GRANDE' as const, composition: 'HALF_HALF' as const, firstHalf: { flavorId: 'calabresa', modifiers: [] }, secondHalf: { flavorId: 'portuguesa', modifiers: [] }, crustId: 'tradicional', notes: null } : { size: 'GRANDE' as const, composition: 'WHOLE' as const, firstHalf: { flavorId: 'portuguesa', modifiers: [] }, crustId: 'tradicional', notes: null }) })).order;
  for (let index = 0; index < count; index++) for (const action of ['START_ASSEMBLY', 'SEND_TO_OVEN'] as const) order = (await commands.execute(order.id, order.items[index].id, input(order, action, index), assembler.auth)).order;
  const a = await login(1), b = await login(2);
  for (let index = 0; index < bakedCount; index++) for (const action of ['ENTER_OVEN', 'REMOVE_FROM_OVEN'] as const) order = (await commands.execute(order.id, order.items[index].id, input(order, action, index), a.auth)).order;
  notifications.length = 0;
  return { assembler, order, a, b };
}
beforeAll(async () => {
  writeFileSync(path, ''); const directory = resolve(process.cwd(), 'prisma/migrations');
  for (const name of readdirSync(directory).filter(name => /^\d/.test(name)).sort()) for (const sql of readFileSync(resolve(directory, name, 'migration.sql'), 'utf8').split(';').map(part => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(sql);
  for (let index = 0; index < 3; index++) await prisma.operator.create({ data: { name: `Forno operador ${index}`, pinHash: await hashOperatorPin(String(8100 + index)) } });
});
beforeEach(async () => {
  await prisma.$transaction([prisma.finishingCommandReceipt.deleteMany(), prisma.pizzaCommandReceipt.deleteMany(), prisma.structuredOrderCreation.deleteMany(), prisma.pizzaProductionHistory.deleteMany(), prisma.orderStatusHistory.deleteMany(), prisma.pizzaIngredientModifier.deleteMany(), prisma.pizzaHalf.deleteMany(), prisma.extraItem.deleteMany(), prisma.pizzaItem.deleteMany(), prisma.order.deleteMany(), prisma.operatorSession.updateMany({ data: { active: false, endedAt: new Date(), presenceStatus: 'OFFLINE' } })]);
  sessions = new OperatorSessionService(prisma); notifications.length = 0;
  app = createApp(new OrderService(prisma), () => {}, 'http://localhost:5173', creation, commands, event => notifications.push(event), sessions, undefined, new FinishingService(prisma));
});
afterAll(async () => { await prisma.$disconnect(); for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true }); });

const finishEndpoint = (order: Order) => `/orders/v2/${order.id}/finishing/commands`;
function finishInput(order: Order, command: FinishingCommandInput['command'], index = 0): FinishingCommandInput {
  const common = { expectedVersion: order.version, clientCommandId: randomUUID() };
  if (command === 'START_FINISHING' || command === 'CHECK_PIZZA') { const pizza = order.items.filter(item => item.kind === 'PIZZA')[index]; return { ...common, command, pizzaId: pizza.id, expectedItemVersion: pizza.production.version }; }
  if (command === 'CHECK_EXTRA') { const extra = order.items.filter(item => item.kind === 'EXTRA')[index]; return { ...common, command, extraId: extra.id, expectedItemVersion: extra.version, checkedQuantity: extra.quantity }; }
  return { ...common, command };
}
async function run(order: Order, command: FinishingCommandInput['command'], auth: Awaited<ReturnType<typeof login>>, index = 0) {
  const response = await request(app).post(finishEndpoint(order)).set(auth.headers).send(finishInput(order, command, index)); expect(response.status).toBe(200); return response.body.order as Order;
}
async function checkItems(order: Order, auth: Awaited<ReturnType<typeof login>>) {
  let current = order;
  for (let index = 0; index < order.items.filter(item => item.kind === 'PIZZA').length; index++) { current = await run(current, 'START_FINISHING', auth, index); current = await run(current, 'CHECK_PIZZA', auth, index); }
  for (let index = 0; index < order.items.filter(item => item.kind === 'EXTRA').length; index++) current = await run(current, 'CHECK_EXTRA', auth, index);
  return current;
}
describe('finalização por pedido', () => {
  it('uma pizza Broto sem extras: transições explícitas, embalagem não libera e release exige comando', async () => {
    const { order, a } = await setup(1, 1, false); let current = await run(order, 'START_FINISHING', a);
    const pizza = current.items[0]; if (pizza.kind !== 'PIZZA') throw new Error('Pizza esperada'); expect(pizza.production).toMatchObject({ state: 'FINISHING', finishingStartedAt: expect.any(String), finishedAt: null });
    current = await run(current, 'CHECK_PIZZA', a); expect(current.items[0]).toMatchObject({ production: { state: 'FINISHED', finishedAt: expect.any(String) } });
    expect((await request(app).post(finishEndpoint(current)).set(a.headers).send(finishInput(current, 'RELEASE_TO_DISPATCH'))).status).toBe(409);
    current = await run(current, 'CONFIRM_PACKAGING', a); expect(current.status).toBe('FINISHING'); expect(current.packingFinishedBy).toBe(a.session.operatorId);
    current = await run(current, 'RELEASE_TO_DISPATCH', a); expect(current.status).toBe('WAITING_DISPATCH'); expect((await request(app).get(`/orders/v2/${order.id}`)).body.status).toBe('WAITING_DISPATCH');
    expect(await prisma.pizzaProductionHistory.findMany({ where: { pizzaId: pizza.id, eventType: { in: ['FINISHING_STARTED', 'PIZZA_CHECKED'] } }, orderBy: { itemVersion: 'asc' } })).toMatchObject([{ fromState: 'BAKED', toState: 'FINISHING', operatorId: a.session.operatorId }, { fromState: 'FINISHING', toState: 'FINISHED', operatorSessionId: a.session.sessionId, workstationId: a.session.workstationId }]);
  });
  it('3 pizzas/Broto/meio a meio e extras por quantidade mantêm snapshots e autoria completa', async () => {
    const { order, a, b } = await setup(3); let current = await checkItems(order, a); current = await run(current, 'CONFIRM_PACKAGING', b); current = await run(current, 'RELEASE_TO_DISPATCH', b);
    expect(current.status).toBe('WAITING_DISPATCH'); expect(current.items.filter(item => item.kind === 'EXTRA')).toMatchObject([{ checkedQuantity: 1, state: 'FINISHED', checkedBy: a.session.operatorId }, { checkedQuantity: 2, state: 'FINISHED' }]);
    for (let index = 0; index < 3; index++) { const pizza = current.items[index]; if (pizza.kind !== 'PIZZA') throw new Error('Pizza'); expect(pizza.snapshot).toEqual(order.items[index].kind === 'PIZZA' ? order.items[index].snapshot : null); expect(Date.parse(pizza.production.finishedAt!)).toBeGreaterThanOrEqual(Date.parse(pizza.production.finishingStartedAt!)); }
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { changedAt: 'asc' } });
    const events = history.filter(event => event.metadata && JSON.parse(event.metadata).event).map(event => ({ ...JSON.parse(event.metadata!), actorId: event.actorId })); expect(events.map(event => event.event)).toContain('EXTRA_CHECKED'); expect(events.at(-1)).toMatchObject({ event: 'RELEASED_TO_DISPATCH', actorId: b.session.operatorId, operatorSessionId: b.session.sessionId, workstationId: b.session.workstationId });
  });
  it('pedido parcial permite conferir pizza e extras, preserva OVEN e bloqueia embalagem/release', async () => {
    const { order, a } = await setup(3, 2); let current = await run(order, 'START_FINISHING', a); current = await run(current, 'CHECK_PIZZA', a); current = await run(current, 'CHECK_EXTRA', a);
    expect(current.status).toBe('OVEN');
    for (const command of ['CONFIRM_PACKAGING', 'RELEASE_TO_DISPATCH'] as const) expect((await request(app).post(finishEndpoint(current)).set(a.headers).send(finishInput(current, command))).status).toBe(409);
    expect((await request(app).post(finishEndpoint(current)).set(a.headers).send(finishInput(current, 'START_FINISHING', 2))).status).toBe(409);
  });
  it('não inicia pedido sem pizza assada e não pula BAKED para FINISHED', async () => {
    const { order, a } = await setup(1, 0); expect((await request(app).post(finishEndpoint(order)).set(a.headers).send(finishInput(order, 'START_FINISHING'))).status).toBe(409);
    const ready = await setup(); expect((await request(app).post(finishEndpoint(ready.order)).set(ready.a.headers).send(finishInput(ready.order, 'CHECK_PIZZA'))).status).toBe(409);
  });
  it('conferência parcial de extra contabiliza unidades e bloqueia excesso/quantidade regressiva', async () => {
    const { order, a } = await setup(); const payload = finishInput(order, 'CHECK_EXTRA', 1); if (payload.command !== 'CHECK_EXTRA') throw new Error('Extra');
    const first = await request(app).post(finishEndpoint(order)).set(a.headers).send({ ...payload, checkedQuantity: 1 }); expect(first.status).toBe(200);
    const current = first.body.order as Order; expect(current.items.find(item => item.id === payload.extraId)).toMatchObject({ checkedQuantity: 1, state: 'WAITING_FINISHING', checkedAt: expect.any(String) });
    const next = finishInput(current, 'CHECK_EXTRA', 1); for (const quantity of [1, 3]) expect((await request(app).post(finishEndpoint(order)).set(a.headers).send({ ...next, checkedQuantity: quantity, clientCommandId: randomUUID() })).status).toBe(409);
    expect((await run(current, 'CHECK_EXTRA', a, 1)).items.find(item => item.id === payload.extraId)).toMatchObject({ checkedQuantity: 2, state: 'FINISHED' });
  });
  it('todas as pizzas conferidas não permitem embalagem/liberação com extras incompletos', async () => {
    const { order, a } = await setup(); let current = await run(order, 'START_FINISHING', a); current = await run(current, 'CHECK_PIZZA', a); current = await run(current, 'CHECK_EXTRA', a);
    const payload = finishInput(current, 'CHECK_EXTRA', 1); if (payload.command !== 'CHECK_EXTRA') throw new Error('Extra');
    const partial = await request(app).post(finishEndpoint(current)).set(a.headers).send({ ...payload, checkedQuantity: 1 }); expect(partial.status).toBe(200); current = partial.body.order;
    for (const command of ['CONFIRM_PACKAGING', 'RELEASE_TO_DISPATCH'] as const) expect((await request(app).post(finishEndpoint(current)).set(a.headers).send(finishInput(current, command))).status).toBe(409);
    expect((await creation.get(order.id))?.packingFinishedAt).toBeNull();
  });
  it.each(['START_FINISHING', 'CHECK_PIZZA', 'CHECK_EXTRA', 'CONFIRM_PACKAGING', 'RELEASE_TO_DISPATCH'] as const)('%s exige autenticação e presença', async command => {
    const { order, a } = await setup(); const payload = finishInput(order, command);
    expect((await request(app).post(finishEndpoint(order)).send(payload)).status).toBe(401);
    await prisma.operatorSession.update({ where: { id: a.session.sessionId }, data: { lastSeenAt: new Date(Date.now() - 60001) } }); expect((await request(app).post(finishEndpoint(order)).set(a.headers).send(payload)).status).toBe(409);
  });
  it('estado/versão do pedido e do item, pizza/extra errados são rejeitados sem atualização', async () => {
    const { order, a } = await setup(), other = await setup(); const payload = finishInput(order, 'START_FINISHING');
    for (const change of [{ expectedVersion: 99 }, { expectedItemVersion: 99 }, { pizzaId: other.order.items[0].id }]) expect((await request(app).post(finishEndpoint(order)).set(a.headers).send({ ...payload, ...change })).status).toBe(change.pizzaId ? 404 : 409);
    const extra = finishInput(order, 'CHECK_EXTRA'); expect((await request(app).post(finishEndpoint(order)).set(a.headers).send({ ...extra, extraId: other.order.items.find(item => item.kind === 'EXTRA')!.id })).status).toBe(404);
    expect(notifications).toEqual([]);
  });
  it('mesmo ID/conteúdo retorna recibo; outro conteúdo conflita; GET preserva estado mais recente', async () => {
    const { order, a } = await setup(), payload = finishInput(order, 'START_FINISHING');
    const first = await request(app).post(finishEndpoint(order)).set(a.headers).send(payload); expect(first.status).toBe(200); await run(first.body.order, 'CHECK_PIZZA', a);
    const count = notifications.length, replay = await request(app).post(finishEndpoint(order)).set(a.headers).send(payload); expect(replay.body.replayed).toBe(true); expect(notifications).toHaveLength(count);
    expect((await request(app).post(finishEndpoint(order)).set(a.headers).send({ ...payload, expectedVersion: 99 })).status).toBe(409);
    expect((await request(app).get(`/orders/v2/${order.id}`)).body.items[0].production.state).toBe('FINISHED');
  });
  it('dois tablets conferindo simultaneamente têm um vencedor e um 409', async () => {
    const { order, a, b } = await setup(); const current = await run(order, 'START_FINISHING', a);
    const responses = await Promise.all([a, b].map(actor => request(app).post(finishEndpoint(order)).set(actor.headers).send(finishInput(current, 'CHECK_PIZZA')))); expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.pizzaProductionHistory.count({ where: { eventType: 'PIZZA_CHECKED' } })).toBe(1);
  });
  it('liberação simultânea é única; mesmo comando duplicado é replay', async () => {
    const { order, a, b } = await setup(1, 1, false); const checked = await checkItems(order, a), packed = await run(checked, 'CONFIRM_PACKAGING', a);
    const responses = await Promise.all([a, b].map(actor => request(app).post(finishEndpoint(order)).set(actor.headers).send(finishInput(packed, 'RELEASE_TO_DISPATCH')))); expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const winnerIndex = responses.findIndex(response => response.status === 200), winner = responses[winnerIndex];
    const replay = await request(app).post(finishEndpoint(order)).set([a, b][winnerIndex].headers).send({ command: 'RELEASE_TO_DISPATCH', expectedVersion: packed.version, clientCommandId: winner.body.clientCommandId }); expect(replay.status).toBe(200); expect(replay.body.replayed).toBe(true);
    expect((await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } })).filter(event => event.metadata?.includes('RELEASED_TO_DISPATCH'))).toHaveLength(1);
    const next = await setup(1, 1, false), payload = finishInput(next.order, 'START_FINISHING'); const duplicates = await Promise.all([1, 2].map(() => request(app).post(finishEndpoint(next.order)).set(next.a.headers).send(payload))); expect(duplicates.every(response => response.status === 200)).toBe(true); expect(duplicates.filter(response => response.body.replayed)).toHaveLength(1);
  });
  it('rollback na liberação preserva FINISHING, embalagem, histórico e recibo', async () => {
    const { order, a } = await setup(1, 1, false), packed = await run(await checkItems(order, a), 'CONFIRM_PACKAGING', a), payload = finishInput(packed, 'RELEASE_TO_DISPATCH'); notifications.length = 0;
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_release BEFORE INSERT ON FinishingCommandReceipt BEGIN SELECT RAISE(ABORT, 'release rollback'); END`);
    try { expect((await request(app).post(finishEndpoint(order)).set(a.headers).send(payload)).status).toBe(500); expect(await creation.get(order.id)).toEqual(packed); expect(await prisma.finishingCommandReceipt.findUnique({ where: { clientCommandId: payload.clientCommandId } })).toBeNull(); expect((await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } })).filter(event => event.metadata?.includes('RELEASED_TO_DISPATCH'))).toHaveLength(0); expect(notifications).toEqual([]); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER fail_release'); }
  });
  it.each(['history', 'receipt', 'order'] as const)('rollback em %s não deixa conferência parcial ou evento', async part => {
    const { order, a } = await setup(), table = part === 'history' ? 'OrderStatusHistory' : part === 'receipt' ? 'FinishingCommandReceipt' : 'Order', verb = part === 'order' ? 'UPDATE' : 'INSERT';
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_finishing BEFORE ${verb} ON "${table}" BEGIN SELECT RAISE(ABORT, 'finishing rollback'); END`);
    try { expect((await request(app).post(finishEndpoint(order)).set(a.headers).send(finishInput(order, 'START_FINISHING'))).status).toBe(500); expect(await creation.get(order.id)).toEqual(order); expect(await prisma.finishingCommandReceipt.count()).toBe(0); expect(notifications).toEqual([]); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER fail_finishing'); }
  });
  it('criação sem pizzas continua explicitamente não suportada e v1 preservado', async () => {
    expect((await request(app).post('/orders/v2').send({ clientRequestId: randomUUID(), customerName: 'Extras only', fulfillmentType: 'PICKUP', channel: 'COUNTER', pizzas: [], extras: [{ extraCatalogId: 'molho-extra', quantity: 1, notes: null }] })).status).toBe(400);
    const { a, order } = await setup(); const old = await request(app).post('/orders').send({ customerName: 'Legacy', type: 'PICKUP', items: [{ name: 'Pizza antiga', size: 'Grande' }] }); expect(old.status).toBe(201);
    expect((await request(app).get(`/orders/${old.body.id}`)).status).toBe(200); expect((await request(app).post(`/orders/v2/${old.body.id}/finishing/commands`).set(a.headers).send(finishInput(order, 'CONFIRM_PACKAGING'))).status).toBe(404);
  });
});
