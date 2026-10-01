import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { OrderView } from '@guigs/shared';
import { createApp, type OrdersPort } from './app.js';

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
  const listWaiting = vi.fn(async () => [order]);
  const get = vi.fn(async () => order);
  const publish = vi.fn();
  const app = createApp({ create, listWaiting, get } satisfies OrdersPort, publish, 'http://localhost:5173');

  it('cria pedido válido, preserva itens/modificadores e emite evento', async () => {
    const response = await request(app).post('/orders').send(payload);
    expect(response.status).toBe(201);
    expect(response.body.number).toBe(1);
    expect(response.body.items[0].modifiers[0].name).toBe('Cebola');
    expect(create).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(order);
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
});
