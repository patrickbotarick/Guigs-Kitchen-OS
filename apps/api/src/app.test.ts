import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { OrderView } from '@guigs/shared';
import { createApp, type OrdersPort } from './app.js';
import { TransitionConflictError } from './orders.js';

const order: OrderView = {
  id: 'cmgjvq1230000abcd12345678', number: 1, customerName: 'Rafael', customerPhone: null,
  type: 'DELIVERY', status: 'WAITING_PRODUCTION', notes: null,
  receivedAt: '2026-10-01T12:00:00.000Z', createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z',
  items: [{ id: 'item1', name: 'Portuguesa', size: 'Grande', ingredients: 'Mussarela, ovo', notes: null, status: 'WAITING', modifiers: [{ id: 'mod1', kind: 'REMOVED', name: 'Cebola' }] }],
};
const payload = {
  customerName: 'Rafael', type: 'DELIVERY', items: [{ name: 'Portuguesa', size: 'Grande', ingredients: 'Mussarela, ovo', modifiers: [{ kind: 'REMOVED', name: 'Cebola' }] }],
};

describe('API de pedidos', () => {
  const create = vi.fn(async () => order);
  const listActive = vi.fn(async () => [order]);
  const get = vi.fn(async () => order);
  const history = vi.fn(async () => [{ id: 'h1', orderId: order.id, fromStatus: null, toStatus: 'WAITING_PRODUCTION' as const, changedAt: order.receivedAt, actorType: 'SYSTEM' as const, actorId: null, metadata: null }]);
  const transition = vi.fn(async () => ({ ...order, status: 'IN_PRODUCTION' as const }));
  const publish = vi.fn();
  const app = createApp({ create, listActive, get, history, transition } satisfies OrdersPort, publish, 'http://localhost:5173');
  beforeEach(() => vi.clearAllMocks());

  it('cria pedido válido, preserva itens/modificadores e emite evento', async () => {
    const response = await request(app).post('/orders').send(payload);
    expect(response.status).toBe(201);
    expect(response.body.number).toBe(1);
    expect(response.body.items[0].modifiers[0].name).toBe('Cebola');
    expect(create).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith('order.created', order);
  });
  it('rejeita payload inválido sem criar pedido', async () => {
    create.mockClear();
    const response = await request(app).post('/orders').send({ ...payload, items: [] });
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
  it('carrega a fila inicial', async () => {
    const response = await request(app).get('/orders');
    expect(response.status).toBe(200);
    expect(response.body[0].number).toBe(1);
  });
  it('transiciona e emite order.updated após sucesso', async () => {
    const response = await request(app).post(`/orders/${order.id}/transition`).send({ expectedStatus: 'WAITING_PRODUCTION', toStatus: 'IN_PRODUCTION' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('IN_PRODUCTION');
    expect(transition).toHaveBeenCalledWith(order.id, { expectedStatus: 'WAITING_PRODUCTION', toStatus: 'IN_PRODUCTION' });
    expect(publish).toHaveBeenCalledWith('order.updated', response.body);
  });
  it('rejeita transição conflitante com HTTP 409 sem emitir evento', async () => {
    transition.mockRejectedValueOnce(new TransitionConflictError('Transição inválida'));
    const response = await request(app).post(`/orders/${order.id}/transition`).send({ expectedStatus: 'WAITING_PRODUCTION', toStatus: 'DELIVERED' });
    expect(response.status).toBe(409);
    expect(publish).not.toHaveBeenCalled();
  });
  it('retorna histórico cronológico', async () => {
    const response = await request(app).get(`/orders/${order.id}/history`);
    expect(response.status).toBe(200);
    expect(response.body[0].toStatus).toBe('WAITING_PRODUCTION');
  });
});
