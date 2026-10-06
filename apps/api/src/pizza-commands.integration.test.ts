import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assemblyCommandTransitions, type KitchenNotification, type Order, type PizzaCommandInput } from '@guigs/shared';
import { createApp } from './app.js';
import { OrderService } from './orders.js';
import { StructuredOrderService } from './structured-orders.js';
import { PizzaCommandConflictError, PizzaCommandService } from './pizza-commands.js';
import { configureOperator, OperatorSessionService, type SessionCredentials } from './operator-sessions.js';
let auth: SessionCredentials, authHeaders: Record<string, string>, operatorId: string, workstationId: string;
const execute = (orderId: string, pizzaId: string, payload: PizzaCommandInput) => commands.execute(orderId, pizzaId, payload, auth);

const name = `test-commands-${randomUUID()}.db`, path = resolve(process.cwd(), 'prisma', name);
const prisma = new PrismaClient({ datasources: { db: { url: `file:./${name}` } } });
const creation = new StructuredOrderService(prisma), commands = new PizzaCommandService(prisma);
const notifications: KitchenNotification[] = [];
const app = createApp(new OrderService(prisma), () => {}, 'http://localhost:5173', creation, commands, event => notifications.push(event));
async function fresh(count = 1) {
  return (await creation.create({ clientRequestId: randomUUID(), customerName: 'Comando teste', customerPhone: '', fulfillmentType: 'DELIVERY', channel: 'COUNTER', notes: '', extras: [],
    pizzas: Array.from({ length: count }, () => ({ size: 'GRANDE', composition: 'WHOLE', firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: null })) })).order;
}
function input(order: Order, command: PizzaCommandInput['command'], index = 0): PizzaCommandInput {
  const pizza = order.items[index]; if (pizza.kind !== 'PIZZA') throw new Error('Pizza esperada');
  return { command, expectedState: pizza.production.state, expectedVersion: pizza.production.version, clientCommandId: randomUUID() };
}
const endpoint = (order: Order, index = 0) => `/orders/v2/${order.id}/pizzas/${order.items[index].id}/commands`;
async function take(orderId: string) {
  return { order: await prisma.order.findUnique({ where: { id: orderId } }), pizzas: await prisma.pizzaItem.findMany({ where: { orderId }, orderBy: { position: 'asc' } }), history: await prisma.pizzaProductionHistory.findMany({ where: { pizza: { orderId } }, orderBy: { id: 'asc' } }), orderHistory: await prisma.orderStatusHistory.findMany({ where: { orderId }, orderBy: { id: 'asc' } }), receipts: await prisma.pizzaCommandReceipt.findMany({ where: { orderId } }) };
}
beforeAll(async () => {
  writeFileSync(path, ''); const directory = resolve(process.cwd(), 'prisma/migrations');
  for (const name of readdirSync(directory).filter(name => /^\d/.test(name)).sort()) for (const sql of readFileSync(resolve(directory, name, 'migration.sql'), 'utf8').split(';').map(part => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(sql);
  await configureOperator(prisma, { name: 'Montador comandos fixture', pin: '4851' });
  const deviceKey = randomUUID(), result = await new OperatorSessionService(prisma).signIn({ pin: '4851', workstationDeviceKey: deviceKey });
  auth = { token: result.token, deviceKey }; operatorId = result.session.operatorId; workstationId = result.session.workstationId;
  authHeaders = { Authorization: `Bearer ${auth.token}`, 'X-Workstation-Device-Key': deviceKey };
});
afterAll(async () => { await prisma.$disconnect(); for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true }); });

describe('comandos persistentes por pizza', () => {
  async function secondActor(sameOperator = false) {
    if (!sameOperator) await configureOperator(prisma, { name: 'Outro montador fixture', pin: '5938' });
    const deviceKey = randomUUID(), result = await new OperatorSessionService(prisma).signIn({ pin: sameOperator ? '4851' : '5938', workstationDeviceKey: deviceKey });
    return { auth: { token: result.token, deviceKey }, session: result.session, headers: { Authorization: `Bearer ${result.token}`, 'X-Workstation-Device-Key': deviceKey } };
  }
  it('claim preserva estado/agregação, registra identidade e pode ser lido novamente', async () => {
    const order = await fresh(), payload = input(order, 'CLAIM_PIZZA'), start = notifications.length;
    const response = await request(app).post(endpoint(order)).set(authHeaders).send(payload);
    expect(response.status).toBe(200); const item = response.body.order.items[0];
    expect(item.assignment).toMatchObject({ operatorId, workstationId });
    expect(item.production).toMatchObject({ state: 'WAITING_ASSEMBLY', version: 1, assemblyStartedAt: null });
    expect(response.body.order.status).toBe('WAITING_PRODUCTION');
    expect((await take(order.id)).order?.productionStartedAt).toBeNull();
    expect(await creation.get(order.id)).toEqual(response.body.order);
    expect((await take(order.id)).history.at(-1)).toMatchObject({ eventType: 'CLAIMED', operatorId, workstationId, itemVersion: 1 });
    expect(notifications.slice(start).map(event => event.type)).toEqual(['kitchen.pizza.updated', 'kitchen.order.updated']);
  });
  it('claim repetido pelo mesmo operador não altera data/versão nem duplica evento', async () => {
    const order = await fresh(), payload = input(order, 'CLAIM_PIZZA');
    const first = await execute(order.id, order.items[0].id, payload), before = await take(order.id);
    expect((await execute(order.id, order.items[0].id, payload)).replayed).toBe(true);
    expect((await execute(order.id, order.items[0].id, input(first.order, 'CLAIM_PIZZA'))).replayed).toBe(true);
    const after = await take(order.id); expect(after.pizzas).toEqual(before.pizzas); expect(after.history).toEqual(before.history);
  });
  it('dois operadores disputam a mesma pizza: somente um claim vence', async () => {
    const other = await secondActor(), order = await fresh();
    const results = await Promise.all([request(app).post(endpoint(order)).set(authHeaders).send(input(order, 'CLAIM_PIZZA')), request(app).post(endpoint(order)).set(other.headers).send(input(order, 'CLAIM_PIZZA'))]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const saved = await take(order.id); expect(saved.pizzas[0].version).toBe(1); expect(saved.history.filter(event => event.eventType === 'CLAIMED')).toHaveLength(1); expect(saved.receipts).toHaveLength(1);
  });
  it.each(['CLAIM_PIZZA', 'RELEASE_PIZZA', 'START_ASSEMBLY'] as const)('outro operador não executa %s em pizza reservada', async command => {
    const other = await secondActor(), order = await fresh();
    const assigned = (await execute(order.id, order.items[0].id, input(order, 'CLAIM_PIZZA'))).order, before = await take(order.id);
    expect((await request(app).post(endpoint(order)).set(other.headers).send(input(assigned, command))).status).toBe(409); expect(await take(order.id)).toEqual(before);
  });
  it.each(['PAUSE_ASSEMBLY', 'SEND_TO_OVEN'] as const)('outro operador não executa %s em montagem', async command => {
    const other = await secondActor(), order = await fresh(); const started = (await execute(order.id, order.items[0].id, input(order, 'START_ASSEMBLY'))).order, before = await take(order.id);
    expect((await request(app).post(endpoint(order)).set(other.headers).send(input(started, command))).status).toBe(409); expect(await take(order.id)).toEqual(before);
  });
  it('release exige pausa, mantém timestamps e permite novo responsável', async () => {
    const other = await secondActor(), order = await fresh(); let current = (await execute(order.id, order.items[0].id, input(order, 'START_ASSEMBLY'))).order;
    await expect(execute(order.id, order.items[0].id, input(current, 'RELEASE_PIZZA'))).rejects.toThrow('Pause');
    current = (await execute(order.id, order.items[0].id, input(current, 'PAUSE_ASSEMBLY'))).order;
    const pausedAt = current.items[0].kind === 'PIZZA' ? current.items[0].production.pausedAt : null;
    const payload = input(current, 'RELEASE_PIZZA'); current = (await execute(order.id, order.items[0].id, payload)).order;
    expect(current.items[0]).toMatchObject({ assignment: null, production: { state: 'ASSEMBLY_PAUSED', pausedAt }, releasedAt: expect.any(String) });
    expect((await execute(order.id, order.items[0].id, payload)).replayed).toBe(true);
    await expect(execute(order.id, order.items[0].id, input(current, 'RESUME_ASSEMBLY'))).rejects.toThrow('Assuma');
    current = (await commands.execute(order.id, order.items[0].id, input(current, 'CLAIM_PIZZA'), other.auth)).order;
    await commands.execute(order.id, order.items[0].id, input(current, 'RESUME_ASSEMBLY'), other.auth);
    expect((await take(order.id)).history.filter(event => event.eventType === 'RELEASED')).toHaveLength(1);
    expect((await take(order.id)).history.at(-1)?.operatorId).toBe(other.session.operatorId);
  });
  it('duas sessões do mesmo operador podem operar; versão continua protegida', async () => {
    const other = await secondActor(true), order = await fresh();
    const current = (await execute(order.id, order.items[0].id, input(order, 'START_ASSEMBLY'))).order;
    const result = await commands.execute(order.id, order.items[0].id, input(current, 'PAUSE_ASSEMBLY'), other.auth);
    expect(result.order.items[0]).toMatchObject({ assignment: { operatorId, workstationId }, production: { state: 'ASSEMBLY_PAUSED' } });
    expect((await take(order.id)).history.at(-1)).toMatchObject({ operatorSessionId: other.session.sessionId, workstationId: other.session.workstationId });
  });
  it('start livre faz claim e montagem com uma única versão e transação', async () => {
    const order = await fresh(), payload = input(order, 'START_ASSEMBLY'); const result = await execute(order.id, order.items[0].id, payload);
    expect(result.order.items[0]).toMatchObject({ assignment: { operatorId }, production: { version: 1, state: 'ASSEMBLING' } });
    const events = (await take(order.id)).history.filter(event => event.itemVersion === 1);
    expect(events.map(event => event.eventType).sort()).toEqual(['CLAIMED', 'START_ASSEMBLY']); expect(events[0].changedAt).toEqual(events[1].changedAt);
  });
  it('sessão inválida não assume pizza', async () => {
    const order = await fresh(), before = await take(order.id);
    expect((await request(app).post(endpoint(order)).send(input(order, 'CLAIM_PIZZA'))).status).toBe(401); expect(await take(order.id)).toEqual(before);
  });
  it('reserva bloqueia logout em espera/montagem/pausa e troca por outro PIN; liberação explícita permite logout', async () => {
    await configureOperator(prisma, { name: 'Sessão reserva fixture', pin: '6049' });
    const sessions = new OperatorSessionService(prisma), deviceKey = randomUUID();
    const signed = await sessions.signIn({ pin: '6049', workstationDeviceKey: deviceKey }); const credentials = { token: signed.token, deviceKey };
    const order = await fresh(); const run = async (current: Order, command: PizzaCommandInput['command']) => (await commands.execute(order.id, order.items[0].id, input(current, command), credentials)).order;
    let current = await run(order, 'CLAIM_PIZZA');
    await expect(sessions.end(credentials)).rejects.toThrow('responsabilidade');
    await expect(sessions.signIn({ pin: '4851', workstationDeviceKey: deviceKey })).rejects.toThrow('responsabilidade');
    current = await run(current, 'START_ASSEMBLY'); await expect(sessions.end(credentials)).rejects.toThrow('responsabilidade');
    current = await run(current, 'PAUSE_ASSEMBLY'); await expect(sessions.end(credentials)).rejects.toThrow('responsabilidade');
    await run(current, 'RELEASE_PIZZA'); await sessions.end(credentials);
    expect((await prisma.operatorSession.findUniqueOrThrow({ where: { id: signed.session.sessionId } })).active).toBe(false);
  });
  it('expiração não libera reserva; mesmo operador recupera em nova sessão e outro não retoma', async () => {
    const other = await secondActor(true), order = await fresh(); const assigned = (await commands.execute(order.id, order.items[0].id, input(order, 'START_ASSEMBLY'), other.auth)).order;
    await prisma.operatorSession.update({ where: { id: other.session.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
    const stored = (await take(order.id)).pizzas[0]; expect(stored.assignedOperatorId).toBe(operatorId);
    await expect(commands.execute(order.id, order.items[0].id, input(assigned, 'PAUSE_ASSEMBLY'), other.auth)).rejects.toThrow('Sessão operacional');
    const recovered = await new OperatorSessionService(prisma).signIn({ pin: '4851', workstationDeviceKey: other.auth.deviceKey });
    const result = await commands.execute(order.id, order.items[0].id, input(assigned, 'PAUSE_ASSEMBLY'), { token: recovered.token, deviceKey: other.auth.deviceKey });
    expect(result.order.items[0]).toMatchObject({ assignment: { operatorId, sessionId: other.session.sessionId }, production: { state: 'ASSEMBLY_PAUSED' } });
  });
  it('outro operador não retoma pizza pausada', async () => {
    const other = await secondActor(), order = await fresh(); const started = (await execute(order.id, order.items[0].id, input(order, 'START_ASSEMBLY'))).order;
    const paused = (await execute(order.id, order.items[0].id, input(started, 'PAUSE_ASSEMBLY'))).order, before = await take(order.id);
    expect((await request(app).post(endpoint(order)).set(other.headers).send(input(paused, 'RESUME_ASSEMBLY'))).status).toBe(409); expect(await take(order.id)).toEqual(before);
  });
  it.each(['CLAIM_PIZZA', 'RELEASE_PIZZA'] as const)('rollback de %s preserva assignment, histórico e receipt', async command => {
    const order = await fresh(); const current = command === 'RELEASE_PIZZA' ? (await execute(order.id, order.items[0].id, input(order, 'CLAIM_PIZZA'))).order : order;
    const before = await take(order.id), eventCount = notifications.length;
    await prisma.$executeRawUnsafe('CREATE TRIGGER fail_claim BEFORE INSERT ON "PizzaCommandReceipt" BEGIN SELECT RAISE(ABORT, \'claim failed\'); END');
    try { expect((await request(app).post(endpoint(order)).set(authHeaders).send(input(current, command))).status).toBe(500); expect(await take(order.id)).toEqual(before); expect(notifications.length).toBe(eventCount); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER fail_claim'); }
  });
  it('inicia, pausa, retoma e envia ao forno com versões, timestamps e histórico', async () => {
    let order = await fresh(); const queued = (await take(order.id)).pizzas[0].queuedAt;
    let started: string | null = null;
    for (const [index, command] of (['START_ASSEMBLY', 'PAUSE_ASSEMBLY', 'RESUME_ASSEMBLY', 'SEND_TO_OVEN'] as const).entries()) {
      const payload = input(order, command), response = await request(app).post(endpoint(order)).set(authHeaders).send(payload);
      expect(response.status).toBe(200); order = response.body.order;
      const pizza = order.items[0]; if (pizza.kind !== 'PIZZA') throw new Error('Pizza esperada');
      expect(pizza.production.state).toBe(assemblyCommandTransitions[command].to);
      expect(pizza.production.version).toBe(index + 1); expect(order.version).toBe(index + 1);
      if (index === 0) started = pizza.production.assemblyStartedAt;
      expect(pizza.production.assemblyStartedAt).toBe(started);
      expect(Boolean(pizza.production.pausedAt)).toBe(command === 'PAUSE_ASSEMBLY');
      expect(Boolean(pizza.production.assemblyCompletedAt)).toBe(command === 'SEND_TO_OVEN');
      expect(pizza.production.ovenStartedAt).toBeNull(); expect(pizza.production.bakedAt).toBeNull();
      const history = await prisma.pizzaProductionHistory.findUniqueOrThrow({ where: { commandId: payload.clientCommandId } });
      expect(history).toMatchObject({ eventType: command, fromState: payload.expectedState, toState: assemblyCommandTransitions[command].to, itemVersion: index + 1, actorType: 'OPERATOR', actorId: operatorId, operatorId, workstationId });
      expect(history.changedAt.getTime()).toBeGreaterThanOrEqual(queued.getTime());
      if (command === 'PAUSE_ASSEMBLY') expect(pizza.production.pausedAt).toBe(history.changedAt.toISOString());
      if (command === 'SEND_TO_OVEN') expect(pizza.production.assemblyCompletedAt).toBe(history.changedAt.toISOString());
    }
    expect(order.status).toBe('OVEN');
    expect((await creation.get(order.id))).toEqual(order);
    expect(await prisma.pizzaProductionHistory.count({ where: { pizzaId: order.items[0].id } })).toBe(6);
    const persisted = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(persisted.ovenStartedAt).toBeNull(); expect(persisted.productionFinishedAt).toBeNull();
  });
  it.each(['state', 'version', 'transition'] as const)('rejeita %s inválido com 409, sem qualquer escrita', async kind => {
    const order = await fresh(), before = await take(order.id), payload = input(order, 'START_ASSEMBLY');
    if (kind === 'state') payload.expectedState = 'ASSEMBLING';
    if (kind === 'version') payload.expectedVersion = 3;
    if (kind === 'transition') payload.command = 'SEND_TO_OVEN';
    expect((await request(app).post(endpoint(order)).set(authHeaders).send(payload)).status).toBe(409);
    expect(await take(order.id)).toEqual(before);
  });
  it('pedido/pizza errados e pertencimento inválido retornam 404', async () => {
    const a = await fresh(), b = await fresh(), payload = input(a, 'START_ASSEMBLY'), before = await take(a.id);
    for (const path of [`/orders/v2/${a.id}/pizzas/${b.items[0].id}/commands`, `/orders/v2/caaaaaaaaaaaaaaaaaaaaaaaa/pizzas/${a.items[0].id}/commands`, `/orders/v2/${a.id}/pizzas/caaaaaaaaaaaaaaaaaaaaaaaa/commands`]) expect((await request(app).post(path).set(authHeaders).send(payload)).status).toBe(404);
    expect(await take(a.id)).toEqual(before);
  });
  it('não aceita comandos de forno, timestamps do cliente ou UUID inválida', async () => {
    const order = await fresh(), before = await take(order.id);
    for (const patch of [{ command: 'ENTER_OVEN' }, { assemblyStartedAt: '2000-01-01' }, { clientCommandId: 'abc' }]) expect((await request(app).post(endpoint(order)).set(authHeaders).send({ ...input(order, 'START_ASSEMBLY'), ...patch })).status).toBe(400);
    expect(await take(order.id)).toEqual(before);
  });
  it('idempotência retorna resultado anterior sem alterar timestamps, versões ou histórico', async () => {
    const order = await fresh(), payload = input(order, 'START_ASSEMBLY');
    const first = await execute(order.id, order.items[0].id, payload), before = await take(order.id);
    const repeated = await execute(order.id, order.items[0].id, payload);
    expect(repeated).toEqual({ ...first, replayed: true }); expect(await take(order.id)).toEqual(before);
    await execute(order.id, order.items[0].id, input(first.order, 'PAUSE_ASSEMBLY'));
    expect(await execute(order.id, order.items[0].id, payload)).toEqual({ ...first, replayed: true });
  });
  it('mesmo ID com conteúdo ou destino diferente retorna conflito', async () => {
    const order = await fresh(2), payload = input(order, 'START_ASSEMBLY');
    await execute(order.id, order.items[0].id, payload);
    await expect(execute(order.id, order.items[0].id, { ...payload, command: 'PAUSE_ASSEMBLY' })).rejects.toBeInstanceOf(PizzaCommandConflictError);
    await expect(execute(order.id, order.items[1].id, payload)).rejects.toBeInstanceOf(PizzaCommandConflictError);
  });
  it('duas requisições simultâneas sobre a mesma versão: uma aceita e outra 409', async () => {
    const order = await fresh();
    const responses = await Promise.all([request(app).post(endpoint(order)).set(authHeaders).send(input(order, 'START_ASSEMBLY')), request(app).post(endpoint(order)).set(authHeaders).send(input(order, 'START_ASSEMBLY'))]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect((await take(order.id)).pizzas[0].version).toBe(1);
    expect((await take(order.id)).history).toHaveLength(3);
  });
  it('mesmo comando simultâneo cria só um histórico e um receipt', async () => {
    const order = await fresh(), payload = input(order, 'START_ASSEMBLY');
    const results = await Promise.all([execute(order.id, order.items[0].id, payload), execute(order.id, order.items[0].id, payload)]);
    expect(results.filter(result => !result.replayed)).toHaveLength(1);
    expect(results[0].order).toEqual(results[1].order);
    expect((await take(order.id)).receipts).toHaveLength(1);
  });
  it('HTTP publica pizza e pedido somente após commit; replay e 409 não publicam', async () => {
    const order = await fresh(), payload = input(order, 'START_ASSEMBLY'), start = notifications.length;
    const first = await request(app).post(endpoint(order)).set(authHeaders).send(payload);
    expect(first.status).toBe(200);
    expect(notifications.slice(start).map(event => event.type)).toEqual(['kitchen.pizza.updated', 'kitchen.order.updated']);
    expect(notifications[start].payload).toMatchObject({ schemaVersion: 1, orderId: order.id, commandId: payload.clientCommandId, version: 1 });
    expect(notifications[start + 1].payload).toMatchObject({ status: 'IN_PRODUCTION', version: 1 });
    expect((await take(order.id)).receipts).toHaveLength(1);
    expect((await request(app).post(endpoint(order)).set(authHeaders).send(payload)).status).toBe(200);
    expect((await request(app).post(endpoint(order)).set(authHeaders).send(input(order, 'START_ASSEMBLY'))).status).toBe(409);
    expect(notifications).toHaveLength(start + 2);
  });
  it('agrega pedido misto e só muda para OVEN após todas as montagens', async () => {
    let order = await fresh(2);
    for (const index of [0, 1]) {
      order = (await execute(order.id, order.items[index].id, input(order, 'START_ASSEMBLY', index))).order;
      expect(order.status).toBe('IN_PRODUCTION');
      order = (await execute(order.id, order.items[index].id, input(order, 'SEND_TO_OVEN', index))).order;
      expect(order.status).toBe(index === 0 ? 'IN_PRODUCTION' : 'OVEN');
    }
    expect((await take(order.id)).orderHistory.map(event => event.toStatus)).toEqual(['WAITING_PRODUCTION', 'IN_PRODUCTION', 'OVEN']);
  });
  it('comandos simultâneos em pizzas diferentes mantêm agregação e versões corretas', async () => {
    const order = await fresh(2);
    await Promise.all([0, 1].map(index => execute(order.id, order.items[index].id, input(order, 'START_ASSEMBLY', index))));
    const saved = await take(order.id); expect(saved.order?.status).toBe('IN_PRODUCTION'); expect(saved.order?.version).toBe(2); expect(saved.pizzas.map(pizza => pizza.version)).toEqual([1, 1]);
  });
  it.each(['PizzaProductionHistory', 'OrderStatusHistory', 'PizzaCommandReceipt', 'Order'])('falha em %s causa rollback integral e permite reenvio', async table => {
    const order = await fresh(), before = await take(order.id), payload = input(order, 'START_ASSEMBLY'), eventCount = notifications.length;
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_command BEFORE ${table === 'Order' ? 'UPDATE' : 'INSERT'} ON "${table}" BEGIN SELECT RAISE(ABORT, 'command failed'); END`);
    try {
      expect((await request(app).post(endpoint(order)).set(authHeaders).send(payload)).status).toBe(500);
      expect(await take(order.id)).toEqual(before); expect(notifications).toHaveLength(eventCount);
    }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER fail_command'); }
    expect((await execute(order.id, order.items[0].id, payload)).replayed).toBe(false);
  });
});
