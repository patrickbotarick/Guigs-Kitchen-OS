import { io } from 'socket.io-client';

const api = process.env.SMOKE_API_URL || 'http://localhost:3333';
const socket = io(api, { reconnection: false, timeout: 5000 });
const connected = new Promise((resolve, reject) => {
  socket.once('connect', resolve);
  socket.once('connect_error', reject);
});
const eventReceived = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Evento order.created não recebido')), 5000);
  socket.once('order.created', order => { clearTimeout(timer); resolve(order); });
});

try {
  await connected;
  const health = await fetch(`${api}/health`);
  if (!health.ok) throw new Error('GET /health falhou');
  const invalid = await fetch(`${api}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [] }) });
  if (invalid.status !== 400) throw new Error('Payload inválido não rejeitado');

  const response = await fetch(`${api}/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Pedido de validação', type: 'DELIVERY',
      items: [
        { name: 'Portuguesa', size: 'Grande', ingredients: 'Mussarela, ovo', modifiers: [{ kind: 'REMOVED', name: 'Cebola' }] },
        { name: 'Calabresa', size: 'Média', modifiers: [{ kind: 'CRUST', name: 'Catupiry' }] },
      ],
    }),
  });
  if (response.status !== 201) throw new Error(`POST /orders retornou ${response.status}`);
  const order = await response.json();
  const event = await eventReceived;
  if (event.id !== order.id) throw new Error('Evento não corresponde ao pedido');
  const detail = await (await fetch(`${api}/orders/${order.id}`)).json();
  const list = await (await fetch(`${api}/orders`)).json();
  if (detail.items.length !== 2 || detail.items[0].modifiers[0].name !== 'Cebola') throw new Error('Itens/modificadores não persistidos');
  if (!list.some(item => item.id === order.id)) throw new Error('Pedido ausente da fila');
  console.info(`Smoke passou: pedido #${order.number} (${order.id}), HTTP + SQLite + evento Socket.IO.`);
} finally {
  socket.disconnect();
}
