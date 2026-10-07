import { OperationalHeader } from '../../components/OperationalHeader';
import { useEffect, useState } from 'react';
import { OrderContext } from '../kitchen/OrderContext';
import { routeConference } from './routeConference';
import type { Order, OperationalSession, DispatchRouteView } from '@guigs/shared';
import { useOperatorSession } from '../kitchen/useOperatorSession';
import { OperatorPin } from '../kitchen/components/OperatorPin';

import { useOperationalFlow } from '../kitchen/useOperationalFlow';
import { RouteStaging } from '../kitchen/RouteStaging';
import type { SessionCredentials } from '../kitchen/operatorSession';
import { PhysicalPizzaSummary } from './PhysicalPizzaSummary';
import '../kitchen/assembly.css';
import '../oven/oven.css';
import '../finishing/finishing.css';
import '../kitchen/operational-flow.css';
type Command = (path: string, body: Record<string, unknown>) => void;
export function CounterDispatchPage() { const auth = useOperatorSession(); if (!auth.session || !auth.credentials) return <OperatorPin {...auth} module="Balcão · Despacho" />; return <Counter key={auth.session.sessionId} session={auth.session} credentials={auth.credentials} authBusy={auth.busy} authError={auth.error} end={auth.end} />; }
function Counter({ session, credentials, authBusy, authError, end }: { session: OperationalSession; credentials: SessionCredentials; authBusy: boolean; authError: string; end: () => Promise<void> }) {
  const selectionKey = `guigs-counter-route-${session.sessionId}`;
  const queue = useOperationalFlow(credentials, session.sessionId), [selected, setSelected] = useState(() => { try { return sessionStorage.getItem(selectionKey) ?? ''; } catch { return ''; } }), [now, setNow] = useState(Date.now());
  useEffect(() => { try { sessionStorage.setItem(selectionKey, selected); } catch { /* Selection remains usable without browser storage. */ } }, [selectionKey, selected]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const enabled = queue.canAct && !authBusy && !authError && session.presenceStatus === 'ONLINE', serverNow = now + (queue.config?.offset ?? 0);
  const route = selected === 'legacy' ? undefined : queue.routes.find(value => value.id === selected) ?? queue.routes.find(value => value.status === 'CLOSED') ?? queue.routes.find(value => value.status === 'OPEN') ?? queue.routes[0];
  useEffect(() => { if (!selected && route) setSelected(route.id); }, [selected, route]);
  const outgoing = queue.orders.filter(order => ['OUT_FOR_DELIVERY', 'READY_FOR_PICKUP'].includes(order.status) && (!route || route.items.some(item => item.orderId === order.id)));
  return <section className="oven-page counter-dispatch flow-workspace">
    <OperationalHeader title="Balcão" operator={session.operatorName} connection={queue.connection} actions={<button type="button" disabled={authBusy || queue.busy || queue.pending} onClick={() => void end()}>Encerrar turno</button>} />
    {(queue.error || authError) && <p role="alert" className="oven-alert">{queue.error} {authError}</p>}{queue.error && <button className="button secondary" disabled={queue.refreshing || queue.busy} onClick={queue.reload}>Tentar novamente</button>}{queue.notice && <p role="status" className="oven-notice">{queue.notice}</p>}{queue.pending && <button className="button secondary" disabled={queue.busy || queue.connection !== 'ONLINE'} onClick={queue.retry}>Confirmar envio</button>}{queue.loading && <p role="status">Carregando rotas…</p>}
    <div className="flow-counter-layout">
      <aside className="flow-route-sidebar" aria-label="Lista de rotas"><header><h2>Rotas</h2><button className="button secondary" disabled={!enabled} onClick={() => queue.command('/dispatch/routes/commands', { command: 'CREATE' })}>Criar rota</button></header><div className="flow-scroll" tabIndex={0}>
        {queue.routes.map(value => { const summary = routeConference(value, queue.orders); return <button key={value.id} className="flow-route-choice" aria-label={`Selecionar rota ${value.routeNumber}`} aria-pressed={route?.id === value.id} onClick={() => setSelected(value.id)}><strong>Rota {String(value.routeNumber).padStart(2, '0')}</strong><span>{value.status === 'OPEN' ? 'Aberta' : value.status === 'CLOSED' ? 'Fechada' : 'Saída registrada'}</span><small>{new Set(value.items.map(item => item.orderId)).size} pedidos · {value.items.length} pizzas</small>{value.status === 'CLOSED' && <small className="flow-pending">{summary.pending} pedidos pendentes</small>}</button>; })}
        <button className="flow-route-choice" aria-pressed={selected === 'legacy'} onClick={() => setSelected('legacy')}>Saídas sem rota / anteriores</button>
      </div></aside>
      <div className="flow-selected-route">
        {route?.status === 'CLOSED' ? <ClosedRoute route={route} orders={queue.orders} command={queue.command} enabled={enabled} now={serverNow} /> : route?.status === 'OPEN' ? <RouteStaging routes={queue.routes} orders={queue.orders} command={queue.command} enabled={enabled} counter embedded selectedRouteId={route.id} /> : <section className="flow-outgoing flow-scroll"><h2>{route ? `Rota ${String(route.routeNumber).padStart(2, '0')} · saída registrada` : 'Saídas sem rota / anteriores'}</h2>
          <div className="flow-counter-orders">{outgoing.map(order => <article className="flow-counter-order" key={order.id}><OrderContext order={order} now={serverNow} /><p>{order.status === 'OUT_FOR_DELIVERY' ? 'Em rota' : 'Pronto para retirada'}</p><button className="button primary" disabled={!enabled} onClick={() => queue.command(`/orders/v2/${order.id}/dispatch/commands`, { command: order.status === 'OUT_FOR_DELIVERY' ? 'MARK_DELIVERED' : 'MARK_PICKED_UP', expectedVersion: order.version })}>{order.status === 'OUT_FOR_DELIVERY' ? 'Confirmar entrega' : 'Confirmar retirada'}</button></article>)}</div>
          {!outgoing.length && <p className="oven-empty">{route ? 'Composição e histórico preservados. Nenhuma saída pendente nesta rota.' : 'Nenhuma saída sem rota selecionada.'}</p>}
          {!route && queue.orders.filter(order => order.operationalFlowVersion !== 2 && ['WAITING_DISPATCH', 'WAITING_DRIVER'].includes(order.status)).map(order => <article className="flow-counter-order" key={order.id}><OrderContext order={order} now={serverNow} /><button className="button secondary" disabled={!enabled} onClick={() => queue.command(`/orders/v2/${order.id}/dispatch/commands`, { command: order.fulfillmentType === 'PICKUP' ? 'MARK_READY_FOR_PICKUP' : order.status === 'WAITING_DISPATCH' ? 'MARK_WAITING_DRIVER' : 'MARK_OUT_FOR_DELIVERY', expectedVersion: order.version })}>{order.fulfillmentType === 'PICKUP' ? 'Preparar retirada' : order.status === 'WAITING_DISPATCH' ? 'Aguardar entregador' : 'Registrar saída'}</button></article>)}
        </section>}
      </div>
    </div>
  </section>;
}
function ClosedRoute({ route, orders, enabled, command, now }: { route: DispatchRouteView; orders: Order[]; enabled: boolean; command: Command; now: number }) {
  const summary = routeConference(route, orders);
  return <section className="flow-routes flow-conference" aria-label={`Rota fechada ${route.routeNumber}`}><header className="flow-section-heading"><h2>Rota {String(route.routeNumber).padStart(2, '0')}</h2><span>{summary.involved.length} pedidos · {route.items.length} pizzas</span></header>
    <div className="flow-conference-summary" aria-label="Resumo da conferência"><strong>{summary.checkedPizzas}/{summary.pizzas} pizzas</strong><strong>{summary.checkedExtras}/{summary.extras} extras</strong><strong>{summary.packing}/{summary.involved.length} embalagens</strong><span className="flow-pending">{summary.pending} pedidos pendentes</span></div>
    <div className="flow-counter-orders flow-scroll" tabIndex={0} aria-label="Pedidos da rota">{summary.involved.map(order => <Conference key={order.id} order={order} route={route} enabled={enabled} command={command} now={now} />)}</div>
    <footer className="flow-counter-actions"><button className="button primary" disabled={!enabled || !summary.complete} onClick={() => { if (window.confirm('Registrar saída desta rota? A composição será encerrada.')) command(`/dispatch/routes/${route.id}/commands`, { command: 'DISPATCH', expectedVersion: route.version }); }}>Registrar saída da rota</button><button className="button secondary" disabled={!enabled} onClick={() => command(`/dispatch/routes/${route.id}/commands`, { command: 'REOPEN', expectedVersion: route.version })}>Reabrir rota</button>{!summary.complete && <p className="flow-pending">Confira pizzas, extras e embalagem. Pedidos parciais não podem sair.</p>}</footer>
  </section>;
}
function Conference({ order, route, enabled, command, now }: { order: Order; route: DispatchRouteView; enabled: boolean; command: Command; now: number }) {
  const act = (body: Record<string, unknown>) => command(`/counter/orders/${order.id}/conference/commands`, { expectedVersion: order.version, ...body });
  const pizzas = order.items.filter(item => item.kind === 'PIZZA' && item.production.state !== 'CANCELLED'), extras = order.items.filter(item => item.kind === 'EXTRA' && item.state !== 'CANCELLED');
  const all = pizzas.every(pizza => pizza.kind === 'PIZZA' && pizza.production.state === 'FINISHED' && Boolean(pizza.counterCheckedAt || order.operationalFlowVersion !== 2) && route.items.some(item => item.pizzaId === pizza.id)) && extras.every(extra => extra.kind === 'EXTRA' && extra.checkedQuantity === extra.quantity);
  const mutable = enabled && !['WAITING_DRIVER', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'DELIVERED', 'PICKED_UP'].includes(order.status);
  return <article className="flow-counter-order" data-order-id={order.id}><OrderContext order={order} now={now} /><p>{pizzas.length} pizzas</p>{pizzas.map(pizza => pizza.kind === 'PIZZA' && <div className="flow-counter-line" key={pizza.id}><PhysicalPizzaSummary pizza={pizza} total={pizzas.length} /><span>{pizza.production.state !== 'FINISHED' ? 'Produção pendente' : !route.items.some(item => item.pizzaId === pizza.id) ? 'Fora desta rota' : pizza.counterCheckedAt || order.operationalFlowVersion !== 2 ? 'Conferida no Balcão' : 'A conferir'}</span>{pizza.production.state === 'FINISHED' && order.operationalFlowVersion === 2 && route.items.some(item => item.pizzaId === pizza.id) && <button className="button secondary" disabled={!mutable} onClick={() => { if (!pizza.counterCheckedAt || window.confirm('Desfazer a conferência desta pizza e embalagem?')) act({ command: pizza.counterCheckedAt ? 'UNCHECK_PIZZA' : 'CHECK_PIZZA', pizzaId: pizza.id, expectedItemVersion: pizza.production.version }); }}>{pizza.counterCheckedAt ? 'Corrigir conferência' : 'Conferir pizza'}</button>}</div>)}
    <h4>Extras e bebidas</h4>{extras.map(extra => extra.kind === 'EXTRA' && <div className="flow-counter-line" key={extra.id}><strong>{extra.snapshot.name} · {extra.checkedQuantity}/{extra.quantity}</strong>{extra.checkedQuantity < extra.quantity && <button className="button secondary" disabled={!mutable} onClick={() => act({ command: 'CHECK_EXTRA', extraId: extra.id, expectedItemVersion: extra.version, checkedQuantity: extra.checkedQuantity + 1 })}>Conferir 1 unidade</button>}{extra.checkedQuantity > 0 && <button className="button subtle" disabled={!mutable} onClick={() => { if (window.confirm('Reduzir conferência e invalidar embalagem?')) act({ command: 'UNCHECK_EXTRA', extraId: extra.id, expectedItemVersion: extra.version, checkedQuantity: extra.checkedQuantity - 1 }); }}>Corrigir extra</button>}</div>)}{!extras.length && <p className="flow-counter-notice">Sem extras</p>}
    <button className="button secondary" disabled={!mutable || (!order.packingFinishedAt && !all)} onClick={() => { if (!order.packingFinishedAt || window.confirm('Desfazer conferência da embalagem?')) act({ command: order.packingFinishedAt ? 'UNCONFIRM_PACKAGING' : 'CONFIRM_PACKAGING' }); }}>{order.packingFinishedAt ? 'Corrigir embalagem' : 'Conferir embalagem'}</button>
    {order.status !== 'WAITING_DISPATCH' ? <button className="button primary" disabled={!mutable || !all || !order.packingFinishedAt} onClick={() => act({ command: 'RELEASE_TO_DISPATCH' })}>Pedido pronto para saída</button> : <strong>Pedido conferido · pronto para saída</strong>}{order.notes && <p className="oven-notes">{order.notes}</p>}
  </article>;
}
