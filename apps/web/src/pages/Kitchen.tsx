import { useEffect, useState } from 'react';
import type { PizzaItem } from '@guigs/shared';
import { useOperationalFlow } from '../features/kitchen/useOperationalFlow';
import { elapsedSeconds, formatDuration } from '../features/oven/oven';
import { AssemblyIcon } from '../features/kitchen/components/AssemblyIcons';
import './kitchen-overview.css';
import { OperationalHeader } from '../components/OperationalHeader';
import { useOperatorSession } from '../features/kitchen/useOperatorSession';
import { OperatorPin } from '../features/kitchen/components/OperatorPin';
import { OrderContext } from '../features/kitchen/OrderContext';
const columns = [
  { title: 'Fila', states: ['WAITING_ASSEMBLY'], icon: 'queue' as const },
  { title: 'Em montagem', states: ['ASSEMBLING', 'ASSEMBLY_PAUSED'], icon: 'pizza' as const },
  { title: 'No forno', states: ['WAITING_OVEN', 'IN_OVEN', 'BAKED', 'FINISHING'], icon: 'oven' as const },
  { title: 'Finalizados', states: ['FINISHED'], icon: 'check' as const },
];
export function Kitchen() {
  const auth = useOperatorSession(), [identify, setIdentify] = useState(false);
  const queue = useOperationalFlow(), [now, setNow] = useState(Date.now()); useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const entries = queue.orders.filter(order => !['WAITING_DRIVER', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP'].includes(order.status)).flatMap(order => { const pizzas = order.items.filter((item): item is PizzaItem => item.kind === 'PIZZA' && item.production.state !== 'CANCELLED'); return pizzas.map(pizza => ({ order, pizza, count: pizzas.length, finished: pizzas.filter(item => item.production.state === 'FINISHED').length })); });
  if (identify && !auth.session) return <OperatorPin {...auth} module="Visão geral" />;
  return <section className="page kitchen-board"><OperationalHeader title="Visão geral" operator={auth.session?.operatorName} connection={queue.connection} actions={!auth.session && <button type="button" disabled={auth.busy} onClick={() => setIdentify(true)}>Identificar operador</button>} />{queue.error && <button className="button subtle" disabled={queue.refreshing} onClick={queue.reload}>Tentar novamente</button>}{queue.error && <p className="alert" role="alert">{queue.error}</p>}{auth.error && <p className="alert" role="alert">{auth.error}</p>}{queue.loading && <p role="status">Carregando produção…</p>}
    <div className="kb-columns">{columns.map(column => { const values = entries.filter(({ pizza }) => column.states.includes(pizza.production.state)); return <section className="kb-column" key={column.title} aria-label={column.title}><h2><AssemblyIcon name={column.icon} />{column.title}<span>{values.length}</span></h2><div className="kb-cards">{values.map(({ order, pizza, count, finished }) => { const route = queue.routes.find(route => route.items.some(item => item.pizzaId === pizza.id)), state = pizza.production.state; return <article className="kb-card" data-pizza-id={pizza.id} key={pizza.id}><OrderContext order={order} now={now + (queue.config?.offset ?? 0)} /><span>Pizza {pizza.position + 1} de {count}</span>{['ASSEMBLING', 'ASSEMBLY_PAUSED'].includes(state) && <small>{pizza.assignment?.operatorName ?? 'Sem montador'}{state === 'ASSEMBLY_PAUSED' ? ' · Pausada' : ''}</small>}{state === 'IN_OVEN' && <b className="kb-time">{formatDuration(elapsedSeconds(pizza.production.ovenStartedAt!, now + (queue.config?.offset ?? 0)))}</b>}{['BAKED', 'FINISHING'].includes(state) && <small>Acabamento</small>}{state === 'WAITING_OVEN' && <small>Aguardando entrada</small>}{state === 'FINISHED' && <small>{route ? `Rota ${String(route.routeNumber).padStart(2, '0')}` : 'Sem rota'}</small>}<small>{finished}/{count} finalizadas</small></article>; })}{!values.length && !queue.loading && <p className="kb-empty">Sem pizzas</p>}</div></section>; })}</div>
  </section>;
}
