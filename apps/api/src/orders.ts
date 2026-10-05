import { Prisma, PrismaClient, type Order, type OrderItem, type OrderItemModifier, type OrderStatusHistory } from '@prisma/client';
import { activeOrderStatuses, createOrderSchema, nextOrderStatus, transitionOrderSchema, type CreateOrderInput, type OrderHistoryView, type OrderView, type TransitionOrderInput } from '@guigs/shared';

type OrderWithItems = Order & { items: (OrderItem & { modifiers: OrderItemModifier[] })[] };

export class OrderNotFoundError extends Error {}
export class TransitionConflictError extends Error {}

function toHistoryView(entry: OrderStatusHistory): OrderHistoryView {
  return {
    id: entry.id,
    orderId: entry.orderId,
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    changedAt: entry.changedAt.toISOString(),
    actorType: entry.actorType,
    actorId: entry.actorId,
    metadata: entry.metadata,
  };
}

export function toOrderView(order: OrderWithItems): OrderView {
  return {
    id: order.id,
    number: order.number,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    type: order.type,
    status: order.status,
    notes: order.notes,
    receivedAt: order.receivedAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items.map(item => ({
      id: item.id,
      name: item.name,
      size: item.size,
      ingredients: item.ingredients,
      notes: item.notes,
      status: item.status,
      modifiers: item.modifiers.map(modifier => ({ id: modifier.id, kind: modifier.kind, name: modifier.name })),
    })),
  };
}

export class OrderService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateOrderInput): Promise<OrderView> {
    const valid = createOrderSchema.parse(input);
    const order = await this.prisma.$transaction(async tx => {
      const counter = await tx.orderCounter.upsert({
        where: { id: 1 },
        create: { id: 1, value: 1 },
        update: { value: { increment: 1 } },
      });
      const now = new Date();
      return tx.order.create({
        data: {
          number: counter.value,
          customerName: valid.customerName,
          customerPhone: valid.customerPhone || null,
          type: valid.type,
          notes: valid.notes || null,
          receivedAt: now,
          productionQueueAt: now,
          statusHistory: { create: { toStatus: 'WAITING_PRODUCTION', changedAt: now, actorType: 'SYSTEM' } },
          items: { create: valid.items.map(item => ({
            name: item.name,
            size: item.size,
            ingredients: item.ingredients || null,
            notes: item.notes || null,
            modifiers: { create: item.modifiers.map(modifier => ({ kind: modifier.kind, name: modifier.name })) },
          })) },
        },
        include: { items: { include: { modifiers: true } } },
      });
    });
    return toOrderView(order);
  }

  async listActive(): Promise<OrderView[]> {
    const orders = await this.prisma.order.findMany({
      where: { schemaVersion: 1, status: { in: [...activeOrderStatuses] } },
      orderBy: { receivedAt: 'asc' },
      include: { items: { include: { modifiers: true } } },
    });
    return orders.map(toOrderView);
  }

  async get(id: string): Promise<OrderView | null> {
    const order = await this.prisma.order.findUnique({
      where: { id, schemaVersion: 1 },
      include: { items: { include: { modifiers: true } } },
    });
    return order ? toOrderView(order) : null;
  }

  async history(id: string): Promise<OrderHistoryView[] | null> {
    const exists = await this.prisma.order.findUnique({ where: { id, schemaVersion: 1 }, select: { id: true } });
    if (!exists) return null;
    const entries = await this.prisma.orderStatusHistory.findMany({
      where: { orderId: id },
      orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
    });
    return entries.map(toHistoryView);
  }

  async transition(id: string, input: TransitionOrderInput): Promise<OrderView> {
    const { expectedStatus, toStatus } = transitionOrderSchema.parse(input);
    try {
      const updated = await this.prisma.$transaction(async tx => {
        const current = await tx.order.findUnique({ where: { id }, select: { status: true, schemaVersion: true } });
        if (!current) throw new OrderNotFoundError('Pedido não encontrado');
        if (current.schemaVersion !== 1) throw new TransitionConflictError('Pedido estruturado exige comandos por pizza.');
        if (current.status !== expectedStatus) throw new TransitionConflictError(`Estado desatualizado: esperado ${expectedStatus}, atual ${current.status}`);
        if (nextOrderStatus[current.status] !== toStatus) throw new TransitionConflictError(`Transição inválida de ${current.status} para ${toStatus}`);

        const now = new Date();
        const count = await tx.order.updateMany({
          where: { id, status: expectedStatus },
          data: {
            status: toStatus,
            ...(toStatus === 'IN_PRODUCTION' ? { productionStartedAt: now } : {}),
            ...(toStatus === 'OVEN' ? { productionFinishedAt: now, ovenStartedAt: now } : {}),
            ...(toStatus === 'FINISHING' ? { ovenFinishedAt: now } : {}),
            ...(toStatus === 'WAITING_DISPATCH' ? { packingFinishedAt: now } : {}),
          },
        });
        if (count.count !== 1) throw new TransitionConflictError('Pedido alterado por outra operação. Atualize a fila.');
        await tx.orderStatusHistory.create({
          data: { orderId: id, fromStatus: current.status, toStatus, changedAt: now, actorType: 'OPERATOR' },
        });
        const order = await tx.order.findUniqueOrThrow({ where: { id }, include: { items: { include: { modifiers: true } } } });
        return order;
      });
      return toOrderView(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028'].includes(error.code)) {
        throw new TransitionConflictError('Pedido alterado simultaneamente. Atualize a fila e tente novamente.');
      }
      throw error;
    }
  }
}
