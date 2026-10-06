import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { Server } from 'socket.io';
import { io, type Socket } from 'socket.io-client';
import type { KitchenNotification, SupervisorRecoveryInput } from '@guigs/shared';
import { createApp } from './app.js';
import { OrderService } from './orders.js';
import { StructuredOrderService } from './structured-orders.js';
import { PizzaCommandService } from './pizza-commands.js';
import { hashOperatorPin, OperatorSessionService } from './operator-sessions.js';
import { SupervisorRecoveryService } from './supervisor-recovery.js';
import { presencePolicy } from './presence-policy.js';

const name = `test-presence-recovery-${randomUUID()}.db`, path = resolve(process.cwd(), 'prisma', name);
const prisma = new PrismaClient({ datasources: { db: { url: `file:./${name}` } } });
const creation = new StructuredOrderService(prisma, undefined, 1), commands = new PizzaCommandService(prisma);
const operators: string[] = [], notifications: KitchenNotification[] = [], changes: string[] = [];
let sessions: OperatorSessionService, recovery: SupervisorRecoveryService, app: ReturnType<typeof createApp>, sockets: Server | undefined;
async function login(index = 0, online = true) {
  const deviceKey = randomUUID(), result = await sessions.signIn({ pin: String(7100 + index), workstationDeviceKey: deviceKey }, randomUUID());
  const auth = { token: result.token, deviceKey }, headers = { Authorization: `Bearer ${result.token}`, 'X-Workstation-Device-Key': deviceKey };
  if (index === 3) await sessions.setAvailability(auth, false);
  if (online) await sessions.heartbeat(auth);
  return { auth, headers, session: await sessions.current(auth) };
}
async function fresh(count = 1) {
  return (await creation.create({ clientRequestId: randomUUID(), customerName: 'Presença fixture', customerPhone: '', fulfillmentType: 'PICKUP', channel: 'COUNTER', notes: '', extras: [],
    pizzas: Array.from({ length: count }, () => ({ size: 'GRANDE', composition: 'WHOLE', firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: null })) })).order;
}
async function payload(pizzaId: string, command: SupervisorRecoveryInput['command'], targetSessionId?: string): Promise<SupervisorRecoveryInput> {
  const pizza = await prisma.pizzaItem.findUniqueOrThrow({ where: { id: pizzaId } });
  return { command, expectedState: pizza.state as SupervisorRecoveryInput['expectedState'], expectedVersion: pizza.version, clientCommandId: randomUUID(), reason: 'Tablet indisponível; situação física conferida', ...(targetSessionId ? { targetSessionId } : {}) };
}
const endpoint = (orderId: string, pizzaId: string) => `/orders/v2/${orderId}/pizzas/${pizzaId}/recovery`;
async function setup() { const owner = await login(), order = await fresh(), target = await login(1), supervisor = await login(3); return { owner, order, pizzaId: order.items[0].id, target, supervisor }; }
beforeAll(async () => {
  writeFileSync(path, ''); const directory = resolve(process.cwd(), 'prisma/migrations');
  for (const name of readdirSync(directory).filter(name => /^\d/.test(name)).sort()) for (const sql of readFileSync(resolve(directory, name, 'migration.sql'), 'utf8').split(';').map(part => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(sql);
  for (let index = 0; index < 4; index++) operators.push((await prisma.operator.create({ data: { name: ['João presença', 'Carlos presença', 'Pedro presença', 'Supervisor presença'][index], pinHash: await hashOperatorPin(String(7100 + index)), role: index === 3 ? 'SUPERVISOR' : 'ASSEMBLER' } })).id);
});
beforeEach(async () => {
  await prisma.pizzaItem.updateMany({ data: { state: 'FINISHED' } }); // Isolate each scenario's pending workload in the disposable database.
  await prisma.operatorSession.updateMany({ data: { active: false, endedAt: new Date(), presenceStatus: 'OFFLINE' } });
  sessions = new OperatorSessionService(prisma, undefined, id => { changes.push(id); sockets?.emit('operators.changed', { sessionId: id }); });
  recovery = new SupervisorRecoveryService(prisma, sessions);
  app = createApp(new OrderService(prisma), () => {}, 'http://localhost:5173', creation, commands, event => { notifications.push(event); sockets?.emit(event.type, event.payload); }, sessions, recovery);
  changes.length = 0; notifications.length = 0;
});
afterAll(async () => { await prisma.$disconnect(); for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true }); });

describe('presença e recuperação supervisionada', () => {
  it('login não confirma presença; heartbeat autenticado usa servidor e não gera evento por pulso', async () => {
    const actor = await login(0, false); expect(actor.session.presenceStatus).toBe('OFFLINE'); expect(actor.session.lastSeenAt).toBeNull();
    expect((await fresh()).items[0]).toMatchObject({ assignment: null });
    expect((await request(app).post('/operators/session/heartbeat').send({})).status).toBe(401);
    expect((await request(app).post('/operators/session/heartbeat').set(actor.headers).send({ lastSeenAt: new Date().toISOString() })).status).toBe(400);
    const before = new Date(); const response = await request(app).post('/operators/session/heartbeat').set(actor.headers).send({});
    expect(response.status).toBe(200); expect(response.body.presenceStatus).toBe('ONLINE'); expect(new Date(response.body.lastSeenAt).getTime()).toBeGreaterThanOrEqual(before.getTime());
    const eventCount = await prisma.operatorSessionEvent.count({ where: { sessionId: actor.session.sessionId } }), emitted = changes.length;
    await sessions.heartbeat(actor.auth); expect(await prisma.operatorSessionEvent.count({ where: { sessionId: actor.session.sessionId } })).toBe(eventCount); expect(changes.length).toBe(emitted);
    expect((await fresh()).items[0]).toMatchObject({ assignment: { operatorId: actor.session.operatorId } });
  });
  it.each(['STALE', 'OFFLINE'] as const)('timeout %s exclui sem liberar responsabilidade, inclusive antes do sweep', async status => {
    const actor = await login(), order = await fresh();
    await prisma.operatorSession.update({ where: { id: actor.session.sessionId }, data: { lastSeenAt: new Date(Date.now() - (status === 'STALE' ? 60001 : 120001)) } });
    expect((await sessions.current(actor.auth)).presenceStatus).toBe(status);
    expect((await fresh()).items[0]).toMatchObject({ assignment: null });
    await sessions.sweepPresence(); expect((await prisma.operatorSession.findUniqueOrThrow({ where: { id: actor.session.sessionId } })).presenceStatus).toBe(status);
    expect((await creation.get(order.id))?.items[0]).toMatchObject({ assignment: { operatorId: actor.session.operatorId } });
  });
  it('reconexão somente volta à elegibilidade com sessão válida e heartbeat; GET não conta presença', async () => {
    const actor = await login(); await prisma.operatorSession.update({ where: { id: actor.session.sessionId }, data: { lastSeenAt: new Date(Date.now() - 120001), presenceStatus: 'OFFLINE' } });
    await sessions.current(actor.auth); expect((await fresh()).items[0]).toMatchObject({ assignment: null });
    await sessions.heartbeat(actor.auth); expect((await fresh()).items[0]).toMatchObject({ assignment: { operatorId: actor.session.operatorId } });
    await prisma.operatorSession.update({ where: { id: actor.session.sessionId }, data: { active: false } });
    expect((await request(app).post('/operators/session/heartbeat').set(actor.headers).send({})).status).toBe(401);
  });
  it('reinício da API deriva timeout persistido e audita intervalo ausente ao reconectar', async () => {
    const actor = await login(); const lastSeenAt = new Date(Date.now() - 125000);
    await prisma.operatorSession.update({ where: { id: actor.session.sessionId }, data: { lastSeenAt } });
    const restarted = new OperatorSessionService(prisma); expect((await restarted.current(actor.auth)).presenceStatus).toBe('OFFLINE');
    await restarted.heartbeat(actor.auth);
    const events = await prisma.operatorSessionEvent.findMany({ where: { sessionId: actor.session.sessionId }, orderBy: { changedAt: 'asc' } });
    expect(events.some(event => event.presenceStatus === 'STALE' && event.changedAt.getTime() === lastSeenAt.getTime() + 60000)).toBe(true);
    expect(events.some(event => event.presenceStatus === 'OFFLINE' && event.changedAt.getTime() === lastSeenAt.getTime() + 120000)).toBe(true);
    expect((await restarted.current(actor.auth)).presenceStatus).toBe('ONLINE');
  });
  it('três operadores: Pedro offline mantém antigas, não recebe novas e retorna após heartbeat', async () => {
    const actors = []; for (let index = 0; index < 3; index++) actors.push(await login(index));
    const first = await fresh(6); expect(first.items.filter(item => item.kind === 'PIZZA' && item.assignment?.operatorId === operators[2])).toHaveLength(2);
    await prisma.operatorSession.update({ where: { id: actors[2].session.sessionId }, data: { lastSeenAt: new Date(Date.now() - 120001) } });
    await sessions.sweepPresence(); const second = await fresh(6);
    expect(second.items.some(item => item.kind === 'PIZZA' && item.assignment?.operatorId === operators[2])).toBe(false);
    expect((await creation.get(first.id))?.items.filter(item => item.kind === 'PIZZA' && item.assignment?.operatorId === operators[2])).toHaveLength(2);
    await sessions.heartbeat(actors[2].auth); expect((await fresh()).items[0]).toMatchObject({ assignment: { operatorId: operators[2] } });
  });
  it('encerrar turno sem pendências revoga sessão, audita fim e emite presença', async () => {
    const actor = await login(); expect((await request(app).delete('/operators/session').set(actor.headers)).status).toBe(204);
    const stored = await prisma.operatorSession.findUniqueOrThrow({ where: { id: actor.session.sessionId } }); expect(stored).toMatchObject({ active: false, presenceStatus: 'OFFLINE', endedAt: expect.any(Date) });
    expect(await prisma.operatorSessionEvent.count({ where: { sessionId: stored.id, eventType: 'SHIFT_ENDED' } })).toBe(1); expect(changes.at(-1)).toBe(stored.id);
    expect((await request(app).post('/operators/session/heartbeat').set(actor.headers).send({})).status).toBe(401);
  });
  it('encerramento com pendências bloqueia sem revogar ou abandonar', async () => {
    const actor = await login(), order = await fresh(); const before = changes.length;
    expect((await request(app).delete('/operators/session').set(actor.headers)).status).toBe(409); expect(changes.length).toBe(before);
    expect((await sessions.current(actor.auth)).presenceStatus).toBe('ONLINE'); expect((await creation.get(order.id))?.items[0]).toMatchObject({ assignment: { operatorId: actor.session.operatorId } });
  });
  it('audita períodos de recebimento e não altera assignment', async () => {
    const actor = await login(); await sessions.setAvailability(actor.auth, false); await sessions.setAvailability(actor.auth, false); await sessions.setAvailability(actor.auth, true);
    expect((await prisma.operatorSessionEvent.findMany({ where: { sessionId: actor.session.sessionId, eventType: 'AVAILABILITY_CHANGED' }, orderBy: { changedAt: 'asc' } })).map(event => event.available)).toEqual([false, true]);
  });
  it('desativar terminal recente registra offline no presente, sem inventar timeout futuro', async () => {
    const actor = await login(); const before = new Date();
    await prisma.workstation.update({ where: { id: actor.session.workstationId }, data: { active: false } });
    await sessions.sweepPresence();
    const events = await prisma.operatorSessionEvent.findMany({ where: { sessionId: actor.session.sessionId, eventType: 'PRESENCE_CHANGED' }, orderBy: { changedAt: 'asc' } });
    expect(events.map(event => event.presenceStatus)).toEqual(['ONLINE', 'OFFLINE']);
    expect(events.at(-1)!.changedAt.getTime()).toBeGreaterThanOrEqual(before.getTime()); expect(events.at(-1)!.changedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
  it('lastSeenAt futuro não confere elegibilidade nem presença', async () => {
    const actor = await login(); await prisma.operatorSession.update({ where: { id: actor.session.sessionId }, data: { lastSeenAt: new Date(Date.now() + 60000) } });
    expect((await sessions.current(actor.auth)).presenceStatus).toBe('OFFLINE'); expect((await fresh()).items[0]).toMatchObject({ assignment: null });
    await sessions.heartbeat(actor.auth); expect((await sessions.current(actor.auth)).presenceStatus).toBe('ONLINE');
    expect((await prisma.operatorSessionEvent.findMany({ where: { sessionId: actor.session.sessionId } })).every(event => event.changedAt.getTime() <= Date.now())).toBe(true);
  });
  it('montador comum e supervisor sem presença não recuperam nem listam destinos', async () => {
    const { owner, order, pizzaId, supervisor } = await setup(), input = await payload(pizzaId, 'SUPERVISOR_RELEASE');
    expect((await request(app).post(endpoint(order.id, pizzaId)).set(owner.headers).send(input)).status).toBe(403);
    expect((await request(app).get('/operators/recovery-targets').set(owner.headers)).status).toBe(403);
    await prisma.operatorSession.update({ where: { id: supervisor.session.sessionId }, data: { lastSeenAt: new Date(Date.now() - 60001) } });
    expect((await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send(input)).status).toBe(403);
  });
  it.each(['', ' ', 'ab'])('motivo obrigatório rejeita %j sem alterar dados', async reason => {
    const { order, pizzaId, supervisor } = await setup(), before = await prisma.pizzaItem.findUnique({ where: { id: pizzaId } });
    expect((await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send({ ...await payload(pizzaId, 'SUPERVISOR_RELEASE'), reason })).status).toBe(400);
    expect(await prisma.pizzaItem.findUnique({ where: { id: pizzaId } })).toEqual(before);
  });
  it('release supervisionado preserva história, autoria anterior e registra supervisor/origem/motivo', async () => {
    const { owner, order, pizzaId, supervisor } = await setup(), before = await prisma.pizzaProductionHistory.findMany({ where: { pizzaId } });
    const input = await payload(pizzaId, 'SUPERVISOR_RELEASE'); const response = await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send(input);
    expect(response.status).toBe(200); expect(response.body.order.items[0]).toMatchObject({ assignment: null, releasedAt: expect.any(String) });
    const history = await prisma.pizzaProductionHistory.findUniqueOrThrow({ where: { commandId: input.clientCommandId } });
    expect(history).toMatchObject({ eventType: 'SUPERVISOR_RELEASED', actorType: 'ADMIN', operatorId: supervisor.session.operatorId, workstationId: supervisor.session.workstationId, reason: input.reason,
      metadata: { previousOperatorId: owner.session.operatorId, newOperatorId: null } });
    for (const event of before) expect(await prisma.pizzaProductionHistory.findUnique({ where: { id: event.id } })).toEqual(event);
    expect(notifications.map(event => event.type)).toEqual(['kitchen.pizza.updated', 'kitchen.order.updated']);
  });
  it('reassign atribui a Carlos em sessão online, conserva estado e agrega na mesma transação', async () => {
    const { owner, order, pizzaId, target, supervisor } = await setup(), input = await payload(pizzaId, 'SUPERVISOR_REASSIGN', target.session.sessionId);
    const response = await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send(input); expect(response.status).toBe(200);
    expect(response.body.order).toMatchObject({ status: 'WAITING_PRODUCTION', version: order.version + 1 });
    expect(response.body.order.items[0]).toMatchObject({ assignment: { operatorId: target.session.operatorId, sessionId: target.session.sessionId, workstationId: target.session.workstationId }, production: { state: 'WAITING_ASSEMBLY', version: 2 } });
    expect((await prisma.pizzaProductionHistory.findUniqueOrThrow({ where: { commandId: input.clientCommandId } })).metadata).toMatchObject({ previousOperatorId: owner.session.operatorId, newOperatorId: target.session.operatorId });
  });
  it.each(['stale', 'expired', 'inactiveOperator', 'inactiveWorkstation', 'unavailable', 'ended'] as const)('destino %s rejeitado', async reason => {
    const { order, pizzaId, target, supervisor } = await setup();
    if (reason === 'stale') await prisma.operatorSession.update({ where: { id: target.session.sessionId }, data: { lastSeenAt: new Date(Date.now() - 60001) } });
    if (reason === 'expired') await prisma.operatorSession.update({ where: { id: target.session.sessionId }, data: { expiresAt: new Date(0) } });
    if (reason === 'ended') await prisma.operatorSession.update({ where: { id: target.session.sessionId }, data: { active: false, endedAt: new Date() } });
    if (reason === 'inactiveOperator') await prisma.operator.update({ where: { id: target.session.operatorId }, data: { active: false } });
    if (reason === 'inactiveWorkstation') await prisma.workstation.update({ where: { id: target.session.workstationId }, data: { active: false } });
    if (reason === 'unavailable') await sessions.setAvailability(target.auth, false);
    try { expect((await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send(await payload(pizzaId, 'SUPERVISOR_REASSIGN', target.session.sessionId))).status).toBe(409); }
    finally { await prisma.operator.updateMany({ data: { active: true } }); await prisma.workstation.updateMany({ data: { active: true } }); }
  });
  it('montagem ativa bloqueia release/reassign; pausa explícita auditada permite recuperação', async () => {
    const { owner, order, pizzaId, target, supervisor } = await setup();
    await commands.execute(order.id, pizzaId, { command: 'START_ASSEMBLY', expectedState: 'WAITING_ASSEMBLY', expectedVersion: 1, clientCommandId: randomUUID() }, owner.auth);
    for (const command of ['SUPERVISOR_RELEASE', 'SUPERVISOR_REASSIGN'] as const) expect((await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send(await payload(pizzaId, command, command === 'SUPERVISOR_REASSIGN' ? target.session.sessionId : undefined))).status).toBe(409);
    expect((await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send(await payload(pizzaId, 'SUPERVISOR_PAUSE'))).status).toBe(200);
    const response = await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send(await payload(pizzaId, 'SUPERVISOR_REASSIGN', target.session.sessionId)); expect(response.status).toBe(200);
    expect(response.body.order.status).toBe('IN_PRODUCTION'); expect(response.body.order.items[0].production.state).toBe('ASSEMBLY_PAUSED');
    expect((await prisma.pizzaItem.findUniqueOrThrow({ where: { id: pizzaId } })).pausedAt).toBeInstanceOf(Date);
    expect(await prisma.pizzaProductionHistory.count({ where: { pizzaId, eventType: 'SUPERVISOR_PAUSED' } })).toBe(1);
  });
  it('idempotência não duplica histórico; mesmo ID e outro motivo conflita', async () => {
    const { order, pizzaId, target, supervisor } = await setup(), input = await payload(pizzaId, 'SUPERVISOR_REASSIGN', target.session.sessionId);
    const first = await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send(input), before = notifications.length;
    const second = await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send(input); expect(second.status).toBe(200); expect(second.body.replayed).toBe(true); expect(second.body.order).toEqual(first.body.order);
    expect(notifications.length).toBe(before); expect(await prisma.pizzaProductionHistory.count({ where: { commandId: input.clientCommandId } })).toBe(1);
    expect((await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send({ ...input, reason: 'Outro motivo' })).status).toBe(409);
  });
  it('duas recuperações concorrentes têm apenas um vencedor e um conflito', async () => {
    const { order, pizzaId, target, supervisor } = await setup(); const a = await payload(pizzaId, 'SUPERVISOR_RELEASE'), b = await payload(pizzaId, 'SUPERVISOR_REASSIGN', target.session.sessionId);
    const responses = await Promise.all([a, b].map(input => request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send(input))); expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  });
  it('mesmo comando concorrente tem um commit e um replay', async () => {
    const { order, pizzaId, supervisor } = await setup(), input = await payload(pizzaId, 'SUPERVISOR_RELEASE');
    const responses = await Promise.all([1, 2].map(() => request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send(input))); expect(responses.map(response => response.status)).toEqual([200, 200]); expect(responses.filter(response => response.body.replayed)).toHaveLength(1);
  });
  it('rollback de histórico preserva reserva, pedido, receipt e não publica', async () => {
    const { order, pizzaId, supervisor } = await setup(), before = await prisma.pizzaItem.findUnique({ where: { id: pizzaId } }), input = await payload(pizzaId, 'SUPERVISOR_RELEASE');
    await prisma.$executeRawUnsafe("CREATE TRIGGER fail_recovery BEFORE INSERT ON PizzaProductionHistory WHEN NEW.eventType = 'SUPERVISOR_RELEASED' BEGIN SELECT RAISE(ABORT, 'recovery failed'); END");
    try {
      expect((await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send(input)).status).toBe(500);
      expect(await prisma.pizzaItem.findUnique({ where: { id: pizzaId } })).toEqual(before); expect((await creation.get(order.id))?.version).toBe(order.version);
      expect(await prisma.pizzaCommandReceipt.findUnique({ where: { clientCommandId: input.clientCommandId } })).toBeNull(); expect(notifications).toEqual([]);
    } finally { await prisma.$executeRawUnsafe('DROP TRIGGER fail_recovery'); }
  });
  it('versão desatualizada, pizza/pedido errado e reassign para o mesmo operador rejeitados', async () => {
    const { order, pizzaId, owner, supervisor } = await setup(), input = await payload(pizzaId, 'SUPERVISOR_RELEASE');
    expect((await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send({ ...input, expectedVersion: 0 })).status).toBe(409);
    expect((await request(app).post(endpoint('cmissingorder0000000000000', pizzaId)).set(supervisor.headers).send(input)).status).toBe(404);
    expect((await request(app).post(endpoint(order.id, 'cmissingpizza0000000000000')).set(supervisor.headers).send(input)).status).toBe(404);
    expect((await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send(await payload(pizzaId, 'SUPERVISOR_REASSIGN', owner.session.sessionId))).status).toBe(409);
  });
  it('dois sockets recebem presença, recuperação e fim do turno somente após commit', async () => {
    const server = createServer(app); sockets = new Server(server); await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const clients: Socket[] = [io(`http://127.0.0.1:${(server.address() as AddressInfo).port}`), io(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)];
    const next = (socket: Socket, event: string) => new Promise<Record<string, unknown>>((done, reject) => { const timer = setTimeout(() => reject(new Error(`Evento ${event} ausente`)), 3000); socket.once(event, value => { clearTimeout(timer); done(value); }); });
    try {
      await Promise.all(clients.map(client => next(client, 'connect'))); const { order, pizzaId, supervisor } = await setup();
      const heartbeats = clients.map(client => next(client, 'operators.changed')); const actor = await login(2, false); await Promise.all(heartbeats);
      const online = clients.map(client => next(client, 'operators.changed')); await sessions.heartbeat(actor.auth); expect((await Promise.all(online)).map(value => value.sessionId)).toEqual([actor.session.sessionId, actor.session.sessionId]);
      const updates = clients.map(client => next(client, 'kitchen.pizza.updated'));
      await request(app).post(endpoint(order.id, pizzaId)).set(supervisor.headers).send(await payload(pizzaId, 'SUPERVISOR_RELEASE')); await Promise.all(updates);
      expect((await prisma.pizzaItem.findUniqueOrThrow({ where: { id: pizzaId } })).assignedOperatorId).toBeNull();
      await sessions.setAvailability(actor.auth, false);
      const endings = clients.map(client => next(client, 'operators.changed')); await sessions.end(actor.auth); await Promise.all(endings);
      expect((await prisma.operatorSession.findUniqueOrThrow({ where: { id: actor.session.sessionId } })).active).toBe(false);
    } finally { clients.forEach(client => client.disconnect()); await new Promise<void>(done => sockets!.close(() => done())); sockets = undefined; }
  });
  it('limites configuráveis inválidos impedem startup', () => {
    const previous = process.env.OPERATOR_STALE_MS; process.env.OPERATOR_STALE_MS = '1000';
    try { expect(() => presencePolicy()).toThrow('Intervalos'); } finally { if (previous === undefined) delete process.env.OPERATOR_STALE_MS; else process.env.OPERATOR_STALE_MS = previous; }
  });
});
