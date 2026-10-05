import type { PrismaClient } from '@prisma/client';
import { readOrderData, recipeSnapshotSchema, type CompatibleOrder } from '@guigs/shared';
import { toOrderView } from './orders.js';

// Internal preparation for v2 reads; existing HTTP routes remain on the legacy contract.
// Never infer structured data from a legacy name, size or aggregate status.
export async function loadCompatibleOrder(prisma: PrismaClient, id: string): Promise<CompatibleOrder | null> {
  const order = await prisma.order.findUnique({ where: { id }, include: {
    items: { include: { modifiers: true } },
    pizzaItems: { include: { halves: { orderBy: { position: 'asc' }, include: { modifiers: true } } } }, extraItems: true,
  } });
  if (!order) return null;
  if (order.schemaVersion === 1) return readOrderData(toOrderView(order));
  if (order.schemaVersion !== 2) throw new Error('Versão de pedido não suportada.');
  const iso = (date: Date | null) => date?.toISOString() ?? null;
  return readOrderData({ schemaVersion: 2, id: order.id, number: order.number, customerName: order.customerName, customerPhone: order.customerPhone,
    fulfillmentType: order.type, channel: order.structuredChannel, notes: order.notes,
    receivedAt: order.receivedAt.toISOString(), createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString(),
    version: order.version, status: order.status, packingFinishedAt: iso(order.packingFinishedAt), packingFinishedBy: order.packingFinishedBy,
    items: [...order.pizzaItems.map(pizza => {
      const snapshot = recipeSnapshotSchema.parse(pizza.recipeSnapshot);
      if (snapshot.catalogRevisionId !== pizza.catalogRevisionId) throw new Error('Revisão persistida incompatível com snapshot.');
      const halves = pizza.halves.map(half => ({ flavorId: half.flavorId, modifiers: half.modifiers.map(modifier => ({ type: modifier.type, ingredientId: modifier.ingredientId })) }));
      if (pizza.halves[0]?.position !== 1 || (pizza.composition === 'WHOLE' ? pizza.halves.length !== 1 : pizza.halves.length !== 2 || pizza.halves[1]?.position !== 2)) throw new Error('Metades persistidas incompatíveis.');
      return { id: pizza.id, orderId: order.id, position: pizza.position, notes: pizza.notes, kind: 'PIZZA',
        recipe: { size: pizza.size, composition: pizza.composition, firstHalf: halves[0], ...(pizza.composition === 'HALF_HALF' ? { secondHalf: halves[1] } : {}), crustId: pizza.crustId },
        snapshot,
        production: { state: pizza.state, version: pizza.version, queuedAt: pizza.queuedAt.toISOString(),
          assemblyStartedAt: iso(pizza.assemblyStartedAt), pausedAt: iso(pizza.pausedAt), assemblyCompletedAt: iso(pizza.assemblyCompletedAt), ovenStartedAt: iso(pizza.ovenStartedAt),
          ovenExpectedEndAt: iso(pizza.ovenExpectedEndAt), bakedAt: iso(pizza.bakedAt), finishingStartedAt: iso(pizza.finishingStartedAt), finishedAt: iso(pizza.finishedAt), cancelledAt: iso(pizza.cancelledAt) } };
    }), ...order.extraItems.map(extra => ({ id: extra.id, orderId: order.id, position: extra.position, notes: extra.notes, kind: 'EXTRA', extraCatalogId: extra.extraCatalogId,
      catalogRevisionId: extra.catalogRevisionId, snapshot: { name: extra.nameSnapshot }, quantity: extra.quantity, state: extra.state, checkedQuantity: extra.checkedQuantity,
      checkedAt: iso(extra.checkedAt), checkedBy: extra.checkedBy, version: extra.version }))].sort((a, b) => a.position - b.position),
  });
}
