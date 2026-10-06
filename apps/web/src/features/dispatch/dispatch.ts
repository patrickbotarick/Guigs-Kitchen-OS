import { dispatchCommands, dispatchTransitions, type Order, type ExtraItem, type DispatchCommandInput } from '@guigs/shared';
export const dispatchStatuses = ['WAITING_DISPATCH', 'WAITING_DRIVER', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP'];
export const dispatchLabels: Record<string, string> = { WAITING_DISPATCH: 'Aguardando despacho', WAITING_DRIVER: 'Aguardando entregador', OUT_FOR_DELIVERY: 'Saiu para entrega', DELIVERED: 'Entregue', READY_FOR_PICKUP: 'Pronto para retirada', PICKED_UP: 'Retirado' };
export const commandLabels: Record<DispatchCommandInput['command'], string> = { MARK_WAITING_DRIVER: 'Aguardando entregador', MARK_OUT_FOR_DELIVERY: 'Saiu para entrega', MARK_DELIVERED: 'Confirmar entregue', MARK_READY_FOR_PICKUP: 'Pronto para retirada', MARK_PICKED_UP: 'Confirmar retirado' };
export function dispatchQueue(orders: Order[], filter: 'ALL' | 'DELIVERY' | 'PICKUP' = 'ALL') {
  return orders.filter(order => dispatchStatuses.includes(order.status) && (filter === 'ALL' || order.fulfillmentType === filter)).sort((a, b) => Number(a.status !== 'WAITING_DISPATCH') - Number(b.status !== 'WAITING_DISPATCH') || Date.parse(a.dispatch?.dispatchReadyAt ?? a.createdAt) - Date.parse(b.dispatch?.dispatchReadyAt ?? b.createdAt) || a.number - b.number);
}
export function availableDispatchCommands(order: Order) {
  return dispatchCommands.filter(command => { const transition = dispatchTransitions[command]; return order.fulfillmentType === transition.fulfillmentType && order.status === transition.from && !order.dispatch?.completedAt; });
}
export function dispatchSummary(order: Order) { return { pizzas: order.items.filter(item => item.kind === 'PIZZA' && item.production.state !== 'CANCELLED').length, extras: order.items.filter((item): item is ExtraItem => item.kind === 'EXTRA' && item.state !== 'CANCELLED') }; }


export function dispatchWaitingSeconds(order: Order, now: number): number | null {
  if (!order.dispatch?.dispatchReadyAt) return null;
  const end = order.dispatch.dispatchedAt ?? order.dispatch.pickedUpAt;
  return Math.max(0, Math.floor(((end ? Date.parse(end) : now) - Date.parse(order.dispatch.dispatchReadyAt)) / 1000));
}
