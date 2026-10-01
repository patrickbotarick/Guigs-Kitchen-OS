import { Link } from 'react-router-dom';
import type { OrderView } from '@guigs/shared';
import { useKitchen } from '../useKitchen';

const label = (type: OrderView['type']) => type === 'DELIVERY' ? 'DELIVERY' : 'RETIRADA';

export function Kitchen() {
  const { orders, apiOnline, realtime, error, refresh } = useKitchen();
  return <div className="page">
    <div className="page-head"><div><div className="eyebrow">PRODUÇÃO · FILA ATUAL</div><h1>Fila da cozinha</h1><p>Pedidos aguardando produção, em ordem de chegada.</p></div><Link className="button primary" to="/orders/new">+ Novo pedido</Link></div>
    <div className="queue-toolbar"><div><strong>{orders.length}</strong> {orders.length === 1 ? 'pedido aguardando' : 'pedidos aguardando'}</div><div className="status-line"><span className={apiOnline ? 'dot on' : 'dot'} />API {apiOnline ? 'online' : 'offline'}<span className={realtime ? 'dot on' : 'dot'} />Realtime {realtime ? 'conectado' : 'reconectando'}</div></div>
    {error && <div className="alert" role="alert">{error} <button type="button" onClick={() => void refresh()}>Tentar agora</button></div>}
    {orders.length === 0 ? <div className="empty"><div className="empty-icon">◌</div><h2>Nenhum pedido na fila</h2><p>Crie um pedido de teste para começar a simulação.</p><Link className="button secondary" to="/orders/new">Criar pedido</Link></div> :
      <div className="order-grid">{orders.map(order => <article className="order-card" key={order.id}>
        <div className="card-top"><div><div className="order-number">#{String(order.number).padStart(4, '0')}</div><h2>{order.customerName}</h2></div><span className="pill">AGUARDANDO</span></div>
        <div className="order-meta"><span>{label(order.type)}</span><span>{new Date(order.receivedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span><span>{order.items.length} {order.items.length === 1 ? 'pizza' : 'pizzas'}</span></div>
        <div className="items">{order.items.map((item, index) => <div className="pizza" key={item.id}>
          <div className="pizza-title"><span className="pizza-index">{index + 1}</span><strong>{item.name} <span>{item.size}</span></strong></div>
          {item.ingredients && <p className="ingredients">{item.ingredients}</p>}
          {item.modifiers.map(modifier => <div className={`modifier ${modifier.kind.toLowerCase()}`} key={modifier.id}>{modifier.kind === 'REMOVED' ? '🚫 SEM ' : modifier.kind === 'CRUST' ? '+ BORDA ' : '+ '}{modifier.name}</div>)}
          {item.notes && <p className="item-note">Obs: {item.notes}</p>}
        </div>)}</div>
        {order.notes && <div className="order-note">Pedido: {order.notes}</div>}
      </article>)}</div>}
  </div>;
}
