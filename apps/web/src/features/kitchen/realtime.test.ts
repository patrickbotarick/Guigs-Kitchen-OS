import { describe, expect, it } from 'vitest';
import { structuredFixture } from '../../../../api/src/test-fixtures/kitchen';
import { AssemblyReconciliation } from './realtime';

const event = (version: number, eventId = 'cc67c320-268a-47f3-800e-1581d8b22c68') => ({ schemaVersion: 1, eventId, commandId: 'ac67c320-268a-47f3-800e-1581d8b22c68', orderId: structuredFixture().id, version, status: 'IN_PRODUCTION', timestamp: new Date().toISOString() });
describe('reconciliação realtime Assembly', () => {
  it('ignora IDs repetidos, versões antigas e eventos fora de ordem', () => {
    const sync = new AssemblyReconciliation(), order = structuredFixture(); sync.confirm(order);
    expect(sync.notify('kitchen.order.updated', event(order.version))).toBe(false);
    expect(sync.notify('kitchen.order.updated', event(order.version + 2, 'bc67c320-268a-47f3-800e-1581d8b22c68'))).toBe(true);
    expect(sync.notify('kitchen.order.updated', event(order.version + 2, 'bc67c320-268a-47f3-800e-1581d8b22c68'))).toBe(false);
    expect(sync.notify('kitchen.order.updated', event(order.version + 1, 'dc67c320-268a-47f3-800e-1581d8b22c68'))).toBe(false);
  });
  it('par pizza/pedido exige somente uma ressincronização por versão agregada', () => {
    const sync = new AssemblyReconciliation(), order = structuredFixture(); sync.confirm(order);
    const base = event(order.version + 1);
    const { status: _status, ...common } = base; void _status;
    expect(sync.notify('kitchen.pizza.updated', { ...common, pizzaId: order.items[0].id, state: 'ASSEMBLING', version: 1, orderVersion: order.version + 1 })).toBe(true);
    expect(sync.notify('kitchen.order.updated', { ...base, eventId: 'bc67c320-268a-47f3-800e-1581d8b22c68' })).toBe(false);
  });
  it('resposta antiga não regride comando confirmado nem ressuscita pedido removido', () => {
    const sync = new AssemblyReconciliation(), order = structuredFixture(); sync.confirm(order);
    const revision = sync.beginRead();
    sync.confirm({ ...order, version: order.version + 1, status: 'OVEN' });
    expect(sync.reconcile([order], revision)).toEqual([]);
    expect(sync.reconcile([], revision)).toEqual([]);
  });
  it('GET iniciado antes de confirmação não remove pedido mais novo', () => {
    const sync = new AssemblyReconciliation(), order = structuredFixture(); const revision = sync.beginRead();
    sync.confirm(order); expect(sync.reconcile([], revision)).toHaveLength(1);
    expect(sync.reconcile([], sync.beginRead())).toEqual([]);
  });
  it('reconexão reconcilia estado persistido mesmo sem nenhum evento recebido', () => {
    const sync = new AssemblyReconciliation(), order = structuredFixture(); sync.confirm(order);
    expect(sync.reconcile([{ ...order, version: order.version + 3, status: 'OVEN' }], sync.beginRead())).toEqual([]);
  });
  it('pedido v2 novo notifica uma vez; v1 e eventos malformados são ignorados', () => {
    const sync = new AssemblyReconciliation(), order = structuredFixture();
    expect(sync.created(order)).toBe(true); expect(sync.created(order)).toBe(false);
    expect(sync.created({ ...order, schemaVersion: 1 })).toBe(false);
    expect(sync.notify('kitchen.order.updated', { ...event(3), schemaVersion: 2 })).toBe(false);
  });
});
