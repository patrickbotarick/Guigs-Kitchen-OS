import { randomUUID } from 'node:crypto';
import { kitchenOrderUpdatedSchema, kitchenPizzaUpdatedSchema, type KitchenNotification, type PizzaCommandResult } from '@guigs/shared';

// Called by the HTTP adapter only after execute() resolves its database transaction.
export function commandNotifications(result: PizzaCommandResult): KitchenNotification[] {
  if (result.replayed) return [];
  const pizza = result.order.items.find(item => item.id === result.pizzaId && item.kind === 'PIZZA');
  if (!pizza || pizza.kind !== 'PIZZA') throw new Error('Pizza ausente na confirmação do comando.');
  const common = { schemaVersion: 1 as const, orderId: result.order.id, commandId: result.clientCommandId, timestamp: new Date().toISOString() };
  return [
    { type: 'kitchen.pizza.updated', payload: kitchenPizzaUpdatedSchema.parse({ ...common, eventId: randomUUID(), pizzaId: pizza.id,
      state: pizza.production.state, version: pizza.production.version, orderVersion: result.order.version }) },
    { type: 'kitchen.order.updated', payload: kitchenOrderUpdatedSchema.parse({ ...common, eventId: randomUUID(), status: result.order.status, version: result.order.version }) },
  ];
}
