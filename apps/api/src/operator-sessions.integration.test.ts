import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { createApp } from './app.js';
import { OrderService } from './orders.js';
import { StructuredOrderService } from './structured-orders.js';
import { PizzaCommandService } from './pizza-commands.js';
import { configureOperator, hashOperatorPin, OperatorSessionService, verifyOperatorPin, type SessionCredentials } from './operator-sessions.js';

const name = `test-operators-${randomUUID()}.db`, path = resolve(process.cwd(), 'prisma', name);
const prisma = new PrismaClient({ datasources: { db: { url: `file:./${name}` } } });
let sessions: OperatorSessionService;
let app: ReturnType<typeof createApp>;
const creation = new StructuredOrderService(prisma), commands = new PizzaCommandService(prisma);
const headers = (auth: SessionCredentials) => ({ Authorization: `Bearer ${auth.token}`, 'X-Workstation-Device-Key': auth.deviceKey });
async function login(pin = '4826', deviceKey = randomUUID()) {
  const response = await request(app).post('/operators/session').send({ pin, workstationDeviceKey: deviceKey });
  expect(response.status).toBe(201); return { auth: { token: response.body.token, deviceKey }, session: response.body.session };
}
async function fresh() { return (await creation.create({ clientRequestId: randomUUID(), customerName: 'Operação fixture', customerPhone: '', notes: '', extras: [], fulfillmentType: 'PICKUP', channel: 'COUNTER', pizzas: [{ size: 'GRANDE', composition: 'WHOLE', firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: null }] })).order; }
beforeAll(async () => {
  writeFileSync(path, ''); const directory = resolve(process.cwd(), 'prisma/migrations');
  for (const name of readdirSync(directory).filter(name => /^\d/.test(name)).sort()) for (const sql of readFileSync(resolve(directory, name, 'migration.sql'), 'utf8').split(';').map(part => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(sql);
  await configureOperator(prisma, { name: 'João fixture', pin: '4826' });
  await configureOperator(prisma, { name: 'Carlos fixture', pin: '5937' });
  await configureOperator(prisma, { name: 'Inativo fixture', pin: '6048', active: false });
});
beforeEach(() => {
  sessions = new OperatorSessionService(prisma);
  app = createApp(new OrderService(prisma), () => {}, 'http://localhost:5173', creation, commands, () => {}, sessions);
});
afterAll(async () => { await prisma.$disconnect(); for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true }); });

describe('identidade operacional', () => {
  it('hash salted scrypt nunca armazena PIN e verifica somente a combinação correta', async () => {
    const a = await hashOperatorPin('4826'), b = await hashOperatorPin('4826');
    expect(a).not.toBe(b); expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyOperatorPin('4826', a)).toBe(true); expect(await verifyOperatorPin('4827', a)).toBe(false);
    expect(await verifyOperatorPin('4826', '4826')).toBe(false);
    const stored = await prisma.operator.findUniqueOrThrow({ where: { name: 'João fixture' } }); expect(stored.pinHash).not.toBe('4826');
  });
  it('PIN válido registra terminal e retorna somente dados mínimos sem hashes', async () => {
    const { auth, session } = await login(); expect(session.operatorName).toBe('João fixture');
    expect(Object.keys(session).sort()).toEqual(['expiresAt', 'operatorId', 'operatorName', 'sessionId', 'startedAt', 'workstationId', 'workstationName'].sort());
    const stored = await prisma.operatorSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(stored.tokenHash).not.toBe(auth.token); expect(stored.active).toBe(true);
    expect((await prisma.workstation.findUniqueOrThrow({ where: { id: session.workstationId } })).deviceKey).toBe(auth.deviceKey);
  });
  it.each(['9999', '6048'])('PIN inválido/inativo %s produz mensagem genérica sem cadastrar terminal', async pin => {
    const deviceKey = randomUUID(); const response = await request(app).post('/operators/session').send({ pin, workstationDeviceKey: deviceKey });
    expect(response.status).toBe(401); expect(response.body).toEqual({ error: 'PIN inválido ou terminal indisponível.' });
    expect(await prisma.workstation.findUnique({ where: { deviceKey } })).toBeNull();
  });
  it('terminal existente mantém ID e nome; novo login encerra sessão anterior', async () => {
    const first = await login(); await prisma.workstation.update({ where: { id: first.session.workstationId }, data: { name: 'Tablet Cozinha 02' } });
    const second = await login('5937', first.auth.deviceKey);
    expect(second.session.workstationId).toBe(first.session.workstationId); expect(second.session.workstationName).toBe('Tablet Cozinha 02');
    expect(second.session.operatorName).toBe('Carlos fixture');
    const previous = await prisma.operatorSession.findUniqueOrThrow({ where: { id: first.session.sessionId } }); expect(previous.active).toBe(false); expect(previous.endedAt).not.toBeNull();
    expect((await request(app).get('/operators/session').set(headers(first.auth))).status).toBe(401);
  });
  it('refresh valida a mesma sessão no backend sem devolver token/hash', async () => {
    const { auth, session } = await login(); const response = await request(app).get('/operators/session').set(headers(auth));
    expect(response.status).toBe(200); expect(response.body).toEqual(session); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.token).toBeUndefined(); expect(response.body.pinHash).toBeUndefined();
  });
  it('sessão inválida/expirada e token de outro terminal são rejeitados', async () => {
    const { auth, session } = await login();
    for (const invalid of [{ ...auth, token: '0'.repeat(64) }, { ...auth, deviceKey: randomUUID() }]) expect((await request(app).get('/operators/session').set(headers(invalid))).status).toBe(401);
    await prisma.operatorSession.update({ where: { id: session.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await request(app).get('/operators/session').set(headers(auth))).status).toBe(401);
    const order = await fresh();
    expect((await request(app).post(`/orders/v2/${order.id}/pizzas/${order.items[0].id}/commands`).set(headers(auth)).send({ command: 'START_ASSEMBLY', expectedState: 'WAITING_ASSEMBLY', expectedVersion: 0, clientCommandId: randomUUID() })).status).toBe(401);
    expect(await prisma.pizzaProductionHistory.count({ where: { pizzaId: order.items[0].id } })).toBe(1);
  });
  it('desativação de operador invalida credenciais já emitidas', async () => {
    const { auth, session } = await login();
    await prisma.operator.update({ where: { id: session.operatorId }, data: { active: false } });
    try { expect((await request(app).get('/operators/session').set(headers(auth))).status).toBe(401); }
    finally { await prisma.operator.update({ where: { id: session.operatorId }, data: { active: true } }); }
  });
  it('terminal inativo não admite login', async () => {
    const { auth, session } = await login(); await prisma.workstation.update({ where: { id: session.workstationId }, data: { active: false } });
    expect((await request(app).post('/operators/session').send({ pin: '4826', workstationDeviceKey: auth.deviceKey })).status).toBe(401);
    expect((await request(app).get('/operators/session').set(headers(auth))).status).toBe(401);
  });
  it('encerrar sessão revoga token e preserva timestamps da sessão', async () => {
    const { auth, session } = await login(); expect((await request(app).delete('/operators/session').set(headers(auth))).status).toBe(204);
    const stored = await prisma.operatorSession.findUniqueOrThrow({ where: { id: session.sessionId } }); expect(stored.active).toBe(false); expect(stored.startedAt.toISOString()).toBe(session.startedAt); expect(stored.endedAt).not.toBeNull();
    expect((await request(app).get('/operators/session').set(headers(auth))).status).toBe(401);
  });
  it('ação sem sessão ou com identidade forjada é rejeitada sem escrita', async () => {
    const order = await fresh(), path = `/orders/v2/${order.id}/pizzas/${order.items[0].id}/commands`, payload = { command: 'START_ASSEMBLY', expectedState: 'WAITING_ASSEMBLY', expectedVersion: 0, clientCommandId: randomUUID() };
    expect((await request(app).post(path).send(payload)).status).toBe(401);
    expect(await prisma.pizzaProductionHistory.count({ where: { pizzaId: order.items[0].id } })).toBe(1);
    const { auth } = await login(); expect((await request(app).post(path).set(headers(auth)).send({ ...payload, operatorId: 'forjado' })).status).toBe(400);
    expect(await prisma.pizzaCommandReceipt.count({ where: { orderId: order.id } })).toBe(0);
  });
  it('troca de operador registra futuras ações com nova sessão e preserva histórico anterior', async () => {
    const a = await login(), b = await login('5937'), order = await fresh(), pizzaId = order.items[0].id;
    const first = await commands.execute(order.id, pizzaId, { command: 'START_ASSEMBLY', expectedState: 'WAITING_ASSEMBLY', expectedVersion: 0, clientCommandId: randomUUID() }, a.auth);
    await commands.execute(order.id, pizzaId, { command: 'PAUSE_ASSEMBLY', expectedState: 'ASSEMBLING', expectedVersion: 1, clientCommandId: randomUUID() }, b.auth);
    await sessions.end(a.auth); const changed = await login('5937', a.auth.deviceKey);
    await commands.execute(order.id, pizzaId, { command: 'RESUME_ASSEMBLY', expectedState: 'ASSEMBLY_PAUSED', expectedVersion: 2, clientCommandId: randomUUID() }, changed.auth);
    const history = await prisma.pizzaProductionHistory.findMany({ where: { pizzaId }, orderBy: { itemVersion: 'asc' } });
    expect(history.map(event => event.actorType)).toEqual(['SYSTEM', 'OPERATOR', 'OPERATOR', 'OPERATOR']);
    expect(history[1]).toMatchObject({ operatorId: a.session.operatorId, actorId: a.session.operatorId, workstationId: a.session.workstationId, operatorSessionId: a.session.sessionId });
    expect(history[2]).toMatchObject({ operatorId: b.session.operatorId, workstationId: b.session.workstationId, operatorSessionId: b.session.sessionId });
    expect(history[3]).toMatchObject({ operatorId: changed.session.operatorId, workstationId: a.session.workstationId, operatorSessionId: changed.session.sessionId });
    expect(first.order.items[0].kind).toBe('PIZZA');
  });
  it('idempotência pertence à sessão original e não permite reatribuir comando', async () => {
    const a = await login(), b = await login('5937'), order = await fresh(), pizzaId = order.items[0].id;
    const payload = { command: 'START_ASSEMBLY' as const, expectedState: 'WAITING_ASSEMBLY' as const, expectedVersion: 0, clientCommandId: randomUUID() };
    await commands.execute(order.id, pizzaId, payload, a.auth); expect((await commands.execute(order.id, pizzaId, payload, a.auth)).replayed).toBe(true);
    await expect(commands.execute(order.id, pizzaId, payload, b.auth)).rejects.toThrow('Identificador de comando');
    expect(await prisma.pizzaProductionHistory.count({ where: { pizzaId } })).toBe(2);
  });
  it('proteção por terminal e por rede responde 429 sem enumerar operadores', async () => {
    const deviceKey = randomUUID();
    for (let i = 0; i < 5; i++) expect((await request(app).post('/operators/session').send({ pin: '9999', workstationDeviceKey: deviceKey })).status).toBe(401);
    const blocked = await request(app).post('/operators/session').send({ pin: '4826', workstationDeviceKey: deviceKey }); expect(blocked.status).toBe(429); expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    const network = new OperatorSessionService(prisma);
    for (let i = 0; i < 30; i++) await expect(network.signIn({ pin: '9999', workstationDeviceKey: randomUUID() }, 'mesma-rede')).rejects.toThrow('PIN inválido');
    await expect(network.signIn({ pin: '4826', workstationDeviceKey: randomUUID() }, 'mesma-rede')).rejects.toThrow('Muitas tentativas');
  });
  it('dois logins simultâneos no mesmo terminal mantêm uma única sessão ativa', async () => {
    const deviceKey = randomUUID(); await Promise.all(['4826', '5937'].map(pin => sessions.signIn({ pin, workstationDeviceKey: deviceKey }, randomUUID())));
    const terminal = await prisma.workstation.findUniqueOrThrow({ where: { deviceKey } });
    expect(await prisma.operatorSession.count({ where: { workstationId: terminal.id, active: true } })).toBe(1);
  });
  it('cadastro configurável rejeita PIN duplicado e rotação revoga sessões', async () => {
    await expect(configureOperator(prisma, { name: 'Outro fixture', pin: '4826' })).rejects.toThrow('PIN já utilizado');
    const current = await login(); await configureOperator(prisma, { name: 'João fixture', pin: '4826' });
    expect((await request(app).get('/operators/session').set(headers(current.auth))).status).toBe(401);
  });
});
