import { PrismaClient, type Order, type OrderItem, type OrderItemModifier } from '@prisma/client';
import { createOrderSchema, type CreateOrderInput, type OrderView } from '@guigs/shared';

type OrderWithItems = Order & { items: (OrderItem & { modifiers: OrderItemModifier[] })[] };

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

  async listWaiting(): Promise<OrderView[]> {
    const orders = await this.prisma.order.findMany({
      where: { status: 'WAITING_PRODUCTION' },
      orderBy: { receivedAt: 'asc' },
      include: { items: { include: { modifiers: true } } },
    });
    return orders.map(toOrderView);
  }

  async get(id: string): Promise<OrderView | null> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: { include: { modifiers: true } } },
    });
    return order ? toOrderView(order) : null;
  }
}
