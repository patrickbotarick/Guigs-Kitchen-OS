import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { CreateOrderInput, OrderStatus } from '@guigs/shared';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OrderService, TransitionConflictError } from './orders.js';

const databaseName = `test-${randomUUID()}.db`;
const databasePath = resolve(process.cwd(), 'prisma', databaseName);
const prisma = new PrismaClient({ datasources: { db: { url: `file:./${databaseName}` } } });
const orders = new OrderService(prisma);

async function applySql(path: string) {
  const sql = readFileSync(path, 'utf8');
  for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(statement);
  }
}

beforeAll(async () => {
  writeFileSync(databasePath, '');
  await applySql(resolve(process.cwd(), 'prisma/migrations/20261001120000_init/migration.sql'));
  await applySql(resolve(process.cwd(), 'prisma/migrations/20261001150000_order_history/migration.sql'));
  await applySql(resolve(process.cwd(), 'prisma/migrations/20261005180000_structured_kitchen/migration.sql'));
});

afterAll(async () => {
  await prisma.$disconnect();
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${databasePath}${suffix}`, { force: true });
});

const input: CreateOrderInput = {
  customerName: 'Teste transacional', customerPhone: '', type: 'DELIVERY', notes: '',
  items: [{ name: 'Portuguesa', size: 'Grande', ingredients: 'Mussarela', notes: '', modifiers: [{ kind: 'REMOVED', name: 'Cebola' }] }],
};

describe('máquina de estados persistida', () => {
  it('cria evento inicial e percorre apenas as quatro transições válidas', async () => {
    const created = await orders.create(input);
    expect(created.status).toBe('WAITING_PRODUCTION');
    expect((await orders.history(created.id))?.map(entry => entry.toStatus)).toEqual(['WAITING_PRODUCTION']);
    await expect(orders.transition(created.id, { expectedStatus: 'WAITING_PRODUCTION', toStatus: 'DELIVERED' })).rejects.toBeInstanceOf(TransitionConflictError);

    let current: OrderStatus = created.status;
    for (const next of ['IN_PRODUCTION', 'OVEN', 'FINISHING', 'WAITING_DISPATCH'] as const) {
      const updated = await orders.transition(created.id, { expectedStatus: current, toStatus: next });
      expect(updated.status).toBe(next);
      current = next;
    }
    expect((await orders.history(created.id))?.map(entry => entry.toStatus)).toEqual(['WAITING_PRODUCTION', 'IN_PRODUCTION', 'OVEN', 'FINISHING', 'WAITING_DISPATCH']);
    const persisted = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    expect(persisted.productionStartedAt).not.toBeNull();
    expect(persisted.productionFinishedAt).not.toBeNull();
    expect(persisted.ovenStartedAt).not.toBeNull();
    expect(persisted.ovenFinishedAt).not.toBeNull();
    expect(persisted.packingFinishedAt).not.toBeNull();
  });

  it('rejeita estado esperado desatualizado sem novo histórico', async () => {
    const created = await orders.create(input);
    await orders.transition(created.id, { expectedStatus: 'WAITING_PRODUCTION', toStatus: 'IN_PRODUCTION' });
    await expect(orders.transition(created.id, { expectedStatus: 'WAITING_PRODUCTION', toStatus: 'IN_PRODUCTION' })).rejects.toBeInstanceOf(TransitionConflictError);
    expect((await orders.history(created.id))?.length).toBe(2);
  });

  it('desfaz alteração do status quando a gravação do histórico falha', async () => {
    const created = await orders.create(input);
    await orders.transition(created.id, { expectedStatus: 'WAITING_PRODUCTION', toStatus: 'IN_PRODUCTION' });
    await prisma.$executeRawUnsafe("CREATE TRIGGER fail_history BEFORE INSERT ON OrderStatusHistory WHEN NEW.toStatus = 'OVEN' BEGIN SELECT RAISE(ABORT, 'history failed'); END");
    try {
      await expect(orders.transition(created.id, { expectedStatus: 'IN_PRODUCTION', toStatus: 'OVEN' })).rejects.toThrow();
      expect((await orders.get(created.id))?.status).toBe('IN_PRODUCTION');
      expect((await orders.history(created.id))?.length).toBe(2);
    } finally { await prisma.$executeRawUnsafe('DROP TRIGGER fail_history'); }
  });

  it('aceita apenas uma solicitação concorrente com o mesmo estado esperado', async () => {
    const created = await orders.create(input);
    const results = await Promise.allSettled([
      orders.transition(created.id, { expectedStatus: 'WAITING_PRODUCTION', toStatus: 'IN_PRODUCTION' }),
      orders.transition(created.id, { expectedStatus: 'WAITING_PRODUCTION', toStatus: 'IN_PRODUCTION' }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await orders.get(created.id))?.status).toBe('IN_PRODUCTION');
    expect((await orders.history(created.id))?.length).toBe(2);
  });
});
