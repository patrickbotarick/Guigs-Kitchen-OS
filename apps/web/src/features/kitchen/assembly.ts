import { createDemoOrders, createMockOrder } from './mockOrders';
import { canTransitionPizza } from '@guigs/shared';
import type { AssemblyHandoff, AssemblyOrder, AssemblyOrderStatus, PizzaAction, PizzaItem, QueueSortDirection, SimulatedOrderInput } from './types';

export const pizzasOf = (order: AssemblyOrder): PizzaItem[] => order.items.filter((item): item is PizzaItem => item.kind === 'PIZZA');
export function sortOrders(orders: AssemblyOrder[], direction: QueueSortDirection): AssemblyOrder[] {
  return [...orders].sort((a, b) => (Date.parse(a.receivedAt) - Date.parse(b.receivedAt) || a.number - b.number) * (direction === 'ASC' ? 1 : -1));
}
// Counts only the end of assembly, never baked or fully finished pizzas.
export const assemblyCompletedPizzas = (order: AssemblyOrder) => pizzasOf(order).filter(pizza => ['WAITING_OVEN', 'IN_OVEN', 'BAKED', 'FINISHING', 'FINISHED'].includes(pizza.status)).length;
export const canCompleteAssembly = (order: AssemblyOrder) => pizzasOf(order).length > 0 && pizzasOf(order).every(pizza => pizza.status === 'WAITING_OVEN');
export function orderStage(order: AssemblyOrder): AssemblyOrderStatus {
  if (order.persistedStatus) return order.persistedStatus;
  // OVEN is the aggregate oven queue here; this module cannot confirm baking.
  if (canCompleteAssembly(order)) return 'OVEN';
  return pizzasOf(order).some(pizza => pizza.status !== 'WAITING_ASSEMBLY') ? 'IN_PRODUCTION' : 'WAITING_PRODUCTION';
}
export function transitionPizza(pizza: PizzaItem, action: PizzaAction): PizzaItem {
  const from = pizza.paused ? 'ASSEMBLY_PAUSED' : pizza.status;
  const to = { START: 'ASSEMBLING', PAUSE: 'ASSEMBLY_PAUSED', RESUME: 'ASSEMBLING', SEND_TO_OVEN: 'WAITING_OVEN' } as const;
  if (!canTransitionPizza(from, to[action])) return pizza;
  if (action === 'START' && pizza.status === 'WAITING_ASSEMBLY') return { ...pizza, status: 'ASSEMBLING', paused: false };
  if (action === 'PAUSE' && pizza.status === 'ASSEMBLING' && !pizza.paused) return { ...pizza, paused: true };
  if (action === 'RESUME' && pizza.status === 'ASSEMBLING' && pizza.paused) return { ...pizza, paused: false };
  if (action === 'SEND_TO_OVEN' && pizza.status === 'ASSEMBLING' && !pizza.paused) return { ...pizza, status: 'WAITING_OVEN' };
  return pizza;
}

export interface AssemblyState {
  orders: AssemblyOrder[];
  selectedOrderId: string | null;
  selectedPizzaIds: Record<string, string>;
  handoffs: AssemblyHandoff[];
  nextNumber: number;
  notice: string;
  sortDirection: QueueSortDirection;
}
export type AssemblyAction =
  | { type: 'SYNC_ORDERS'; orders: AssemblyOrder[] }
  | { type: 'TOGGLE_SORT' }
  | { type: 'SELECT_ORDER'; orderId: string }
  | { type: 'SELECT_PIZZA'; orderId: string; pizzaId: string }
  | { type: 'PIZZA_ACTION'; orderId: string; pizzaId: string; action: PizzaAction }
  | { type: 'COMPLETE_ASSEMBLY'; orderId: string; occurredAt: string }
  | { type: 'ARRIVE'; input: SimulatedOrderInput; receivedAt: string };

export function createAssemblyState(now: number): AssemblyState {
  const orders = createDemoOrders(now);
  return { orders, selectedOrderId: orders[0]?.id ?? null, selectedPizzaIds: {}, handoffs: [], nextNumber: 1006, notice: '', sortDirection: 'ASC' };
}

// Pure domain transitions; a future API adapter can replace dispatch without moving rules into cards.
export function assemblyReducer(state: AssemblyState, action: AssemblyAction): AssemblyState {
  switch (action.type) {
    case 'SYNC_ORDERS': {
      const selectedPizzaIds = Object.fromEntries(action.orders.map(order => [order.id,
        order.items.find(pizza => pizza.id === state.selectedPizzaIds[order.id])?.id ?? order.items[0]?.id ?? '',
      ]));
      return { ...state, orders: action.orders, selectedPizzaIds,
        selectedOrderId: action.orders.some(order => order.id === state.selectedOrderId) ? state.selectedOrderId : sortOrders(action.orders, state.sortDirection)[0]?.id ?? null };
    }
    case 'TOGGLE_SORT':
      return { ...state, sortDirection: state.sortDirection === 'ASC' ? 'DESC' : 'ASC' };
    case 'SELECT_ORDER':
      return state.orders.some(order => order.id === action.orderId) ? { ...state, selectedOrderId: action.orderId } : state;
    case 'SELECT_PIZZA': {
      const order = state.orders.find(order => order.id === action.orderId);
      return order && pizzasOf(order).some(pizza => pizza.id === action.pizzaId)
        ? { ...state, selectedPizzaIds: { ...state.selectedPizzaIds, [order.id]: action.pizzaId } } : state;
    }
    case 'PIZZA_ACTION':
      return { ...state, orders: state.orders.map(order => order.id === action.orderId ? {
        ...order, items: order.items.map(item => item.kind === 'PIZZA' && item.id === action.pizzaId ? transitionPizza(item, action.action) : item),
      } : order) };
    case 'COMPLETE_ASSEMBLY': {
      const order = state.orders.find(order => order.id === action.orderId);
      if (!order || !canCompleteAssembly(order)) return state;
      const orders = state.orders.filter(item => item.id !== order.id);
      const selectedPizzaIds = { ...state.selectedPizzaIds };
      delete selectedPizzaIds[order.id];
      return {
        ...state, orders, selectedPizzaIds,
        selectedOrderId: state.selectedOrderId === order.id ? sortOrders(orders, state.sortDirection)[0]?.id ?? null : state.selectedOrderId,
        handoffs: [...state.handoffs, { type: 'assembly.completed', order, occurredAt: action.occurredAt, orderStatus: 'OVEN', destination: 'OVEN' }],
        notice: `Pedido #${order.number}: montagem concluída. Pizzas aguardando forno.`,
      };
    }
    case 'ARRIVE': {
      const order = createMockOrder(state.nextNumber, action.input, action.receivedAt);
      return { ...state, orders: [...state.orders, order], nextNumber: state.nextNumber + 1,
        selectedOrderId: state.selectedOrderId ?? order.id, notice: `Pedido #${order.number} chegou à fila.` };
    }
  }
}
