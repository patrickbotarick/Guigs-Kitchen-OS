import { z } from 'zod';
import { orderStatuses } from './legacy.js';
import { pizzaProductionStateSchema } from './kitchen.js';

const envelope = { schemaVersion: z.literal(1), eventId: z.string().uuid(), orderId: z.string().min(1), timestamp: z.string().datetime() };
export const kitchenPizzaUpdatedSchema = z.object({ ...envelope, commandId: z.string().uuid(), pizzaId: z.string().min(1),
  state: pizzaProductionStateSchema, version: z.number().int().nonnegative(), orderVersion: z.number().int().nonnegative() }).strict();
export const kitchenOrderUpdatedSchema = z.object({ ...envelope, commandId: z.string().uuid(), status: z.enum(orderStatuses), version: z.number().int().nonnegative() }).strict();
export type KitchenPizzaUpdated = z.infer<typeof kitchenPizzaUpdatedSchema>;
export type KitchenOrderUpdated = z.infer<typeof kitchenOrderUpdatedSchema>;
export type KitchenNotification =
  | { type: 'kitchen.pizza.updated'; payload: KitchenPizzaUpdated }
  | { type: 'kitchen.order.updated'; payload: KitchenOrderUpdated };
