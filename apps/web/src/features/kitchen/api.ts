import { readOrderData, type Order } from '@guigs/shared';
import type { AssemblyOrder } from './types';

const mountingStates = ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'];
export function mapAssemblyOrder(value: unknown): AssemblyOrder | null {
  const read = readOrderData(value);
  if (read.legacy) return null; // Never infer recipes from v1 text.
  const order: Order = read.order;
  if (!['WAITING_PRODUCTION', 'IN_PRODUCTION'].includes(order.status)) return null;
  const pizzas = order.items.filter(item => item.kind === 'PIZZA').sort((a, b) => a.position - b.position);
  if (!pizzas.some(pizza => mountingStates.includes(pizza.production.state))) return null;
  return { id: order.id, number: order.number, customerName: order.customerName, channel: order.channel, receivedAt: order.receivedAt, notes: order.notes,
    persistedStatus: order.status as 'WAITING_PRODUCTION' | 'IN_PRODUCTION',
    extraCount: order.items.reduce((sum, item) => sum + (item.kind === 'EXTRA' && item.state !== 'CANCELLED' ? item.quantity : 0), 0),
    items: pizzas.map(pizza => ({ ...pizza.recipe, id: pizza.id, kind: 'PIZZA', notes: pizza.snapshot.notes ?? pizza.notes,
      snapshot: pizza.snapshot, status: pizza.production.state, paused: pizza.production.state === 'ASSEMBLY_PAUSED' })) };
}

export function createAssemblyApi(baseUrl: string, fetcher: typeof fetch = fetch) {
  async function get(path: string, signal?: AbortSignal): Promise<unknown> {
    const response = await fetcher(`${baseUrl}${path}`, { signal });
    if (!response.ok) throw new Error(`API indisponível (HTTP ${response.status}). Tente atualizar novamente.`);
    return response.json();
  }
  return {
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
