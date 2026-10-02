import type { ItemStatus, ModifierKind, OrderStatus, OrderView } from '@guigs/shared';
import type { PizzaSize } from './catalog';

// Kitchen projections deliberately contain only production data from the shared contract.
export type OrderChannel = 'IFOOD' | 'WHATSAPP' | 'PICKUP' | 'COUNTER';
export type QueueSortDirection = 'ASC' | 'DESC';
export type PizzaStatus = Extract<ItemStatus, 'WAITING' | 'IN_PRODUCTION' | 'OVEN'>;
export type AssemblyOrderStatus = Extract<OrderStatus, 'WAITING_PRODUCTION' | 'IN_PRODUCTION' | 'OVEN'>;
export interface Ingredient {
  id: string;
  name: string;
  kind: 'NORMAL' | Extract<ModifierKind, 'REMOVED' | 'ADDED'>;
}
export interface IngredientModifier { type: 'REMOVE' | 'ADD'; ingredientId: string }
export interface PizzaHalf { flavorId: string; modifiers: IngredientModifier[] }
export type PizzaRecipe =
  | { size: PizzaSize; composition: 'WHOLE'; firstHalf: PizzaHalf; secondHalf?: never }
  | { size: 'GRANDE'; composition: 'HALF_HALF'; firstHalf: PizzaHalf; secondHalf: PizzaHalf };
export type PizzaDraft = PizzaRecipe & { crustId: string; notes: string | null };
export type PizzaItem = PizzaDraft & Pick<OrderView['items'][number], 'id'> & {
  kind: 'PIZZA';
  status: PizzaStatus;
  paused: boolean;
};
export interface AssemblyOrder extends Pick<OrderView, 'id' | 'number' | 'customerName' | 'receivedAt'> {
  channel: OrderChannel;
  items: PizzaItem[];
  extraCount: number;
}
export interface SimulatedOrderInput {
  customerName: string;
  channel: OrderChannel;
  pizzas: PizzaDraft[];
  extraCount: number;
}
// A handoff records assembly completion, not completion of baking or of the whole order.
export interface AssemblyHandoff {
  type: 'assembly.completed';
  order: AssemblyOrder;
  occurredAt: string;
  orderStatus: 'OVEN';
  destination: 'FINISHING';
}
export type PizzaAction = 'START' | 'PAUSE' | 'RESUME' | 'SEND_TO_OVEN';
