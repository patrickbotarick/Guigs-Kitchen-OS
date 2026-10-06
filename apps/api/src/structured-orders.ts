import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createRecipeSnapshot, createStructuredOrderSchema, deriveOrderProductionState, structuredOrderSchema, type CreateStructuredOrderInput, type Order } from '@guigs/shared';
import { extraCatalog, extraCatalogRevisionId, recipeCatalog } from '@guigs/shared/catalog';
import { loadCompatibleOrder } from './kitchen-data.js';
import { assignNewOrder, type TiePicker } from './auto-assignment.js';

export class StructuredValidationError extends Error {}
export class IdempotencyConflictError extends Error {}
export interface StructuredCreationResult { order: Order; replayed: boolean }

export class StructuredOrderService {
  constructor(private readonly prisma: PrismaClient, private readonly pickTie?: TiePicker) {}

  async get(id: string): Promise<Order | null> {
    const read = await loadCompatibleOrder(this.prisma, id);
    return read && !read.legacy ? read.order : null;
  }
  async listActive(): Promise<Order[]> {
    const ids = await this.prisma.order.findMany({ where: { schemaVersion: 2, status: { in: ['WAITING_PRODUCTION', 'IN_PRODUCTION', 'OVEN', 'FINISHING', 'WAITING_DISPATCH', 'WAITING_DRIVER', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP'] } }, orderBy: { receivedAt: 'asc' }, select: { id: true } });
    const orders = await Promise.all(ids.map(({ id }) => this.get(id)));
    return orders.filter((order): order is Order => order !== null);
  }

  async create(payload: CreateStructuredOrderInput): Promise<StructuredCreationResult> {
    const input = createStructuredOrderSchema.parse(payload);
    const { clientRequestId, ...intent } = input;
    const hash = createHash('sha256').update(JSON.stringify(intent)).digest('hex');
    const replay = (saved: { payloadHash: string; responseSnapshot: Prisma.JsonValue }): StructuredCreationResult => {
      if (saved.payloadHash !== hash) throw new IdempotencyConflictError('Chave de envio já usada com outro conteúdo.');
      return { order: structuredOrderSchema.parse(saved.responseSnapshot), replayed: true };
    };
    // Replay the original snapshot even if the current catalog later changes.
    const existing = await this.prisma.structuredOrderCreation.findUnique({ where: { clientRequestId } });
    if (existing) return replay(existing);
    let snapshots;
    try { snapshots = input.pizzas.map(pizza => createRecipeSnapshot(pizza, recipeCatalog)); }
    catch (error) { throw new StructuredValidationError(error instanceof Error ? error.message : 'Receita inválida.'); }
    const extras = input.extras.map(extra => {
      const entry = extraCatalog.find(entry => entry.id === extra.extraCatalogId);
      if (!entry) throw new StructuredValidationError('Extra não cadastrado.');
      return { ...extra, name: entry.name };
    });
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          const saved = await tx.structuredOrderCreation.findUnique({ where: { clientRequestId } });
          if (saved) return replay(saved);
          const counter = await tx.orderCounter.upsert({ where: { id: 1 }, create: { id: 1, value: 1 }, update: { value: { increment: 1 } } });
          const now = new Date();
          const status = deriveOrderProductionState({ pizzas: input.pizzas.map(() => 'WAITING_ASSEMBLY'), extras: extras.map(extra => ({ state: 'WAITING_FINISHING', quantity: extra.quantity, checkedQuantity: 0 })), packingConfirmed: false });
          const created = await tx.order.create({ data: {
            number: counter.value, schemaVersion: 2, structuredChannel: input.channel, type: input.fulfillmentType,
            customerName: input.customerName, customerPhone: input.customerPhone || null, notes: input.notes || null, status,
            receivedAt: now, productionQueueAt: now,
            statusHistory: { create: { toStatus: status, changedAt: now, actorType: 'SYSTEM', metadata: JSON.stringify({ origin: 'COUNTER_V2', clientRequestId }) } },
            pizzaItems: { create: input.pizzas.map((pizza, position) => ({
              position, size: pizza.size, composition: pizza.composition, crustId: pizza.crustId, notes: pizza.notes,
              catalogRevisionId: snapshots[position].catalogRevisionId, recipeSnapshot: snapshots[position] as unknown as Prisma.InputJsonValue,
              state: 'WAITING_ASSEMBLY', queuedAt: now,
              halves: { create: (pizza.composition === 'HALF_HALF' ? [pizza.firstHalf, pizza.secondHalf] : [pizza.firstHalf]).map((half, index) => ({ position: index + 1, flavorId: half.flavorId, modifiers: { create: half.modifiers } })) },
              history: { create: { eventType: 'CREATED', toState: 'WAITING_ASSEMBLY', changedAt: now, actorType: 'SYSTEM', commandId: `${clientRequestId}:pizza:${position}`, itemVersion: 0, reason: 'Criação de pedido v2 pelo balcão' } },
            })) },
            extraItems: { create: extras.map((extra, index) => ({ position: input.pizzas.length + index, extraCatalogId: extra.extraCatalogId, catalogRevisionId: extraCatalogRevisionId, nameSnapshot: extra.name, quantity: extra.quantity, notes: extra.notes })) },
          }, select: { id: true } });
          await assignNewOrder(tx, created.id, clientRequestId, this.pickTie);
          const read = await loadCompatibleOrder(tx, created.id);
          if (!read || read.legacy) throw new Error('Falha na leitura do pedido estruturado.');
          const order = structuredOrderSchema.parse(read.order);
          await tx.structuredOrderCreation.create({ data: { clientRequestId, payloadHash: hash, orderId: order.id, responseSnapshot: order as unknown as Prisma.InputJsonValue } });
          return { order, replayed: false };
        }, { maxWait: 5000, timeout: 10000 });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034', 'P2028', 'P1008'].includes(error.code)) throw error;
        const saved = await this.prisma.structuredOrderCreation.findUnique({ where: { clientRequestId } });
        if (saved) return replay(saved);
        if (attempt === 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
    throw new Error('Não foi possível concluir a criação.');
  }
}
