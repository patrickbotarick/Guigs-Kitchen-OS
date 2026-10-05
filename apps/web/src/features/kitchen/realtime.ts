import { kitchenOrderUpdatedSchema, kitchenPizzaUpdatedSchema, type Order } from '@guigs/shared';
import { mapAssemblyOrder } from './api';
import type { AssemblyOrder } from './types';

export type AssemblyConnection = 'ONLINE' | 'RECONNECTING' | 'OFFLINE';
type Entry = { version: number; order: AssemblyOrder | null; revision: number };
// Includes tombstones: an old response must not resurrect an order that left assembly.
export class AssemblyReconciliation {
  private entries = new Map<string, Entry>();
  private announced = new Map<string, number>();
  private eventIds = new Set<string>();
  private revision = 0;
  beginRead() { return this.revision; }
  orders() { return [...this.entries.values()].flatMap(entry => entry.order ? [entry.order] : []); }
  confirm(order: Order) {
    const current = this.entries.get(order.id);
    if (!current || order.version > current.version) this.entries.set(order.id, { version: order.version, order: mapAssemblyOrder(order), revision: ++this.revision });
    return this.orders();
  }
  reconcile(orders: Order[], readRevision: number) {
    const ids = new Set(orders.map(order => order.id));
    for (const order of orders) this.confirm(order);
    for (const [id, entry] of this.entries) {
      // Preserve a newer command confirmation received while this GET was in flight.
      if (!ids.has(id) && entry.revision <= readRevision && entry.order) this.entries.set(id, { ...entry, order: null, revision: ++this.revision });
    }
    return this.orders();
  }
  notify(type: 'kitchen.pizza.updated' | 'kitchen.order.updated', value: unknown) {
    const parsed = type === 'kitchen.pizza.updated' ? kitchenPizzaUpdatedSchema.safeParse(value) : kitchenOrderUpdatedSchema.safeParse(value);
    if (!parsed.success) return false;
    const event = parsed.data;
    if (this.eventIds.has(event.eventId)) return false;
    this.eventIds.add(event.eventId);
    if (this.eventIds.size > 512) this.eventIds.delete(this.eventIds.values().next().value!);
    const version = 'orderVersion' in event ? event.orderVersion : event.version;
    const known = Math.max(this.entries.get(event.orderId)?.version ?? -1, this.announced.get(event.orderId) ?? -1);
    if (version <= known) return false;
    this.announced.set(event.orderId, version);
    return true;
  }
  created(value: unknown) {
    if (typeof value !== 'object' || !value || !('schemaVersion' in value) || value.schemaVersion !== 2 || !('id' in value) || typeof value.id !== 'string' || !('version' in value) || typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 0) return false;
    const known = Math.max(this.entries.get(value.id)?.version ?? -1, this.announced.get(value.id) ?? -1);
    if (value.version <= known) return false;
    this.announced.set(value.id, value.version); return true;
  }
}
