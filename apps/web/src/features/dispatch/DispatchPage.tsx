import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DispatchCommandInput, Order, OperationalSession } from '@guigs/shared';
import { clientId } from '../../utils/clientId';
import { useOperatorSession } from '../kitchen/useOperatorSession';
import { OperatorPin } from '../kitchen/components/OperatorPin';
import { AssemblyIcon } from '../kitchen/components/AssemblyIcons';
import type { SessionCredentials } from '../kitchen/operatorSession';
import { elapsedSeconds, formatDuration } from '../oven/oven';
import { availableDispatchCommands, commandLabels, dispatchLabels, dispatchQueue, dispatchSummary, dispatchWaitingSeconds } from './dispatch';
import { useDispatch } from './useDispatch';
import '../kitchen/assembly.css';
import '../oven/oven.css';
import '../finishing/finishing.css';
import './dispatch.css';

const channels = { COUNTER: 'Balcão', WHATSAPP: 'WhatsApp', IFOOD: 'iFood', OTHER: 'Outro' };
export function DispatchPage() {
  const auth = useOperatorSession();
  if (!auth.session || !auth.credentials) return <OperatorPin {...auth} module="despacho" />;
  return <OperationalDispatch key={auth.session.sessionId} session={auth.session} credentials={auth.credentials} sessionBusy={auth.busy} sessionError={auth.error} end={auth.end} setAvailability={auth.setAvailability} />;
}
function OperationalDispatch({ session, credentials, sessionBusy, sessionError, end, setAvailability }: { session: OperationalSession; credentials: SessionCredentials; sessionBusy: boolean; sessionError: string; end: () => Promise<void>; setAvailability: (available: boolean) => Promise<void> }) {
  const queue = useDispatch(credentials, session.sessionId), [selected, setSelected] = useState<string | null>(null), [now, setNow] = useState(Date.now()), [filter, setFilter] = useState<'ALL' | 'DELIVERY' | 'PICKUP'>('ALL');
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const orders = dispatchQueue(queue.orders, filter), order = orders.find(order => order.id === selected) ?? orders[0];
  const enabled = queue.canAct && !sessionBusy && !sessionError && session.presenceStatus === 'ONLINE';
  return <section className="oven-page dispatch-page">
    <header className="oven-header"><div><h1><AssemblyIcon name="flag" />Despacho</h1><p aria-label="Identidade operacional">{session.operatorName} • {session.workstationName} • {session.presenceStatus === 'ONLINE' ? 'Presença válida' : 'Confirme presença'}</p></div><div className="oven-header-actions">
      <span role="status" aria-label="Conexão Despacho" className={`oven-connection oven-connection-${queue.connection.toLowerCase()}`}>{({ ONLINE: 'Online', RECONNECTING: 'Reconectando', OFFLINE: 'Offline' })[queue.connection]}</span>
      <button className="button secondary" disabled={queue.busy || queue.pending || sessionBusy} onClick={() => void end()}>Encerrar turno</button><Link className="button subtle" to="/kitchen/finishing">Finalização</Link><Link className="button subtle" to="/">Balcão</Link></div></header>
    <div className="oven-toolbar"><div role="group" aria-label="Tipo de atendimento">{(['ALL', 'DELIVERY', 'PICKUP'] as const).map(value => <button key={value} className="button subtle" aria-pressed={filter === value} onClick={() => setFilter(value)}>{({ ALL: 'Todos', DELIVERY: 'Delivery', PICKUP: 'Retirada / Balcão' })[value]}</button>)}</div><button className="button secondary" disabled={queue.refreshing || queue.busy} onClick={queue.reload}>{queue.refreshing ? 'Atualizando...' : 'Atualizar'}</button>
      <button className="button subtle" aria-label="Receber novas pizzas de montagem" aria-pressed={session.available} disabled={sessionBusy || queue.busy || queue.pending} onClick={() => void setAvailability(!session.available)}>{session.available ? 'Recebendo montagem · suspender' : 'Montagem suspensa · retomar'}</button></div>
    {session.available && <p className="oven-hint">Se atuar somente no despacho, suspenda o recebimento de novas pizzas de montagem nesta sessão.</p>}
    {(queue.error || sessionError) && <p role="alert" className="oven-alert">{queue.error} {sessionError}</p>}{queue.notice && <p role="status" className="oven-notice">{queue.notice}</p>}
    {queue.pending && <button className="button secondary" disabled={queue.busy || queue.connection !== 'ONLINE' || sessionBusy} onClick={queue.retry}>Confirmar comando novamente</button>}
    {queue.loading && <p role="status">Carregando despacho...</p>}
    <div className="finishing-columns"><aside className="finishing-queue" aria-label="Fila de despacho"><h2>Pedidos <span>{orders.length}</span></h2><p className="oven-sort">Aguardando despacho primeiro · mais antigo primeiro</p>
      {orders.map(value => <button key={value.id} className={`finishing-order dispatch-order${order?.id === value.id ? ' selected' : ''}`} aria-pressed={order?.id === value.id} aria-label={`Pedido #${value.number}, ${dispatchLabels[value.status]}`} onClick={() => setSelected(value.id)}><strong>#{value.number} · {value.customerName}</strong><span>{value.fulfillmentType === 'DELIVERY' ? 'Delivery' : 'Retirada'} · {channels[value.channel]}</span><span>{dispatchLabels[value.status]}</span><span>{value.dispatch?.dispatchReadyAt ? `Espera para saída ${formatDuration(dispatchWaitingSeconds(value, now)!)}` : 'Horário de liberação não registrado'}</span></button>)}
      {!orders.length && !queue.loading && <p className="oven-empty">Nenhum pedido neste filtro de despacho</p>}</aside>
      {order ? <DispatchDetail key={order.id} order={order} now={now} enabled={enabled} act={input => queue.command(order.id, input)} /> : <div className="oven-empty">Aguardando pedidos liberados pela Finalização</div>}</div>
  </section>;
}
function DispatchDetail({ order, now, enabled, act }: { order: Order; now: number; enabled: boolean; act: (input: DispatchCommandInput) => void }) {
  const summary = dispatchSummary(order);
  return <section className="finishing-detail dispatch-detail" aria-label={`Despacho do pedido #${order.number}`} data-order-version={order.version}>
    <header><h2>Pedido #{order.number}</h2><p>{order.customerName} · {order.fulfillmentType === 'DELIVERY' ? 'Delivery' : 'Retirada'} · Canal: {channels[order.channel]}</p>
      {order.fulfillmentType === 'DELIVERY' && order.customerPhone && <p>Telefone: {order.customerPhone}</p>}
      <p>Criado: {new Date(order.createdAt).toLocaleString('pt-BR')} · Tempo total: {formatDuration(elapsedSeconds(order.createdAt, now))}</p>
      <p>{order.dispatch?.dispatchReadyAt ? `Liberado pela Finalização: ${new Date(order.dispatch.dispatchReadyAt).toLocaleTimeString('pt-BR')} · Espera para saída: ${formatDuration(dispatchWaitingSeconds(order, now)!)}` : 'Horário da liberação não registrado neste pedido anterior.'}</p>
      <strong>{dispatchLabels[order.status]} · {summary.pizzas} {summary.pizzas === 1 ? 'pizza' : 'pizzas'} · {summary.extras.reduce((total, extra) => total + extra.quantity, 0)} unidades de extras</strong>
      {summary.extras.length > 0 && <p>Extras: {summary.extras.map(extra => `${extra.quantity}× ${extra.snapshot.name}`).join(' · ')}</p>}{order.notes && <p className="oven-notes">Pedido: {order.notes}</p>}</header>
    <div className="finishing-release">{availableDispatchCommands(order).map(command => <button key={command} className="button primary" disabled={!enabled} onClick={() => act({ command, expectedVersion: order.version, clientCommandId: clientId() })}>{commandLabels[command]}</button>)}</div>
  </section>;
}
