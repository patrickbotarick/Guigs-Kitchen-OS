import type { DispatchRouteView, Order } from '@guigs/shared';

export function routeConference(route: DispatchRouteView, orders: Order[]) {
  const involved = orders.filter(order => route.items.some(item => item.orderId === order.id));
  const pizzas = involved.flatMap(order => order.items.filter(item => item.kind === 'PIZZA' && item.production.state !== 'CANCELLED').map(pizza => ({ order, pizza })));
  const extras = involved.flatMap(order => order.items.filter(item => item.kind === 'EXTRA' && item.state !== 'CANCELLED'));
  const pendingOrders = involved.filter(order => order.status !== 'WAITING_DISPATCH' || order.items.some(item => item.kind === 'PIZZA' && item.production.state !== 'CANCELLED' && !route.items.some(link => link.pizzaId === item.id)));
  return {
    involved, pizzas: pizzas.length,
    checkedPizzas: pizzas.filter(({ order, pizza }) => pizza.kind === 'PIZZA' && pizza.production.state === 'FINISHED' && (pizza.counterCheckedAt || order.operationalFlowVersion !== 2) && route.items.some(link => link.pizzaId === pizza.id)).length,
    extras: extras.reduce((sum, item) => sum + (item.kind === 'EXTRA' ? item.quantity : 0), 0),
    checkedExtras: extras.reduce((sum, item) => sum + (item.kind === 'EXTRA' ? item.checkedQuantity : 0), 0),
    packing: involved.filter(order => order.packingFinishedAt).length,
    pending: pendingOrders.length,
    complete: involved.length > 0 && pendingOrders.length === 0 && new Set(route.items.map(item => item.orderId)).size === involved.length,
  };
}
