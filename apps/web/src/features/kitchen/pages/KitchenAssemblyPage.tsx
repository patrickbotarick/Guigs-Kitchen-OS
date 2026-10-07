import { OperationalFilter } from '../../../components/OperationalFilter';
import { StationIdentity } from '../../../components/StationIdentity';
import { AssemblyStationMenu } from '../components/AssemblyStationMenu';
import { useEffect, useState } from 'react';
import { pizzasOf, sortOrders } from '../assembly';
import { AssemblyIcon } from '../components/AssemblyIcons';
import { CurrentOrder } from '../components/CurrentOrder';
import { OrderQueue } from '../components/OrderQueue';
import { PizzaDetail } from '../components/PizzaDetail';
import { useAssembly } from '../useAssembly';

export function KitchenAssemblyPage() {
  const { state, dispatch, mode, loading, refreshing, error, reload, performCommand, commandBusy, pendingCommand, sessionBusy, operatorSession, connection } = useAssembly();
  const [queueFilter, setQueueFilter] = useState<'ALL' | 'MINE' | 'AVAILABLE'>(mode === 'API' ? 'MINE' : 'ALL');
  const visibleOrders = state.orders.map(order => ({ ...order, items: order.items.filter(pizza => queueFilter === 'ALL' || (['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'].includes(pizza.status) && (queueFilter === 'MINE' ? pizza.assignment?.operatorId === operatorSession?.operatorId : !pizza.assignment))) })).filter(order => order.items.length);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);
  const order = visibleOrders.find(order => order.id === state.selectedOrderId) ?? visibleOrders[0];
  const pizzas = order ? pizzasOf(order) : [];
  const pizza = pizzas.find(pizza => pizza.id === state.selectedPizzaIds[order?.id ?? '']) ?? pizzas[0];
  return <div className="ka-screen" aria-label="Fila de Montagem">
    <div className="ka-queue-wrapper">{mode === 'API' && <OperationalFilter label="Filtrar pizzas" value={queueFilter} onChange={setQueueFilter} options={[{ value: 'ALL', label: 'Fila geral' }, { value: 'MINE', label: 'Minhas pizzas' }, { value: 'AVAILABLE', label: 'Disponíveis' }]} />}
    <OrderQueue orders={sortOrders(visibleOrders, state.sortDirection)} sortDirection={state.sortDirection} onToggleSort={() => dispatch({ type: 'TOGGLE_SORT' })} selectedId={order?.id ?? null} now={now} onSelect={orderId => dispatch({ type: 'SELECT_ORDER', orderId })} mode={mode} loading={loading} refreshing={refreshing} error={error} reload={reload} /><AssemblyStationMenu /></div>
    {order && pizza ? <>
      <CurrentOrder order={state.orders.find(value => value.id === order.id)!} visiblePizzaIds={pizzas.map(value => value.id)} selectedPizzaId={pizza.id} now={now} readOnly={mode === 'API'} onSelectPizza={pizzaId => dispatch({ type: 'SELECT_PIZZA', orderId: order.id, pizzaId })} onCompleteAssembly={() => dispatch({ type: 'COMPLETE_ASSEMBLY', orderId: order.id, occurredAt: new Date().toISOString() })} />
      <div className="ka-detail-wrapper"><StationIdentity operator={operatorSession?.operatorName} connection={connection} /><PizzaDetail key={pizza.id} pizza={pizza} operatorId={operatorSession?.operatorId} busy={commandBusy || pendingCommand || sessionBusy} onAction={action => performCommand(order.id, pizza.id, action)} /></div>
    </> : <section className="ka-empty"><StationIdentity operator={operatorSession?.operatorName} connection={connection} /><AssemblyIcon name="checkCircle" /><h1>{loading ? 'Carregando pedidos...' : error ? 'API indisponível' : queueFilter !== 'ALL' ? 'Nenhuma pizza neste filtro' : mode === 'API' ? 'Nenhum pedido aguardando montagem' : 'Fila de montagem em dia'}</h1><p>{error ? 'Use Tentar novamente para recuperar a conexão.' : queueFilter !== 'ALL' ? 'Use Fila geral para visualizar os demais pedidos.' : 'Novos pedidos aparecerão aqui.'}</p></section>}
    <div className="ka-sr-only" role="status">{state.notice}</div>
  </div>;
}
