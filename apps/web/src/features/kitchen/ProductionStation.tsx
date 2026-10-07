import { useEffect, useState } from 'react';
import type { OperationalSession, Order, PizzaItem } from '@guigs/shared';
import { OperationalHeader } from '../../components/OperationalHeader';
import { useOperatorSession } from './useOperatorSession';
import { OperatorPin } from './components/OperatorPin';
import { useOperationalFlow } from './useOperationalFlow';
import { RouteStaging } from './RouteStaging';
import { OrderContext, pizzaCount } from './OrderContext';
import { PhysicalPizzaSummary } from '../dispatch/PhysicalPizzaSummary';
import { ovenQueues, ovenTiming, elapsedSeconds, formatDuration } from '../oven/oven';
import type { SessionCredentials } from './operatorSession';
import './assembly.css';
import '../oven/oven.css';
import '../finishing/finishing.css';
import './operational-flow.css';

export function ProductionStation() {
  const auth = useOperatorSession();
  if (!auth.session || !auth.credentials) return <OperatorPin {...auth} module="Forno e Finalização" />;
  return <Station key={auth.session.sessionId} session={auth.session} credentials={auth.credentials} authBusy={auth.busy} authError={auth.error} end={auth.end} />;
}
function Station({ session, credentials, authBusy, authError, end }: { session: OperationalSession; credentials: SessionCredentials; authBusy: boolean; authError: string; end: () => Promise<void> }) {
  const queue = useOperationalFlow(credentials, session.sessionId), [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const serverNow = now + (queue.config?.offset ?? 0), oven = ovenQueues(queue.orders);
  const finishing = queue.orders.flatMap(order => order.items.flatMap(pizza => pizza.kind === 'PIZZA' && ['BAKED', 'FINISHING'].includes(pizza.production.state) ? [{ order, pizza }] : []));
  const enabled = queue.canAct && !authBusy && !authError && session.presenceStatus === 'ONLINE';
  const settings = queue.productionSettings;
  function act(order: Order, pizza: PizzaItem, command: string) {
    queue.command(`/orders/v2/${order.id}/pizzas/${pizza.id}/commands`, { command, expectedState: pizza.production.state, expectedVersion: pizza.production.version });
  }
  return <section className="oven-page production-station flow-workspace">
    <OperationalHeader title="Forno e Finalização" operator={session.operatorName} connection={queue.connection} actions={<>
      <h2>Estação de produção</h2><button type="button" aria-pressed={settings?.autoOvenEntry ?? true} disabled={!enabled || !settings} onClick={() => settings && queue.command('/kitchen/production/settings/commands', { command: 'SET_AUTO_OVEN_ENTRY', autoOvenEntry: !settings.autoOvenEntry, expectedVersion: settings.version })}>Entrada automática no forno <span>{settings?.autoOvenEntry === false ? 'Desativada' : 'Ativada'}</span></button>
      <p>Preferência compartilhada da produção.</p><button type="button" disabled={authBusy || queue.busy || queue.pending} onClick={() => void end()}>Encerrar turno</button>
    </>} />
    <div className="oven-toolbar flow-production-strip"><span>Forno <strong>{queue.config?.ovenOccupancy ?? oven.inside.length}</strong>{queue.config?.ovenCapacity ? ` / ${queue.config.ovenCapacity} · capacidade indicativa` : ''}</span><span>Entrada {settings?.autoOvenEntry === false ? 'manual' : 'automática'}</span>{oven.inside.some(({ pizza }) => ['REACHED', 'OVER'].includes(ovenTiming(pizza, serverNow).phase)) && <strong className="flow-pending" role="status">Há pizzas no tempo de saída</strong>}{queue.error && <button className="button secondary" disabled={queue.refreshing || queue.busy} onClick={queue.reload}>Tentar novamente</button>}</div>
    {(queue.error || authError) && <p className="oven-alert" role="alert">{queue.error} {authError}</p>}{queue.notice && <p role="status" className="oven-notice">{queue.notice}</p>}{queue.pending && <button className="button secondary" disabled={queue.busy || queue.connection !== 'ONLINE'} onClick={queue.retry}>Confirmar envio</button>}{queue.loading && <p role="status">Carregando produção…</p>}
    <div className="oven-columns flow-production-columns">
      <section className="oven-column"><h2>No forno <span>{oven.inside.length}</span></h2><div className="oven-cards flow-scroll" tabIndex={0} aria-label="Lista do forno">
        {oven.inside.map(({ order, pizza }) => { const timing = ovenTiming(pizza, serverNow); return <article className={`oven-card oven-time-${timing.phase.toLowerCase()}`} data-pizza-id={pizza.id} key={pizza.id}>
          <OrderContext order={order} now={serverNow} /><PhysicalPizzaSummary pizza={pizza} total={pizzaCount(order)} />
          <div className="oven-clock"><strong>{formatDuration(timing.elapsed)}</strong><span>{timing.duration ? `Previsto ${formatDuration(timing.duration)}` : 'Sem previsão histórica'} · {({ NORMAL: 'No tempo', NEAR: 'Próxima da saída', REACHED: 'Tempo previsto atingido', OVER: 'Tempo excedido' })[timing.phase]}</span></div>
          <button className="button primary" disabled={!enabled} onClick={() => act(order, pizza, 'REMOVE_FROM_OVEN')}>Retirar do forno</button>
        </article>; })}{!oven.inside.length && <p className="oven-empty">Nenhuma pizza no forno</p>}
        {oven.waiting.length > 0 && <section className="flow-waiting"><h3>Aguardando entrada <span>{oven.waiting.length}</span></h3>{oven.waiting.map(({ order, pizza }) => <article className="oven-card" data-pizza-id={pizza.id} key={pizza.id}>
          <OrderContext order={order} now={serverNow} /><PhysicalPizzaSummary pizza={pizza} total={pizzaCount(order)} /><button className="button secondary" disabled={!enabled} onClick={() => act(order, pizza, 'ENTER_OVEN')}>Colocar no forno</button>
        </article>)}</section>}
      </div></section>
      <section className="oven-column"><h2>Acabamento <span>{finishing.length}</span></h2><div className="oven-cards flow-scroll" tabIndex={0} aria-label="Lista de acabamento">
        {finishing.map(({ order, pizza }) => <article className="oven-card finishing-item" data-pizza-id={pizza.id} key={pizza.id}>
          <OrderContext order={order} now={serverNow} /><PhysicalPizzaSummary pizza={pizza} total={pizzaCount(order)} /><p className="physical-pizza-meta">{pizza.production.bakedAt ? `Saída há ${formatDuration(elapsedSeconds(pizza.production.bakedAt, serverNow))}` : 'Horário de saída não registrado'}</p>
          <button className="button primary" disabled={!enabled} onClick={() => act(order, pizza, 'FINISH_PIZZA')}>Finalizar pizza</button>
        </article>)}{!finishing.length && <p className="oven-empty">Nenhuma pizza em acabamento</p>}
      </div></section>
    </div>
    <RouteStaging routes={queue.routes} orders={queue.orders} command={queue.command} enabled={enabled} now={serverNow} dock />
  </section>;
}
