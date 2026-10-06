import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FinishingCommandInput, Order, OperationalSession } from '@guigs/shared';
import { clientId } from '../../utils/clientId';
import { useOperatorSession } from '../kitchen/useOperatorSession';
import { OperatorPin } from '../kitchen/components/OperatorPin';
import type { SessionCredentials } from '../kitchen/operatorSession';
import { ovenFlavor, elapsedSeconds, formatDuration } from '../oven/oven';
import { finishingQueue, finishingProgress } from './finishing';
import { useFinishing } from './useFinishing';
import '../kitchen/assembly.css';
import '../oven/oven.css';
import './finishing.css';

const stateLabels = { WAITING_ASSEMBLY: 'Aguardando montagem', ASSEMBLING: 'Em montagem', ASSEMBLY_PAUSED: 'Montagem pausada', WAITING_OVEN: 'Aguardando forno', IN_OVEN: 'No forno', BAKED: 'Disponível', FINISHING: 'Em conferência', FINISHED: 'Conferida', CANCELLED: 'Cancelada' };
const channels = { COUNTER: 'Balcão', WHATSAPP: 'WhatsApp', IFOOD: 'iFood', OTHER: 'Outro' };
export function FinishingPage() {
  const auth = useOperatorSession();
  if (!auth.session || !auth.credentials) return <OperatorPin {...auth} module="finalização" />;
  return <OperationalFinishing key={auth.session.sessionId} session={auth.session} credentials={auth.credentials} sessionBusy={auth.busy} sessionError={auth.error} end={auth.end} setAvailability={auth.setAvailability} />;
}
function OperationalFinishing({ session, credentials, sessionBusy, sessionError, end, setAvailability }: { session: OperationalSession; credentials: SessionCredentials; sessionBusy: boolean; sessionError: string; end: () => Promise<void>; setAvailability: (available: boolean) => Promise<void> }) {
  const queue = useFinishing(credentials, session.sessionId), [selected, setSelected] = useState<string | null>(null), [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const orders = finishingQueue(queue.orders), order = orders.find(order => order.id === selected) ?? orders[0];
  const enabled = queue.canAct && !sessionBusy && !sessionError && session.presenceStatus === 'ONLINE';
  return <section className="oven-page finishing-page">
    <header className="oven-header"><div><h1>Finalização</h1><p aria-label="Identidade operacional">{session.operatorName} • {session.workstationName} • {session.presenceStatus === 'ONLINE' ? 'Presença válida' : 'Confirme presença'}</p></div><div className="oven-header-actions">
      <span role="status" aria-label="Conexão Finalização" className={`oven-connection oven-connection-${queue.connection.toLowerCase()}`}>{({ ONLINE: 'Online', RECONNECTING: 'Reconectando', OFFLINE: 'Offline' })[queue.connection]}</span>
      <button className="button secondary" disabled={queue.busy || queue.pending || sessionBusy} onClick={() => void end()}>Encerrar turno</button><Link className="button subtle" to="/kitchen/oven">Forno</Link><Link className="button subtle" to="/">Balcão</Link></div></header>
    <div className="oven-toolbar"><p>Fila compartilhada · conferir todos os itens antes de liberar</p><button className="button secondary" disabled={queue.refreshing || queue.busy} onClick={queue.reload}>{queue.refreshing ? 'Atualizando...' : 'Atualizar'}</button>
      <button className="button subtle" aria-label="Receber novas pizzas de montagem" aria-pressed={session.available} disabled={sessionBusy || queue.busy || queue.pending} onClick={() => void setAvailability(!session.available)}>{session.available ? 'Recebendo montagem · suspender' : 'Montagem suspensa · retomar'}</button></div>
    {session.available && <p className="oven-hint">Se atuar somente na finalização, suspenda o recebimento de novas pizzas de montagem nesta sessão.</p>}
    {(queue.error || sessionError) && <p role="alert" className="oven-alert">{queue.error} {sessionError}</p>}{queue.notice && <p role="status" className="oven-notice">{queue.notice}</p>}
    {queue.pending && <button className="button secondary" disabled={queue.busy || queue.connection !== 'ONLINE' || sessionBusy} onClick={queue.retry}>Confirmar comando novamente</button>}
    {queue.loading && <p role="status">Carregando finalização...</p>}
    <div className="finishing-columns"><aside className="finishing-queue" aria-label="Pedidos de finalização"><h2>Pedidos <span>{orders.length}</span></h2><p className="oven-sort">Item pronto há mais tempo primeiro</p>
      {orders.map(value => { const progress = finishingProgress(value); return <button key={value.id} className={`finishing-order${order?.id === value.id ? ' selected' : ''}`} aria-pressed={order?.id === value.id} aria-label={`Pedido #${value.number}, ${progress.checked}/${progress.total} conferidos`} onClick={() => setSelected(value.id)}><strong>#{value.number} · {value.customerName}</strong><span>{progress.checked} / {progress.total} itens conferidos</span><span>{progress.available} / {progress.pizzas} pizzas disponíveis</span></button>; })}
      {!orders.length && !queue.loading && <p className="oven-empty">Nenhum pedido aguardando finalização</p>}</aside>
      {order ? <OrderConference key={order.id} order={order} now={now} enabled={enabled} act={input => queue.command(order.id, input)} /> : <div className="oven-empty">Aguardando pizzas assadas</div>}</div>
  </section>;
}
function OrderConference({ order, now, enabled, act }: { order: Order; now: number; enabled: boolean; act: (input: FinishingCommandInput) => void }) {
  const progress = finishingProgress(order), common = () => ({ expectedVersion: order.version, clientCommandId: clientId() });
  return <section className="finishing-detail" aria-label={`Conferência do pedido #${order.number}`} data-order-version={order.version}>
    <header><h2>Pedido #{order.number}</h2><p>{order.customerName} · {({ DELIVERY: 'Delivery', PICKUP: 'Retirada', COUNTER: 'Balcão' })[order.fulfillmentType]} · {channels[order.channel]}</p><p>{progress.pizzas} pizzas · {progress.extraUnits} unidades de extras ({progress.extraTypes} tipos) · desde criação {formatDuration(elapsedSeconds(order.createdAt, now))}</p><strong>{progress.checked} / {progress.total} itens conferidos · {progress.available} / {progress.pizzas} pizzas disponíveis</strong>{order.notes && <p className="oven-notes">Pedido: {order.notes}</p>}</header>
    <h3>Pizzas</h3><div className="finishing-items">{order.items.filter(item => item.kind === 'PIZZA').map(pizza => <article className={`finishing-item ${pizza.production.state === 'FINISHED' ? 'checked' : ''}`} key={pizza.id} data-pizza-id={pizza.id}>
      <h4>Pizza {pizza.position + 1} · {ovenFlavor(pizza)}</h4><p>{pizza.snapshot.size === 'BROTO' ? 'Broto' : 'Grande'} · {pizza.snapshot.composition === 'HALF_HALF' ? 'Meio a meio' : 'Inteira'} · Borda: {pizza.snapshot.crust.name}</p>
      <p className="finishing-state">{stateLabels[pizza.production.state]}{pizza.production.bakedAt ? ` · saída do forno ${new Date(pizza.production.bakedAt).toLocaleTimeString('pt-BR')}` : ''}</p>{pizza.snapshot.notes && <p className="oven-notes">{pizza.snapshot.notes}</p>}
      {pizza.production.state === 'BAKED' && <button className="button secondary" disabled={!enabled} onClick={() => act({ ...common(), command: 'START_FINISHING', pizzaId: pizza.id, expectedItemVersion: pizza.production.version })}>Iniciar conferência</button>}
      {pizza.production.state === 'FINISHING' && <button className="button primary" disabled={!enabled} onClick={() => act({ ...common(), command: 'CHECK_PIZZA', pizzaId: pizza.id, expectedItemVersion: pizza.production.version })}>Conferir pizza</button>}
      {pizza.production.state === 'FINISHED' && <strong>✓ Pizza conferida</strong>}
    </article>)}</div>
    <h3>Extras, bebidas e complementos</h3><div className="finishing-items">{order.items.filter(item => item.kind === 'EXTRA').map(extra => <article className={`finishing-item ${extra.state === 'FINISHED' ? 'checked' : ''}`} key={extra.id} data-extra-id={extra.id}><h4>{extra.quantity}× {extra.snapshot.name}</h4><p>{extra.checkedQuantity} / {extra.quantity} unidades conferidas{extra.state === 'CANCELLED' ? ' · Cancelado' : ''}</p>{extra.notes && <p className="oven-notes">{extra.notes}</p>}
      {extra.state === 'WAITING_FINISHING' && <button className="button secondary" disabled={!enabled} onClick={() => act({ ...common(), command: 'CHECK_EXTRA', extraId: extra.id, expectedItemVersion: extra.version, checkedQuantity: extra.checkedQuantity + 1 })}>Conferir 1 unidade</button>}{extra.state === 'FINISHED' && <strong>✓ Extra conferido</strong>}</article>)}{!progress.extraTypes && <p>Pedido sem extras</p>}</div>
    <div className="finishing-release"><button className="button secondary" disabled={!enabled || !progress.allChecked || Boolean(order.packingFinishedAt)} onClick={() => act({ ...common(), command: 'CONFIRM_PACKAGING' })}>{order.packingFinishedAt ? '✓ Embalagem conferida' : 'Confirmar embalagem'}</button>
      <button className="button primary" disabled={!enabled || !progress.canRelease} onClick={() => act({ ...common(), command: 'RELEASE_TO_DISPATCH' })}>Liberar para despacho</button>{!progress.canRelease && <p>Confira todas as pizzas, todas as unidades dos extras e a embalagem.</p>}</div>
  </section>;
}
