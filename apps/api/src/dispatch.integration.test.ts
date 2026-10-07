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
import { DispatchService } from './dispatch.js';
import type { DispatchCommandInput } from '@guigs/shared';
import type { FinishingCommandInput } from '@guigs/shared';

const name = `test-dispatch-${randomUUID()}.db`, path = resolve(process.cwd(), 'prisma', name);
const prisma = new PrismaClient({ datasources: { db: { url: `file:./${name}` } } });
const creation = new StructuredOrderService(prisma, undefined, 1), commands = new PizzaCommandService(prisma), notifications: KitchenNotification[] = [];

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
async function setup(count = 1, bakedCount = count, withExtras = true, fulfillmentType: 'DELIVERY' | 'PICKUP' = 'PICKUP') {
  const assembler = await login(0, true);
  let order = (await creation.create({ clientRequestId: randomUUID(), customerName: 'Forno fixture', customerPhone: '', fulfillmentType, channel: 'COUNTER', notes: 'Conferir pedido', extras: withExtras ? [{ extraCatalogId: 'coca-cola-2l', quantity: 1, notes: 'Gelada' }, { extraCatalogId: 'molho-extra', quantity: 2, notes: 'Separado' }] : [],
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
  await prisma.$transaction([prisma.dispatchCommandReceipt.deleteMany(), prisma.finishingCommandReceipt.deleteMany(), prisma.pizzaCommandReceipt.deleteMany(), prisma.structuredOrderCreation.deleteMany(), prisma.pizzaProductionHistory.deleteMany(), prisma.orderStatusHistory.deleteMany(), prisma.pizzaIngredientModifier.deleteMany(), prisma.pizzaHalf.deleteMany(), prisma.extraItem.deleteMany(), prisma.pizzaItem.deleteMany(), prisma.order.deleteMany(), prisma.operatorSession.updateMany({ data: { active: false, endedAt: new Date(), presenceStatus: 'OFFLINE' } })]);
  sessions = new OperatorSessionService(prisma); notifications.length = 0;
  app = createApp(new OrderService(prisma), () => {}, 'http://localhost:5173', creation, commands, event => notifications.push(event), sessions, undefined, new FinishingService(prisma), new DispatchService(prisma));
});
afterAll(async () => { await prisma.$disconnect(); for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true }); });

const finishEndpoint = (order: Order) => `/orders/v2/${order.id}/finishing/commands`;
function finishInput(order: Order, command: FinishingCommandInput['command'], index = 0): FinishingCommandInput {
  const common = { expectedVersion: order.version, clientCommandId: randomUUID() };
  if (command === 'START_FINISHING' || command === 'CHECK_PIZZA' || command === 'UNCHECK_PIZZA') { const pizza = order.items.filter(item => item.kind === 'PIZZA')[index]; return { ...common, command, pizzaId: pizza.id, expectedItemVersion: pizza.production.version }; }
  if (command === 'CHECK_EXTRA' || command === 'UNCHECK_EXTRA') { const extra = order.items.filter(item => item.kind === 'EXTRA')[index]; return { ...common, command, extraId: extra.id, expectedItemVersion: extra.version, checkedQuantity: command === 'CHECK_EXTRA' ? extra.quantity : Math.max(0, extra.checkedQuantity - 1) }; }
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

const endpoint = (order: Order) => `/orders/v2/${order.id}/dispatch/commands`;
const dispatchInput = (order: Order, command: DispatchCommandInput['command']): DispatchCommandInput => ({ command, expectedVersion: order.version, clientCommandId: randomUUID() });
async function prepared(type: 'DELIVERY' | 'PICKUP' = 'PICKUP') {
  const result = await setup(1, 1, true, type); result.order = await run(await run(await checkItems(result.order, result.a), 'CONFIRM_PACKAGING', result.a), 'RELEASE_TO_DISPATCH', result.a); notifications.length = 0; return result;
}
async function dispatchRun(order: Order, command: DispatchCommandInput['command'], actor: Awaited<ReturnType<typeof login>>) {
  const response = await request(app).post(endpoint(order)).set(actor.headers).send(dispatchInput(order, command)); expect(response.status).toBe(200); return response.body.order as Order;
}
const dispatchAudit = async (id: string) => (await prisma.orderStatusHistory.findMany({ where: { orderId: id }, orderBy: { changedAt: 'asc' } })).filter(e => e.metadata?.includes('MARK_'));

describe('despacho persistente e conclusão', () => {
  it.each(['DELIVERY', 'PICKUP'] as const)('%s ponta a ponta preserva produção, snapshots, autoria e timestamps', async type => {
    const { order, a, b } = await prepared(type), before = Date.now(); let current = order;
    const sequence = type === 'DELIVERY' ? ['MARK_WAITING_DRIVER', 'MARK_OUT_FOR_DELIVERY', 'MARK_DELIVERED'] as const : ['MARK_READY_FOR_PICKUP', 'MARK_PICKED_UP'] as const;
    for (const command of sequence) { current = await dispatchRun(current, command, a); if (!current.dispatch?.completedAt) expect((await request(app).get('/orders/v2')).body.some((value: Order) => value.id === order.id)).toBe(true); }
    expect(current.status).toBe(type === 'DELIVERY' ? 'DELIVERED' : 'PICKED_UP'); expect(current.items).toEqual(order.items); expect(current.dispatch?.dispatchReadyAt).toEqual(order.dispatch?.dispatchReadyAt);
    const timestamps = type === 'DELIVERY' ? [current.dispatch!.waitingDriverAt, current.dispatch!.dispatchedAt, current.dispatch!.deliveredAt] : [current.dispatch!.pickupReadyAt, current.dispatch!.pickedUpAt];
    for (const timestamp of timestamps) expect(Date.parse(timestamp!)).toBeGreaterThanOrEqual(before); expect(current.dispatch?.completedAt).toBe(timestamps.at(-1));
    expect((await request(app).get(`/orders/v2/${order.id}`)).body).toEqual(current); expect((await request(app).get('/orders/v2')).body.some((value: Order) => value.id === order.id)).toBe(false);
    for (const command of sequence) expect((await request(app).post(endpoint(order)).set(b.headers).send(dispatchInput(current, command))).status).toBe(409);
    const events = await dispatchAudit(order.id); expect(events).toHaveLength(sequence.length); expect(events.map(e => JSON.parse(e.metadata!).command)).toEqual(sequence); expect(events.every(e => e.actorId === a.session.operatorId && JSON.parse(e.metadata!).operatorSessionId === a.session.sessionId && JSON.parse(e.metadata!).workstationId === a.session.workstationId)).toBe(true);
    const allHistory = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } }); expect(allHistory.some(e => e.fromStatus === null)).toBe(true); expect(allHistory.some(e => e.metadata?.includes('RELEASED_TO_DISPATCH'))).toBe(true);
    expect(notifications).toHaveLength(sequence.length); expect(notifications.at(-1)).toMatchObject({ type: 'kitchen.order.updated', payload: { status: current.status, version: current.version } });
  });
  it('Balcão é canal: PICKUP/COUNTER segue retirada, DELIVERY/COUNTER segue delivery', async () => {
    const pickup = await prepared('PICKUP'), delivery = await prepared('DELIVERY'); expect(pickup.order.channel).toBe('COUNTER'); expect(delivery.order.channel).toBe('COUNTER');
    expect((await dispatchRun(pickup.order, 'MARK_READY_FOR_PICKUP', pickup.a)).status).toBe('READY_FOR_PICKUP'); expect((await dispatchRun(delivery.order, 'MARK_WAITING_DRIVER', delivery.a)).status).toBe('WAITING_DRIVER');
  });
  it('proíbe comandos de outro atendimento e saltos/repetição de estado', async () => {
    const { order, a } = await prepared('DELIVERY');
    for (const command of ['MARK_READY_FOR_PICKUP', 'MARK_PICKED_UP', 'MARK_OUT_FOR_DELIVERY', 'MARK_DELIVERED'] as const) expect((await request(app).post(endpoint(order)).set(a.headers).send(dispatchInput(order, command))).status).toBe(409);
    const pickup = await prepared(); for (const command of ['MARK_WAITING_DRIVER', 'MARK_OUT_FOR_DELIVERY', 'MARK_DELIVERED', 'MARK_PICKED_UP'] as const) expect((await request(app).post(endpoint(pickup.order)).set(pickup.a.headers).send(dispatchInput(pickup.order, command))).status).toBe(409);
    const waiting = await dispatchRun(order, 'MARK_WAITING_DRIVER', a); expect((await request(app).post(endpoint(order)).set(a.headers).send(dispatchInput(waiting, 'MARK_WAITING_DRIVER'))).status).toBe(409); expect((await request(app).post(endpoint(order)).set(a.headers).send({ ...dispatchInput(waiting, 'MARK_OUT_FOR_DELIVERY'), expectedVersion: 0 })).status).toBe(409);
  });
  it('não despacha pedido sem liberação ou com agregado adulterado/itens pendentes', async () => {
    const { order, a } = await setup(); expect((await request(app).post(endpoint(order)).set(a.headers).send(dispatchInput(order, 'MARK_READY_FOR_PICKUP'))).status).toBe(409);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'WAITING_DISPATCH' } }); const forged = (await creation.get(order.id))!; expect((await request(app).post(endpoint(order)).set(a.headers).send(dispatchInput(forged, 'MARK_READY_FOR_PICKUP'))).status).toBe(409); expect(notifications).toEqual([]);
  });
  it.each(['MARK_WAITING_DRIVER', 'MARK_OUT_FOR_DELIVERY', 'MARK_DELIVERED', 'MARK_READY_FOR_PICKUP', 'MARK_PICKED_UP'] as const)('%s exige sessão/presença', async command => {
    const { order, a } = await prepared(); expect((await request(app).post(endpoint(order)).send(dispatchInput(order, command))).status).toBe(401);
    await prisma.operatorSession.update({ where: { id: a.session.sessionId }, data: { lastSeenAt: new Date(Date.now() - 60001) } }); expect((await request(app).post(endpoint(order)).set(a.headers).send(dispatchInput(order, command))).status).toBe(409);
  });
  it('idempotência mantém resultado original após conclusão; outro conteúdo/operador conflita', async () => {
    const { order, a, b } = await prepared(), payload = dispatchInput(order, 'MARK_READY_FOR_PICKUP');
    const first = await request(app).post(endpoint(order)).set(a.headers).send(payload); expect(first.status).toBe(200); const completed = await dispatchRun(first.body.order, 'MARK_PICKED_UP', a), count = notifications.length;
    const replay = await request(app).post(endpoint(order)).set(a.headers).send(payload); expect(replay.body).toEqual({ ...first.body, replayed: true }); expect(notifications).toHaveLength(count); expect(await creation.get(order.id)).toEqual(completed);
    expect((await request(app).post(endpoint(order)).set(a.headers).send({ ...payload, expectedVersion: 99 })).status).toBe(409); expect((await request(app).post(endpoint(order)).set(b.headers).send(payload)).status).toBe(409);
  });
  it.each(['DELIVERY', 'PICKUP'] as const)('dupla conclusão %s tem um commit e um 409', async type => {
    const { order, a, b } = await prepared(type); let current = type === 'DELIVERY' ? await dispatchRun(await dispatchRun(order, 'MARK_WAITING_DRIVER', a), 'MARK_OUT_FOR_DELIVERY', a) : await dispatchRun(order, 'MARK_READY_FOR_PICKUP', a);
    const command = type === 'DELIVERY' ? 'MARK_DELIVERED' : 'MARK_PICKED_UP'; const responses = await Promise.all([a, b].map(actor => request(app).post(endpoint(order)).set(actor.headers).send(dispatchInput(current, command)))); expect(responses.map(r => r.status).sort()).toEqual([200, 409]); current = responses.find(r => r.status === 200)!.body.order; expect(current.dispatch?.completedAt).not.toBeNull(); expect((await dispatchAudit(order.id)).filter(e => JSON.parse(e.metadata!).command === command)).toHaveLength(1);
  });
  it('mesmo comando simultâneo tem um recibo e um replay', async () => {
    const { order, a } = await prepared(), payload = dispatchInput(order, 'MARK_READY_FOR_PICKUP');
    const responses = await Promise.all([1, 2].map(() => request(app).post(endpoint(order)).set(a.headers).send(payload))); expect(responses.map(r => r.status)).toEqual([200, 200]); expect(responses.filter(r => r.body.replayed)).toHaveLength(1); expect(await prisma.dispatchCommandReceipt.count()).toBe(1); expect(notifications).toHaveLength(1);
  });
  it.each(['history', 'receipt', 'order'] as const)('rollback em %s restaura timestamps, estado e histórico', async part => {
    const { order, a } = await prepared(), history = await prisma.orderStatusHistory.count(), payload = dispatchInput(order, 'MARK_READY_FOR_PICKUP'), table = part === 'history' ? 'OrderStatusHistory' : part === 'receipt' ? 'DispatchCommandReceipt' : 'Order', verb = part === 'order' ? 'UPDATE' : 'INSERT';
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_dispatch BEFORE ${verb} ON "${table}" BEGIN SELECT RAISE(ABORT, 'dispatch rollback'); END`);
    try { expect((await request(app).post(endpoint(order)).set(a.headers).send(payload)).status).toBe(500); expect(await creation.get(order.id)).toEqual(order); expect(await prisma.orderStatusHistory.count()).toBe(history); expect(await prisma.dispatchCommandReceipt.count()).toBe(0); expect(notifications).toEqual([]); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER fail_dispatch'); }
  });
  it('pedido inexistente/v1 rejeitados e 30 pedidos liberados permanecem na lista', async () => {
    const { order, a } = await prepared(); expect((await request(app).post('/orders/v2/clxxxxxxxxxxxxxxxxxxxxxxx/dispatch/commands').set(a.headers).send(dispatchInput(order, 'MARK_READY_FOR_PICKUP'))).status).toBe(404);
    const legacy = await request(app).post('/orders').send({ customerName: 'Legado', type: 'PICKUP', items: [{ name: 'Texto', size: 'Grande' }] }); expect(legacy.status).toBe(201); expect((await request(app).post(`/orders/v2/${legacy.body.id}/dispatch/commands`).set(a.headers).send(dispatchInput(order, 'MARK_READY_FOR_PICKUP'))).status).toBe(404);
    // Additional fixtures traverse real services; no direct fabricated production states.
    for (let index = 0; index < 29; index++) await prepared(); expect((await creation.listActive()).filter(value => value.status === 'WAITING_DISPATCH')).toHaveLength(30);
  }, 300000);
});

describe('fechamento e compatibilidade de despacho', () => {
  it('rollback de conclusão desfaz completedAt/deliveredAt e permite repetir o mesmo comando', async () => {
    const { order, a } = await prepared('DELIVERY'), current = await dispatchRun(await dispatchRun(order, 'MARK_WAITING_DRIVER', a), 'MARK_OUT_FOR_DELIVERY', a), payload = dispatchInput(current, 'MARK_DELIVERED'), count = await prisma.orderStatusHistory.count(); notifications.length = 0;
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_completion BEFORE INSERT ON DispatchCommandReceipt BEGIN SELECT RAISE(ABORT, 'completion rollback'); END`);
    try { expect((await request(app).post(endpoint(order)).set(a.headers).send(payload)).status).toBe(500); expect(await creation.get(order.id)).toEqual(current); expect(await prisma.orderStatusHistory.count()).toBe(count); expect(notifications).toEqual([]); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER fail_completion'); }
    const completed = await request(app).post(endpoint(order)).set(a.headers).send(payload); expect(completed.status).toBe(200); expect(completed.body.order.dispatch.completedAt).toBe(completed.body.order.dispatch.deliveredAt);
  });
  it('pedido liberado antes desta migration mantém data desconhecida sem inventar histórico e pode avançar', async () => {
    const { order, a } = await prepared(); await prisma.order.update({ where: { id: order.id }, data: { dispatchReadyAt: null } }); const old = (await creation.get(order.id))!, count = await prisma.orderStatusHistory.count();
    expect(old.dispatch?.dispatchReadyAt).toBeNull(); const ready = await dispatchRun(old, 'MARK_READY_FOR_PICKUP', a); expect(ready.dispatch?.dispatchReadyAt).toBeNull(); expect(ready.dispatch?.pickupReadyAt).not.toBeNull(); expect(await prisma.orderStatusHistory.count()).toBe(count + 1);
  });
});
