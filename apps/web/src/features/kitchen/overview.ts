import type { Order, PizzaItem, PizzaProductionState } from '@guigs/shared';

export const pizzaStates: readonly PizzaProductionState[] = ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED', 'WAITING_OVEN', 'IN_OVEN', 'BAKED', 'FINISHING', 'FINISHED', 'CANCELLED'];
export function pizzas(orders: readonly Order[]) { return orders.flatMap(order => order.items.filter((item): item is PizzaItem => item.kind === 'PIZZA')); }
export function overviewCounts(orders: readonly Order[]) {
  const values = pizzas(orders).filter(pizza => pizza.production.state !== 'CANCELLED');
  return { orders: orders.length, pizzas: values.length,
    waitingAssembly: values.filter(p => p.production.state === 'WAITING_ASSEMBLY').length,
    assembling: values.filter(p => ['ASSEMBLING', 'ASSEMBLY_PAUSED'].includes(p.production.state)).length,
    waitingOven: values.filter(p => p.production.state === 'WAITING_OVEN').length,
    inOven: values.filter(p => p.production.state === 'IN_OVEN').length,
    finishing: values.filter(p => ['BAKED', 'FINISHING'].includes(p.production.state)).length,
    waitingDispatch: orders.filter(order => order.status === 'WAITING_DISPATCH').length,
  };
}
export function orderProgress(order: Order) {
  const values = order.items.filter((item): item is PizzaItem => item.kind === 'PIZZA' && item.production.state !== 'CANCELLED');
  const done = values.filter(p => p.production.state === 'FINISHED').length;
  const inOven = values.filter(p => ['WAITING_OVEN', 'IN_OVEN'].includes(p.production.state)).length;
  const assembly = values.filter(p => ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'].includes(p.production.state)).length;
  return { total: values.length, done, inOven, assembly, label: `${done}/${values.length} pizzas finalizadas` };
}
export function operatorLoads(orders: readonly Order[]) {
  const result = new Map<string, { waiting: number; active: number; total: number }>();
  for (const pizza of pizzas(orders)) if (pizza.assignment?.operatorId && ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'].includes(pizza.production.state)) {
    const current = result.get(pizza.assignment.operatorId) ?? { waiting: 0, active: 0, total: 0 };
    current.total++; if (pizza.production.state === 'WAITING_ASSEMBLY') current.waiting++; else current.active++; result.set(pizza.assignment.operatorId, current);
  }
  return result;
}
export function stageLabel(state: PizzaProductionState) { return ({ WAITING_ASSEMBLY: 'Aguardando montagem', ASSEMBLING: 'Em montagem', ASSEMBLY_PAUSED: 'Montagem pausada', WAITING_OVEN: 'Aguardando forno', IN_OVEN: 'No forno', BAKED: 'Assada', FINISHING: 'Finalização', FINISHED: 'Finalizada', CANCELLED: 'Cancelada' } as Record<PizzaProductionState, string>)[state]; }
