import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { OrderService } from './orders.js';
import { StructuredOrderService } from './structured-orders.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const port = Number(process.env.PORT || 3333);
const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173';
const allowedOrigin = (origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => {
  if (!origin) return callback(null, true);
  try {
    const url = new URL(origin);
    const host = url.hostname;
    const local = host === 'localhost' || host === '127.0.0.1' || host === '10.0.2.2' || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);
    callback(null, origin === webOrigin || (url.protocol === 'http:' && url.port === '5173' && local));
  } catch { callback(null, false); }
};
const prisma = new PrismaClient();
const orders = new OrderService(prisma);
const app = createApp(orders, (event, order) => io.emit(event, order), allowedOrigin, new StructuredOrderService(prisma));
const server = createServer(app);
const io = new Server(server, { cors: { origin: allowedOrigin } });

server.listen(port, () => console.info(`API em http://localhost:${port}`));

async function shutdown() {
  console.info('Encerrando API...');
  io.close();
  server.close();
  await prisma.$disconnect();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
