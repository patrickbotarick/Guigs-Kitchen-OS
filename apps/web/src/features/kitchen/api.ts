import { readOrderData, pizzaCommandResultSchema, type Order, type PizzaCommandInput } from '@guigs/shared';
import type { AssemblyOrder } from './types';

const mountingStates = ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'];
export class AssemblyApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
export function mapAssemblyOrder(value: unknown): AssemblyOrder | null {
  const read = readOrderData(value);
  if (read.legacy) return null; // Never infer recipes from v1 text.
  const order: Order = read.order;
  if (!['WAITING_PRODUCTION', 'IN_PRODUCTION'].includes(order.status)) return null;
  const pizzas = order.items.filter(item => item.kind === 'PIZZA').sort((a, b) => a.position - b.position);
  if (!pizzas.some(pizza => mountingStates.includes(pizza.production.state))) return null;
  return { id: order.id, number: order.number, customerName: order.customerName, channel: order.channel, receivedAt: order.receivedAt, notes: order.notes,
    persistedStatus: order.status as 'WAITING_PRODUCTION' | 'IN_PRODUCTION',
    persistedVersion: order.version,
    extraCount: order.items.reduce((sum, item) => sum + (item.kind === 'EXTRA' && item.state !== 'CANCELLED' ? item.quantity : 0), 0),
    items: pizzas.map(pizza => ({ ...pizza.recipe, id: pizza.id, kind: 'PIZZA', notes: pizza.snapshot.notes ?? pizza.notes,
      snapshot: pizza.snapshot, status: pizza.production.state, productionVersion: pizza.production.version, paused: pizza.production.state === 'ASSEMBLY_PAUSED' })) };
}

export function createAssemblyApi(baseUrl: string, fetcher: typeof fetch = fetch) {
  async function get(path: string, signal?: AbortSignal): Promise<unknown> {
    const response = await fetcher(`${baseUrl}${path}`, { signal });
    if (!response.ok) throw new AssemblyApiError(`API indisponível (HTTP ${response.status}). Tente atualizar novamente.`, response.status);
    return response.json();
  }
  return {
    async readOrder(id: string, signal?: AbortSignal): Promise<Order> {
      const read = readOrderData(await get(`/orders/v2/${encodeURIComponent(id)}`, signal));
      if (read.legacy) throw new Error('Pedido v1 não aceita comandos de montagem v2.');
      return read.order;
    },
    async command(orderId: string, pizzaId: string, input: PizzaCommandInput, signal?: AbortSignal) {
      const response = await fetcher(`${baseUrl}/orders/v2/${encodeURIComponent(orderId)}/pizzas/${encodeURIComponent(pizzaId)}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
      const data: unknown = await response.json();
      if (!response.ok) throw new AssemblyApiError(typeof data === 'object' && data !== null && 'error' in data ? String(data.error) : `HTTP ${response.status}`, response.status);
      return pizzaCommandResultSchema.parse(data);
    },
    async list(signal?: AbortSignal): Promise<AssemblyOrder[]> {
      const data = await get('/orders/v2', signal);
      if (!Array.isArray(data)) throw new Error('Resposta inválida da API: lista de pedidos esperada.');
      return data.map(mapAssemblyOrder).filter((order): order is AssemblyOrder => order !== null);
    },
    async load(id: string, signal?: AbortSignal): Promise<AssemblyOrder | null> {
      return mapAssemblyOrder(await get(`/orders/v2/${encodeURIComponent(id)}`, signal));
    },
  };
}
