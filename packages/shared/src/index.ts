import { z } from 'zod';

export const orderTypes = ['DELIVERY', 'PICKUP'] as const;
export const orderStatuses = ['WAITING_PRODUCTION', 'IN_PRODUCTION', 'OVEN', 'FINISHING', 'WAITING_DISPATCH', 'WAITING_DRIVER', 'OUT_FOR_DELIVERY', 'DELIVERED', 'READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED'] as const;
export const itemStatuses = ['WAITING', 'IN_PRODUCTION', 'OVEN', 'FINISHED', 'CANCELLED'] as const;
export const modifierKinds = ['REMOVED', 'ADDED', 'CRUST'] as const;

const modifierSchema = z.object({
  kind: z.enum(modifierKinds),
  name: z.string().trim().min(1).max(120),
}).strict();

const orderItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  size: z.string().trim().min(1).max(60),
  ingredients: z.string().trim().max(1000).optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
  modifiers: z.array(modifierSchema).max(30).default([]),
}).strict();

export const createOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  customerPhone: z.string().trim().max(30).optional().default(''),
  type: z.enum(orderTypes),
  notes: z.string().trim().max(1000).optional().default(''),
  items: z.array(orderItemSchema).min(1).max(30),
}).strict();

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderType = typeof orderTypes[number];
export type OrderStatus = typeof orderStatuses[number];
export type ItemStatus = typeof itemStatuses[number];
export type ModifierKind = typeof modifierKinds[number];

export interface OrderView {
  id: string;
  number: number;
  customerName: string;
  customerPhone: string | null;
  type: OrderType;
  status: OrderStatus;
  notes: string | null;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
  items: {
    id: string;
    name: string;
    size: string;
    ingredients: string | null;
    notes: string | null;
    status: ItemStatus;
    modifiers: { id: string; kind: ModifierKind; name: string }[];
  }[];
}
