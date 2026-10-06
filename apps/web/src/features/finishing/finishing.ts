import type { Order, PizzaItem, ExtraItem } from '@guigs/shared';
export function finishingQueue(orders: Order[]) {
  return orders.filter(order => ['IN_PRODUCTION', 'OVEN', 'FINISHING'].includes(order.status) && order.items.some(item => item.kind === 'PIZZA' && ['BAKED', 'FINISHING', 'FINISHED'].includes(item.production.state)))
    .sort((a, b) => firstReady(a) - firstReady(b) || a.number - b.number);
}
function firstReady(order: Order) { return Math.min(...order.items.flatMap(item => item.kind === 'PIZZA' && item.production.bakedAt ? [Date.parse(item.production.bakedAt)] : [])); }
export function finishingProgress(order: Order) {
  const pizzas = order.items.filter((item): item is PizzaItem => item.kind === 'PIZZA' && item.production.state !== 'CANCELLED');
  const extras = order.items.filter((item): item is ExtraItem => item.kind === 'EXTRA' && item.state !== 'CANCELLED');
  const available = pizzas.filter(item => ['BAKED', 'FINISHING', 'FINISHED'].includes(item.production.state)).length;
  const checkedPizzas = pizzas.filter(item => item.production.state === 'FINISHED').length;
  const checkedExtras = extras.reduce((sum, item) => sum + item.checkedQuantity, 0), extraUnits = extras.reduce((sum, item) => sum + item.quantity, 0);
  const allChecked = pizzas.length > 0 && checkedPizzas === pizzas.length && checkedExtras === extraUnits && extras.every(item => item.state === 'FINISHED');
  return { pizzas: pizzas.length, available, checkedPizzas, extraUnits, extraTypes: extras.length, checkedExtras, checked: checkedPizzas + checkedExtras, total: pizzas.length + extraUnits, allChecked, canRelease: allChecked && Boolean(order.packingFinishedAt && order.packingFinishedBy) };
}
