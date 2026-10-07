import type { Order } from '@guigs/shared';

export const fulfillmentLabel = (order: Order) => order.fulfillmentType === 'DELIVERY' ? 'Entrega' : 'Retirada';
export const channelLabel = (channel: string) => ({ COUNTER: 'Balcão', WHATSAPP: 'WhatsApp', IFOOD: 'iFood', OTHER: 'Outro', PHONE: 'Telefone', SIMULATOR: 'Simulador' })[channel] ?? 'Outro';
export function orderMinutes(order: Order, now: number) { return Math.max(0, Math.floor((now - Date.parse(order.receivedAt)) / 60000)); }
export function pizzaCount(order: Order) { return order.items.filter(item => item.kind === 'PIZZA' && item.production.state !== 'CANCELLED').length; }
export function OrderContext({ order, now }: { order: Order; now: number }) {
  return <div className="op-order-context"><div className="op-order-heading"><strong>#{order.number}</strong><span className="op-order-age" aria-label="Tempo total do pedido">{String(orderMinutes(order, now)).padStart(2, '0')} min</span></div><span className="op-order-customer">{order.customerName}</span><div className="op-order-tags"><span>{fulfillmentLabel(order)}</span><span>{channelLabel(order.channel)}</span></div></div>;
}
