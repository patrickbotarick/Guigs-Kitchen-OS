import { useEffect, useState } from 'react';
import { pizzasOf, sortOrders } from '../assembly';
import { AssemblyIcon } from '../components/AssemblyIcons';
import { CurrentOrder } from '../components/CurrentOrder';
import { OrderQueue } from '../components/OrderQueue';
import { PizzaDetail } from '../components/PizzaDetail';
import { useAssembly } from '../useAssembly';

export function KitchenAssemblyPage() {
  const { state, dispatch, mode, loading, refreshing, error, reload } = useAssembly();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);
  const order = state.orders.find(order => order.id === state.selectedOrderId);
  const pizzas = order ? pizzasOf(order) : [];
  const pizza = pizzas.find(pizza => pizza.id === state.selectedPizzaIds[order?.id ?? '']) ?? pizzas[0];
  return <div className="ka-screen" aria-label="Fila de Montagem">
    <OrderQueue orders={sortOrders(state.orders, state.sortDirection)} sortDirection={state.sortDirection} onToggleSort={() => dispatch({ type: 'TOGGLE_SORT' })} selectedId={state.selectedOrderId} now={now} onSelect={orderId => dispatch({ type: 'SELECT_ORDER', orderId })} mode={mode} loading={loading} refreshing={refreshing} error={error} reload={reload} />
    {order && pizza ? <>
      <CurrentOrder order={order} selectedPizzaId={pizza.id} now={now} readOnly={mode === 'API'} onSelectPizza={pizzaId => dispatch({ type: 'SELECT_PIZZA', orderId: order.id, pizzaId })} onCompleteAssembly={() => dispatch({ type: 'COMPLETE_ASSEMBLY', orderId: order.id, occurredAt: new Date().toISOString() })} />
      <PizzaDetail key={pizza.id} pizza={pizza} readOnly={mode === 'API'} onAction={action => dispatch({ type: 'PIZZA_ACTION', orderId: order.id, pizzaId: pizza.id, action })} />
    </> : <section className="ka-empty"><AssemblyIcon name="checkCircle" /><h1>{loading ? 'Carregando pedidos...' : error ? 'API indisponível' : mode === 'API' ? 'Nenhum pedido aguardando montagem' : 'Fila de montagem em dia'}</h1><p>{error ? 'Use Atualizar para tentar novamente. A fila de demonstração não substitui pedidos reais.' : 'Novos pedidos aparecerão aqui.'}</p></section>}
    <div className="ka-sr-only" role="status">{state.notice}</div>
  </div>;
}
