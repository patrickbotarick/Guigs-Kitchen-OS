import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { nextOrderStatus, type ActorType, type OrderHistoryView, type OrderStatus, type OrderView } from '@guigs/shared';
import { getOrderHistory, transitionOrder } from '../api';
import { useKitchen } from '../useKitchen';
import { AssemblyIcon } from '../features/kitchen/components/AssemblyIcons';

const statusLabels: Record<OrderStatus, string> = {
  WAITING_PRODUCTION: 'Aguardando produção',
  IN_PRODUCTION: 'Em produção',
  OVEN: 'Forno',
  FINISHING: 'Finalização',
  WAITING_DISPATCH: 'Aguardando expedição',
  WAITING_DRIVER: 'Aguardando motoboy',
  OUT_FOR_DELIVERY: 'Em rota',
  DELIVERED: 'Entregue',
  READY_FOR_PICKUP: 'Pronto para retirada',
  PICKED_UP: 'Retirado',
  CANCELLED: 'Cancelado',
};
const actionLabels: Partial<Record<OrderStatus, string>> = {
  WAITING_PRODUCTION: 'Iniciar produção',
  IN_PRODUCTION: 'Enviar ao forno',
  OVEN: 'Enviar para finalização',
  FINISHING: 'Concluir finalização',
};
const actorLabels: Record<ActorType, string> = { SYSTEM: 'Sistema', OPERATOR: 'Operador', WORKER: 'Montador', ADMIN: 'Admin', INTEGRATION: 'Integração' };
const time = (date: string) => new Date(date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function OrderCard({ order, refresh }: { order: OrderView; refresh: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<OrderHistoryView[]>([]);
  const [historyError, setHistoryError] = useState('');
  const next = nextOrderStatus[order.status];

  useEffect(() => {
    if (!historyOpen) return;
    let active = true;
    void getOrderHistory(order.id).then(entries => {
      if (active) { setHistory(entries); setHistoryError(''); }
    }).catch(() => { if (active) setHistoryError('Não foi possível carregar o histórico.'); });
    return () => { active = false; };
  }, [historyOpen, order.id, order.status]);

  async function advance() {
    if (!next || pending) return;
    setPending(true);
    setError('');
    try {
      await transitionOrder(order.id, { expectedStatus: order.status, toStatus: next });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível avançar o pedido.');
      await refresh();
    } finally { setPending(false); }
  }

  return <article className="order-card">
    <div className="card-top"><div><div className="order-number">#{String(order.number).padStart(4, '0')}</div><h2>{order.customerName}</h2></div><span className={`pill status-${order.status.toLowerCase()}`}>{statusLabels[order.status]}</span></div>
    <div className="order-meta"><span>{order.type === 'DELIVERY' ? 'DELIVERY' : 'RETIRADA'}</span><span>{time(order.receivedAt)}</span><span>{order.items.length} {order.items.length === 1 ? 'pizza' : 'pizzas'}</span></div>
    <div className="items">{order.items.map((item, index) => <div className="pizza" key={item.id}>
      <div className="pizza-title"><span className="pizza-index">{index + 1}</span><strong>{item.name} <span>{item.size}</span></strong></div>
      {item.ingredients && <p className="ingredients">{item.ingredients}</p>}
      {item.modifiers.map(modifier => <div className={`modifier ${modifier.kind.toLowerCase()}`} key={modifier.id}><AssemblyIcon name={modifier.kind === 'REMOVED' ? 'close' : 'plus'} />{modifier.kind === 'REMOVED' ? 'SEM ' : modifier.kind === 'CRUST' ? 'BORDA ' : ''}{modifier.name}</div>)}
      {item.notes && <p className="item-note">Obs: {item.notes}</p>}
    </div>)}</div>
    {order.notes && <div className="order-note">Pedido: {order.notes}</div>}
    <div className="card-actions">
      {next && <button className="button primary" type="button" disabled={pending} onClick={() => void advance()}>{pending ? 'Atualizando...' : actionLabels[order.status]}</button>}
      <button className="button subtle" type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(open => !open)}>{historyOpen ? 'Ocultar histórico' : 'Ver histórico'}</button>
    </div>
    {error && <div className="card-error" role="alert">{error}</div>}
    {historyOpen && <section className="history"><h3>Histórico do pedido</h3>{historyError ? <p role="alert">{historyError}</p> : <ol>{history.map(entry => <li key={entry.id}><time dateTime={entry.changedAt}>{time(entry.changedAt)}</time><span>{entry.fromStatus ? `${statusLabels[entry.fromStatus]} → ${statusLabels[entry.toStatus]}` : `Pedido criado → ${statusLabels[entry.toStatus]}`}</span><small>{actorLabels[entry.actorType]}</small></li>)}</ol>}</section>}
  </article>;
}

export function Kitchen() {
  const { orders, apiOnline, realtime, error, refresh } = useKitchen();
  const waiting = orders.filter(order => order.status === 'WAITING_PRODUCTION').length;
  return <div className="page">
    <div className="page-head"><div><div className="eyebrow">PRODUÇÃO · ACOMPANHAMENTO</div><h1>Fila da cozinha</h1><p>Pedidos ativos, em ordem de chegada. Ações temporárias para validar o fluxo.</p></div><Link className="button primary" to="/orders/new">+ Novo pedido</Link></div>
    <div className="queue-toolbar"><div><strong>{orders.length}</strong> {orders.length === 1 ? 'pedido ativo' : 'pedidos ativos'} <span className="queue-waiting">· {waiting} aguardando produção</span></div><div className="status-line"><span className={apiOnline ? 'dot on' : 'dot'} />API {apiOnline ? 'online' : 'offline'}<span className={realtime ? 'dot on' : 'dot'} />Realtime {realtime ? 'conectado' : 'reconectando'}</div></div>
    {error && <div className="alert" role="alert">{error} <button type="button" onClick={() => void refresh()}>Tentar agora</button></div>}
    {orders.length === 0 ? <div className="empty"><div className="empty-icon">◌</div><h2>Nenhum pedido ativo</h2><p>Crie um pedido de teste para começar a simulação.</p><Link className="button secondary" to="/orders/new">Criar pedido</Link></div> :
      <div className="order-grid">{orders.map(order => <OrderCard order={order} refresh={refresh} key={order.id} />)}</div>}
  </div>;
}
