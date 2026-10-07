import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import type { Order, PizzaCommandInput, FinishingCommandInput, DispatchRouteView, RouteCommandInput } from '@guigs/shared';
import { StructuredOrderService } from './structured-orders.js';
import { PizzaCommandService } from './pizza-commands.js';
import { DispatchRouteService } from './routes.js';
import { FinishingService } from './finishing.js';
import { DispatchService } from './dispatch.js';
import { OperatorSessionService, hashOperatorPin } from './operator-sessions.js';
import { OrderService } from './orders.js';
import { createApp } from './app.js';
import { ProductionSettingsService } from './production-settings.js';

const name = `test-operational-flow-${randomUUID()}.db`, path = resolve(process.cwd(), 'prisma', name);
const prisma = new PrismaClient({ datasources: { db: { url: `file:./${name}` } } }), creation = new StructuredOrderService(prisma), commands = new PizzaCommandService(prisma), routes = new DispatchRouteService(prisma), finishing = new FinishingService(prisma), dispatch = new DispatchService(prisma), sessions = new OperatorSessionService(prisma);
const events: unknown[] = [], app = createApp(new OrderService(prisma), (_, order) => events.push(order), 'http://localhost:5173', creation, commands, event => events.push(event), sessions, undefined, finishing, dispatch, routes, event => events.push(event), new ProductionSettingsService(prisma), event => events.push(event));
const actors: { token: string; deviceKey: string }[] = [];
const productionSettings = new ProductionSettingsService(prisma);
beforeAll(async () => {
  writeFileSync(path, ''); const directory = resolve(process.cwd(), 'prisma/migrations');
  for (const name of readdirSync(directory).filter(name => /^\d/.test(name)).sort()) for (const sql of readFileSync(resolve(directory, name, 'migration.sql'), 'utf8').split(';').map(part => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(sql);
  for (let index = 0; index < 3; index++) { await prisma.operator.create({ data: { name: `Fluxo ${index}`, pinHash: await hashOperatorPin(String(9100 + index)) } }); const deviceKey = randomUUID(), session = await sessions.signIn({ pin: String(9100 + index), workstationDeviceKey: deviceKey }, randomUUID()); const actor = { token: session.token, deviceKey }; await sessions.heartbeat(actor); await sessions.setAvailability(actor, false); actors.push(actor); }
});
// Each scenario represents active stations, even when earlier tests run slowly.
beforeEach(async () => { for (const actor of actors) await sessions.heartbeat(actor); await prisma.productionStationSettings.update({ where: { stationKey: 'PRODUCTION' }, data: { autoOvenEntry: true } }); });
afterAll(async () => { await prisma.$disconnect(); for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true }); });
async function fresh(count = 1, extras = false, type: 'DELIVERY' | 'PICKUP' = 'DELIVERY') { return (await creation.create({ clientRequestId: randomUUID(), customerName: 'Fluxo físico', customerPhone: '', channel: 'COUNTER', fulfillmentType: type, notes: '', pizzas: Array.from({ length: count }, () => ({ size: 'GRANDE' as const, composition: 'WHOLE' as const, firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: null })), extras: extras ? [{ extraCatalogId: 'coca-cola-2l', quantity: 2, notes: null }] : [] })).order; }
async function current(order: Order) { return (await creation.get(order.id))!; }
async function pizza(order: Order, command: PizzaCommandInput['command'], index = 0) { const value = (await current(order)).items[index]; if (value.kind !== 'PIZZA') throw new Error('Pizza esperada'); return (await commands.execute(order.id, value.id, { command, expectedState: value.production.state, expectedVersion: value.production.version, clientCommandId: randomUUID() }, actors[0])).order; }
async function ready(count = 1, extras = false, type: 'DELIVERY' | 'PICKUP' = 'DELIVERY') { let order = await fresh(count, extras, type); for (let i = 0; i < count; i++) for (const action of ['START_ASSEMBLY', 'SEND_TO_OVEN', 'REMOVE_FROM_OVEN', 'FINISH_PIZZA'] as const) order = await pizza(order, action, i); return order; }
async function createRoute() { return (await routes.execute(null, { command: 'CREATE', clientCommandId: randomUUID() }, actors[1])).routes[0]; }
async function routeCommand(route: DispatchRouteView, command: RouteCommandInput['command'], extra: Partial<RouteCommandInput> = {}) { return (await routes.execute(route.id, { command, expectedVersion: route.version, clientCommandId: randomUUID(), ...extra }, actors[1])).routes.find(value => value.id === route.id)!; }
async function closed(order: Order) { let route = await createRoute(); for (const item of order.items) if (item.kind === 'PIZZA') route = await routeCommand(route, 'ADD', { pizzaId: item.id }); return routeCommand(route, 'CLOSE'); }
async function conference(order: Order, input: Omit<FinishingCommandInput, 'expectedVersion' | 'clientCommandId'>) { const value = await current(order); return (await finishing.execute(order.id, { ...input, expectedVersion: value.version, clientCommandId: randomUUID() } as FinishingCommandInput, actors[2], 'COUNTER')).order; }
async function prepare(order: Order) { order = await current(order); for (const item of order.items) if (item.kind === 'PIZZA') order = await conference(order, { command: 'CHECK_PIZZA', pizzaId: item.id, expectedItemVersion: item.production.version } as FinishingCommandInput); for (const item of order.items) if (item.kind === 'EXTRA') order = await conference(order, { command: 'CHECK_EXTRA', extraId: item.id, expectedItemVersion: item.version, checkedQuantity: item.quantity } as FinishingCommandInput); order = await conference(order, { command: 'CONFIRM_PACKAGING' }); return conference(order, { command: 'RELEASE_TO_DISPATCH' }); }

describe('produção física e rotas operacionais', () => {
  it('endpoint de preferência exige sessão, valida payload e publica apenas após commit', async () => {
    events.length = 0;
    const settings = await productionSettings.get(), input = { command: 'SET_AUTO_OVEN_ENTRY', autoOvenEntry: false, expectedVersion: settings.version, clientCommandId: randomUUID() }, headers = { Authorization: `Bearer ${actors[1].token}`, 'X-Workstation-Device-Key': actors[1].deviceKey };
    expect((await request(app).get('/kitchen/production/settings')).body).toEqual(settings);
    expect((await request(app).post('/kitchen/production/settings/commands').send(input)).status).toBe(401);
    expect((await request(app).post('/kitchen/production/settings/commands').set(headers).send({ ...input, autoOvenEntry: 'false' })).status).toBe(400);
    const response = await request(app).post('/kitchen/production/settings/commands').set(headers).send(input); expect(response.status).toBe(200);
    expect(await productionSettings.get()).toEqual(response.body.productionSettings); expect(events).toHaveLength(1);
    expect((await request(app).post('/kitchen/production/settings/commands').set(headers).send(input)).body.replayed).toBe(true); expect(events).toHaveLength(1);
    expect((await request(app).post('/kitchen/production/settings/commands').set(headers).send({ ...input, clientCommandId: randomUUID() })).status).toBe(409); expect(events).toHaveLength(1);
  });
  it('preferência compartilhada tem padrão automático e autoria persistente', async () => {
    const previous = await productionSettings.get(); expect(previous.autoOvenEntry).toBe(true);
    const result = await productionSettings.execute({ command: 'SET_AUTO_OVEN_ENTRY', autoOvenEntry: false, expectedVersion: previous.version, clientCommandId: randomUUID() }, actors[1]);
    expect(await new ProductionSettingsService(prisma).get()).toEqual(result.productionSettings);
    const actor = await sessions.validate(actors[1]);
    expect(await prisma.productionStationSettings.findUnique({ where: { stationKey: 'PRODUCTION' } })).toMatchObject({ updatedByOperatorId: actor.operatorId, updatedByWorkstationId: actor.workstationId, updatedBySessionId: actor.sessionId });
  });
  it('entrada manual conclui montagem sem iniciar timer e ENTER_OVEN inicia depois', async () => {
    const settings = await productionSettings.get(); await productionSettings.execute({ command: 'SET_AUTO_OVEN_ENTRY', autoOvenEntry: false, expectedVersion: settings.version, clientCommandId: randomUUID() }, actors[1]);
    let order = await pizza(await fresh(), 'START_ASSEMBLY'); order = await pizza(order, 'SEND_TO_OVEN');
    expect(order.items[0]).toMatchObject({ releasedAt: expect.any(String), production: { state: 'WAITING_OVEN', assemblyCompletedAt: expect.any(String), ovenStartedAt: null, ovenExpectedEndAt: null } });
    expect(order.status).toBe('OVEN');
    expect(await prisma.pizzaProductionHistory.findFirst({ where: { pizzaId: order.items[0].id, eventType: 'SEND_TO_OVEN' } })).toMatchObject({ metadata: { assemblyCompleted: true, ovenStarted: false, autoOvenEntry: false, productionSettingsVersion: settings.version + 1, capacityPolicy: 'INDICATOR' } });
    order = await pizza(order, 'ENTER_OVEN'); expect(order.items[0]).toMatchObject({ production: { state: 'IN_OVEN', ovenStartedAt: expect.any(String), ovenExpectedEndAt: expect.any(String) } });
  });
  it('preferência usa CAS, replay e conflito de conteúdo sem duplicar auditoria', async () => {
    const settings = await productionSettings.get(), input = { command: 'SET_AUTO_OVEN_ENTRY' as const, autoOvenEntry: false, expectedVersion: settings.version, clientCommandId: randomUUID() };
    const first = await productionSettings.execute(input, actors[1]); expect((await productionSettings.execute(input, actors[1])).replayed).toBe(true);
    await expect(productionSettings.execute({ ...input, autoOvenEntry: true }, actors[1])).rejects.toThrow('outro conteúdo');
    await expect(productionSettings.execute({ ...input, clientCommandId: randomUUID() }, actors[2])).rejects.toThrow('outro terminal');
    expect(await productionSettings.get()).toEqual(first.productionSettings);
    expect(await prisma.operatorSessionEvent.count({ where: { eventType: 'PRODUCTION_SETTINGS_CHANGED', metadata: { path: '$.clientCommandId', equals: input.clientCommandId } } })).toBe(1);
  });
  it('alterações simultâneas da preferência aceitam somente uma versão', async () => {
    const settings = await productionSettings.get(), input = { command: 'SET_AUTO_OVEN_ENTRY' as const, autoOvenEntry: false, expectedVersion: settings.version };
    const results = await Promise.allSettled(actors.slice(1).map(actor => productionSettings.execute({ ...input, clientCommandId: randomUUID() }, actor)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await productionSettings.get()).version).toBe(settings.version + 1);
  });
  it('falha no recibo desfaz preferência e auditoria', async () => {
    const previous = await productionSettings.get(), count = await prisma.operatorSessionEvent.count({ where: { eventType: 'PRODUCTION_SETTINGS_CHANGED' } });
    await prisma.$executeRawUnsafe(`CREATE TRIGGER settings_failure BEFORE INSERT ON ProductionSettingsReceipt BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END`);
    try { await expect(productionSettings.execute({ command: 'SET_AUTO_OVEN_ENTRY', autoOvenEntry: false, expectedVersion: previous.version, clientCommandId: randomUUID() }, actors[1])).rejects.toThrow(); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER settings_failure'); }
    expect(await productionSettings.get()).toEqual(previous); expect(await prisma.operatorSessionEvent.count({ where: { eventType: 'PRODUCTION_SETTINGS_CHANGED' } })).toBe(count);
  });
  it('criação normal usa fluxo 2; SEND_TO_OVEN inicia forno e encerra carga atômica com timestamps/autoria', async () => {
    let order = await fresh(); expect(order.operationalFlowVersion).toBe(2); order = await pizza(order, 'START_ASSEMBLY'); order = await pizza(order, 'SEND_TO_OVEN'); const item = order.items[0]; if (item.kind !== 'PIZZA') throw new Error('Pizza esperada'); expect(item.production).toMatchObject({ state: 'IN_OVEN', assemblyCompletedAt: expect.any(String), ovenStartedAt: item.production.assemblyCompletedAt, ovenExpectedEndAt: expect.any(String) }); expect(item.releasedAt).toBe(item.production.ovenStartedAt); expect(item.production.ovenOperator).toBeDefined(); expect(await prisma.pizzaProductionHistory.count({ where: { pizzaId: item.id, eventType: 'SEND_TO_OVEN' } })).toBe(1);
  });
  it('capacidade indicativa não bloqueia envio direto nem cria WAITING_OVEN', async () => { const old = process.env.OVEN_CAPACITY; try { process.env.OVEN_CAPACITY = '1'; let order = await fresh(3); for (let index = 0; index < 3; index++) { order = await pizza(order, 'START_ASSEMBLY', index); order = await pizza(order, 'SEND_TO_OVEN', index); } expect(order.items.every(item => item.kind === 'PIZZA' && item.production.state === 'IN_OVEN')).toBe(true); } finally { if (old === undefined) delete process.env.OVEN_CAPACITY; else process.env.OVEN_CAPACITY = old; } });
  it('saída não finaliza; finalização é individual e mantém pedido misto IN_PRODUCTION', async () => { let order = await fresh(3); order = await pizza(order, 'START_ASSEMBLY'); order = await pizza(order, 'SEND_TO_OVEN'); order = await pizza(order, 'REMOVE_FROM_OVEN'); expect(order.items[0]).toMatchObject({ production: { state: 'BAKED', finishedAt: null } }); order = await pizza(order, 'FINISH_PIZZA'); expect(order.status).toBe('IN_PRODUCTION'); expect(order.items[0]).toMatchObject({ production: { state: 'FINISHED', finishedAt: expect.any(String) }, counterCheckedAt: null }); });
  it('mesmo SEND_TO_OVEN simultâneo tem um histórico e replay; ID diferente perde com conflito', async () => { let order = await fresh(); order = await pizza(order, 'START_ASSEMBLY'); const item = order.items[0]; if (item.kind !== 'PIZZA') throw new Error('Pizza'); const input = { command: 'SEND_TO_OVEN' as const, expectedState: item.production.state, expectedVersion: item.production.version, clientCommandId: randomUUID() }; const values = await Promise.all([commands.execute(order.id, item.id, input, actors[0]), commands.execute(order.id, item.id, input, actors[0])]); expect(values.filter(value => value.replayed)).toHaveLength(1); expect(values[0].order.items[0]).toEqual(values[1].order.items[0]); await expect(commands.execute(order.id, item.id, { ...input, clientCommandId: randomUUID() }, actors[0])).rejects.toThrow(); });
  it.each(['REMOVE_FROM_OVEN', 'FINISH_PIZZA'] as const)('%s duplicado não altera timestamps ou histórico', async action => { let order = await fresh(); for (const step of ['START_ASSEMBLY', 'SEND_TO_OVEN'] as const) order = await pizza(order, step); if (action === 'FINISH_PIZZA') order = await pizza(order, 'REMOVE_FROM_OVEN'); const item = order.items[0]; if (item.kind !== 'PIZZA') throw new Error('Pizza'); const input = { command: action, expectedState: item.production.state, expectedVersion: item.production.version, clientCommandId: randomUUID() }; const result = await commands.execute(order.id, item.id, input, actors[0]); expect((await commands.execute(order.id, item.id, input, actors[0])).order).toEqual(result.order); expect(await prisma.pizzaProductionHistory.count({ where: { commandId: input.clientCommandId } })).toBe(1); });
  it('extras e embalagem são rejeitados na cozinha para fluxo 2', async () => { const order = await ready(1, true); const extra = order.items.find(item => item.kind === 'EXTRA')!; await expect(finishing.execute(order.id, { command: 'CHECK_EXTRA', extraId: extra.id, expectedVersion: order.version, expectedItemVersion: extra.kind === 'EXTRA' ? extra.version : 0, checkedQuantity: 1, clientCommandId: randomUUID() }, actors[0])).rejects.toThrow('Balcão'); });
  it('rota parcial fecha, aparece no GET, mas não despacha pedido incompleto; reabre e completa', async () => { let order = await fresh(3, true); for (const action of ['START_ASSEMBLY', 'SEND_TO_OVEN', 'REMOVE_FROM_OVEN', 'FINISH_PIZZA'] as const) order = await pizza(order, action); let route = await createRoute(); route = await routeCommand(route, 'ADD', { pizzaId: order.items[0].id }); route = await routeCommand(route, 'CLOSE'); expect((await request(app).get('/dispatch/routes')).body.some((value: DispatchRouteView) => value.id === route.id && value.status === 'CLOSED')).toBe(true); await expect(routeCommand(route, 'DISPATCH')).rejects.toThrow('incompleto'); route = await routeCommand(route, 'REOPEN'); for (let index = 1; index < 3; index++) { for (const action of ['START_ASSEMBLY', 'SEND_TO_OVEN', 'REMOVE_FROM_OVEN', 'FINISH_PIZZA'] as const) order = await pizza(order, action, index); route = await routeCommand(route, 'ADD', { pizzaId: order.items[index].id }); } route = await routeCommand(route, 'CLOSE'); order = await prepare(order); expect(order.status).toBe('WAITING_DISPATCH'); route = await routeCommand(route, 'DISPATCH'); expect(route.status).toBe('DISPATCHED'); expect((await current(order)).status).toBe('OUT_FOR_DELIVERY'); });
  it('mesma pizza não pode entrar em duas rotas mesmo concorrente', async () => { const order = await ready(), a = await createRoute(), b = await createRoute(); const results = await Promise.allSettled([routeCommand(a, 'ADD', { pizzaId: order.items[0].id }), routeCommand(b, 'ADD', { pizzaId: order.items[0].id })]); expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1); expect(await prisma.dispatchRouteItem.count({ where: { pizzaId: order.items[0].id } })).toBe(1); });
  it('não aceita pizza em produção, ID inexistente ou versão antiga', async () => { const order = await fresh(), route = await createRoute(); await expect(routeCommand(route, 'ADD', { pizzaId: order.items[0].id })).rejects.toThrow('finalizada'); await expect(routeCommand(route, 'ADD', { pizzaId: 'cmissingpizza00000000000000' })).rejects.toThrow(); await expect(routeCommand(route, 'CLOSE', { expectedVersion: 99 })).rejects.toThrow('atualizada'); });
  it('remove e move entre rotas abertas com CAS nos dois lados e histórico', async () => { const order = await ready(); let a = await createRoute(), b = await createRoute(); a = await routeCommand(a, 'ADD', { pizzaId: order.items[0].id }); a = await routeCommand(a, 'MOVE', { pizzaId: order.items[0].id, targetRouteId: b.id, targetExpectedVersion: b.version }); b = (await routes.list()).find(value => value.id === b.id)!; expect(a.items).toHaveLength(0); expect(b.items).toHaveLength(1); b = await routeCommand(b, 'REMOVE', { pizzaId: order.items[0].id }); expect(b.items).toHaveLength(0); expect((await routes.history(a.id)).map(value => value.eventType)).toContain('ROUTE_ITEM_REMOVED'); });
  it.each(['CLOSE', 'REOPEN'] as const)('%s concorrente tem um vencedor e duplicado idempotente', async command => { const order = await ready(); let route = await createRoute(); route = await routeCommand(route, 'ADD', { pizzaId: order.items[0].id }); if (command === 'REOPEN') route = await routeCommand(route, 'CLOSE'); const input = { command, expectedVersion: route.version, clientCommandId: randomUUID() }; const results = await Promise.allSettled([routes.execute(route.id, input, actors[1]), routes.execute(route.id, { ...input, clientCommandId: randomUUID() }, actors[1])]); expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1); const accepted = results.find(value => value.status === 'fulfilled'); if (accepted?.status === 'fulfilled' && accepted.value.clientCommandId === input.clientCommandId) expect((await routes.execute(route.id, input, actors[1])).replayed).toBe(true); });
  it('criação e fechamento repetidos retornam recibo, mesmo ID/outro conteúdo conflita', async () => { const input = { command: 'CREATE' as const, clientCommandId: randomUUID() }; const first = await routes.execute(null, input, actors[1]); const replay = await routes.execute(null, input, actors[1]); expect(replay.routes).toEqual(first.routes); expect(replay.replayed).toBe(true); await expect(routes.execute(first.routes[0].id, { command: 'CLOSE', expectedVersion: 0, clientCommandId: input.clientCommandId }, actors[1])).rejects.toThrow('outro conteúdo'); });
it('reabertura invalida conferência/embalagem e preserva produção/histórico', async () => { let order = await ready(1, true), route = await closed(order); order = await prepare(order); const before = order.items[0]; route = await routeCommand(route, 'REOPEN'); order = await current(order); expect(order.status).toBe('FINISHING'); expect(order.packingFinishedAt).toBeNull(); expect(order.items[0]).toMatchObject({ counterCheckedAt: null, production: before.kind === 'PIZZA' ? { ...before.production, version: before.production.version + 1 } : {} }); expect((await routes.history(route.id)).some(value => value.eventType === 'ROUTE_REOPENED')).toBe(true); });
  it.each(['DELIVERY', 'PICKUP'] as const)('saída %s exige rota/conferência/extras/embalagem; conclusão preserva produção', async type => { let order = await ready(1, true, type), route = await closed(order); await expect(routeCommand(route, 'DISPATCH')).rejects.toThrow('incompleto'); order = await prepare(order); route = await routeCommand(route, 'DISPATCH'); order = await current(order); const result = await dispatch.execute(order.id, { command: type === 'DELIVERY' ? 'MARK_DELIVERED' : 'MARK_PICKED_UP', expectedVersion: order.version, clientCommandId: randomUUID() }, actors[2]); expect(result.order.status).toBe(type === 'DELIVERY' ? 'DELIVERED' : 'PICKED_UP'); expect(result.order.items[0]).toMatchObject({ production: { state: 'FINISHED' } }); await expect(routeCommand(route, 'REOPEN')).rejects.toThrow('despachada'); await expect(routeCommand(route, 'REMOVE', { pizzaId: order.items[0].id })).rejects.toThrow('despachada'); });
it('conferência de pizza é independente da produção e corrigir não apaga finishedAt', async () => { let order = await ready(); const route = await closed(order); order = await prepare(order); const item = order.items[0]; if (item.kind !== 'PIZZA') throw new Error('Pizza'); order = await conference(order, { command: 'UNCHECK_PIZZA', pizzaId: item.id, expectedItemVersion: item.production.version } as FinishingCommandInput); expect(order.items[0]).toMatchObject({ production: { state: 'FINISHED', finishedAt: item.production.finishedAt }, counterCheckedAt: null }); expect(order.packingFinishedAt).toBeNull(); await expect(routeCommand(route, 'DISPATCH')).rejects.toThrow('incompleto'); });
  it('rollback em recibo de rota desfaz composição, versões, histórico e invalidações; retry funciona', async () => { const order = await ready(), route = await createRoute(), before = await current(order); await prisma.$executeRawUnsafe(`CREATE TRIGGER route_receipt_failure BEFORE INSERT ON DispatchRouteReceipt BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END`); const input = { command: 'ADD' as const, expectedVersion: route.version, pizzaId: order.items[0].id, clientCommandId: randomUUID() }; try { await expect(routes.execute(route.id, input, actors[1])).rejects.toThrow(); } finally { await prisma.$executeRawUnsafe('DROP TRIGGER route_receipt_failure'); } expect((await routes.list()).find(value => value.id === route.id)).toEqual(route); expect(await current(order)).toEqual(before); expect(await prisma.dispatchRouteReceipt.findUnique({ where: { clientCommandId: input.clientCommandId } })).toBeNull(); expect((await routes.execute(route.id, input, actors[1])).routes[0].items).toHaveLength(1); });
  it('eventos de rota são publicados após commit; replay/conflito não emitem', async () => { events.length = 0; const input = { command: 'CREATE', clientCommandId: randomUUID() }, headers = { Authorization: `Bearer ${actors[1].token}`, 'X-Workstation-Device-Key': actors[1].deviceKey }; const first = await request(app).post('/dispatch/routes/commands').set(headers).send(input); expect(first.status).toBe(200); expect(events).toHaveLength(1); expect(await prisma.dispatchRoute.findUnique({ where: { id: first.body.routes[0].id } })).not.toBeNull(); expect((await request(app).post('/dispatch/routes/commands').set(headers).send(input)).body.replayed).toBe(true); expect(events).toHaveLength(1); });
  it('sem sessão e payload com campos desconhecidos são rejeitados', async () => { expect((await request(app).post('/dispatch/routes/commands').send({ command: 'CREATE', clientCommandId: randomUUID() })).status).toBe(401); expect((await request(app).post('/dispatch/routes/commands').send({ command: 'CREATE', clientCommandId: randomUUID(), routeNumber: 99 })).status).toBe(400); });
  it('rollback do envio direto desfaz entrada no forno, liberação, timestamps e agregação', async () => {
    const order = await pizza(await fresh(), 'START_ASSEMBLY'), item = order.items[0];
    if (item.kind !== 'PIZZA') throw new Error('Pizza');
    const input = { command: 'SEND_TO_OVEN' as const, expectedState: item.production.state, expectedVersion: item.production.version, clientCommandId: randomUUID() };
    await prisma.$executeRawUnsafe(`CREATE TRIGGER direct_oven_failure BEFORE INSERT ON PizzaCommandReceipt BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END`);
    try { await expect(commands.execute(order.id, item.id, input, actors[0])).rejects.toThrow(); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER direct_oven_failure'); }
    expect(await current(order)).toEqual(order);
    expect(await prisma.pizzaProductionHistory.count({ where: { commandId: input.clientCommandId } })).toBe(0);
    expect((await commands.execute(order.id, item.id, input, actors[0])).order.items[0]).toMatchObject({ production: { state: 'IN_OVEN' } });
  });
  it('falha no segundo pedido da rota desfaz a saída do primeiro e não congela composição', async () => {
    let a = await ready(), b = await ready(); let route = await createRoute();
    route = await routeCommand(route, 'ADD', { pizzaId: a.items[0].id }); route = await routeCommand(route, 'ADD', { pizzaId: b.items[0].id }); route = await routeCommand(route, 'CLOSE');
    a = await prepare(a); b = await current(b);
    await expect(routeCommand(route, 'DISPATCH')).rejects.toThrow('incompleto');
    expect(await current(a)).toEqual(a); expect(await current(b)).toEqual(b);
    expect((await routes.list()).find(value => value.id === route.id)).toEqual(route);
  });
  it('saída simultânea com mesmo ID tem um commit; ID diferente recebe conflito', async () => {
    const order = await ready(), route = await closed(order); await prepare(order);
    const input = { command: 'DISPATCH' as const, expectedVersion: route.version, clientCommandId: randomUUID() };
    const values = await Promise.all([routes.execute(route.id, input, actors[1]), routes.execute(route.id, input, actors[1])]);
    expect(values.filter(value => value.replayed)).toHaveLength(1);
    expect(await prisma.dispatchRouteHistory.count({ where: { routeId: route.id, eventType: 'ROUTE_DISPATCHED' } })).toBe(1);
    await expect(routes.execute(route.id, { ...input, clientCommandId: randomUUID() }, actors[1])).rejects.toThrow();
  });
  it('destino desatualizado não move vínculo nem incrementa a rota de origem', async () => {
    const order = await ready(); let a = await createRoute(); const b = await createRoute();
    a = await routeCommand(a, 'ADD', { pizzaId: order.items[0].id });
    await expect(routeCommand(a, 'MOVE', { pizzaId: order.items[0].id, targetRouteId: b.id, targetExpectedVersion: b.version + 1 })).rejects.toThrow();
    expect((await routes.list()).find(value => value.id === a.id)).toEqual(a);
    expect((await routes.list()).find(value => value.id === b.id)).toEqual(b);
  });
});
