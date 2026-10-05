import { afterAll, beforeAll, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import { io, type Socket } from 'socket.io-client';
import { createApp } from './app.js';
import { OrderService } from './orders.js';
import { StructuredOrderService } from './structured-orders.js';
import { PizzaCommandService } from './pizza-commands.js';
import { kitchenPizzaUpdatedSchema, kitchenOrderUpdatedSchema, type Order } from '@guigs/shared';

const name = `test-realtime-${randomUUID()}.db`, path = resolve(process.cwd(), 'prisma', name);
const prisma = new PrismaClient({ datasources: { db: { url: `file:./${name}` } } });
const app = createApp(new OrderService(prisma), (event, order) => sockets.emit(event, order), 'http://localhost:5173', new StructuredOrderService(prisma), new PizzaCommandService(prisma), event => sockets.emit(event.type, event.payload));
const server = createServer(app), sockets = new Server(server);
const clients: Socket[] = [];
let origin: string;
function next(socket: Socket, event: string): Promise<unknown> {
  return new Promise((done, reject) => {
    const timeout = setTimeout(() => { socket.off(event, receive); reject(new Error(`Evento ${event} ausente`)); }, 3000);
    function receive(value: unknown) { clearTimeout(timeout); done(value); }
    socket.once(event, receive);
  });
}
beforeAll(async () => {
  writeFileSync(path, ''); const directory = resolve(process.cwd(), 'prisma/migrations');
  for (const name of readdirSync(directory).filter(name => /^\d/.test(name)).sort()) for (const sql of readFileSync(resolve(directory, name, 'migration.sql'), 'utf8').split(';').map(part => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(sql);
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (let i = 0; i < 2; i++) { const socket = io(origin, { autoConnect: false }); clients.push(socket); const connected = next(socket, 'connect'); socket.connect(); await connected; }
});
afterAll(async () => {
  clients.forEach(client => client.disconnect()); await new Promise<void>(done => sockets.close(() => done()));
  await prisma.$disconnect(); for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
});
it('dois clientes recebem criação e comando com dados já commitados; replay não emite', async () => {
  const creations = clients.map(client => next(client, 'order.created'));
  const body = { clientRequestId: randomUUID(), customerName: 'Socket real', customerPhone: '', fulfillmentType: 'DELIVERY', channel: 'COUNTER', notes: '', extras: [], pizzas: [{ size: 'GRANDE', composition: 'WHOLE', firstHalf: { flavorId: 'calabresa', modifiers: [] }, crustId: 'tradicional', notes: null }] };
  const response = await fetch(`${origin}/orders/v2`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  expect(response.status).toBe(201); const order: Order = await response.json();
  expect(await Promise.all(creations)).toEqual([order, order]);
  const committedWhenNotified = clients.map(client => new Promise<number>(done => client.once('kitchen.pizza.updated', () => { void prisma.pizzaCommandReceipt.count({ where: { orderId: order.id } }).then(done); })));
  const updates = clients.map(client => next(client, 'kitchen.pizza.updated'));
  const orderUpdates = clients.map(client => next(client, 'kitchen.order.updated'));
  const payload = { command: 'START_ASSEMBLY', expectedState: 'WAITING_ASSEMBLY', expectedVersion: 0, clientCommandId: randomUUID() };
  const url = `${origin}/orders/v2/${order.id}/pizzas/${order.items[0].id}/commands`;
  expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status).toBe(200);
  const events = (await Promise.all(updates)).map(event => kitchenPizzaUpdatedSchema.parse(event));
  expect(events[0]).toEqual(events[1]); expect(events[0]).toMatchObject({ orderId: order.id, pizzaId: order.items[0].id, state: 'ASSEMBLING', version: 1, orderVersion: 1, commandId: payload.clientCommandId });
  expect((await Promise.all(orderUpdates)).map(event => kitchenOrderUpdatedSchema.parse(event).status)).toEqual(['IN_PRODUCTION', 'IN_PRODUCTION']);
  expect(await Promise.all(committedWhenNotified)).toEqual([1, 1]);
  let additionalEvents = 0; const count = () => additionalEvents++; clients.forEach(client => client.on('kitchen.pizza.updated', count));
  const repeated = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); expect((await repeated.json()).replayed).toBe(true);
  await new Promise(done => setTimeout(done, 60)); expect(additionalEvents).toBe(0); clients.forEach(client => client.off('kitchen.pizza.updated', count));
});
