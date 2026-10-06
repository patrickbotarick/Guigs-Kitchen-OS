import { Link } from 'react-router-dom';
import { pizzasOf } from '../assembly';
import type { AssemblyOrder, OrderChannel, QueueSortDirection } from '../types';
import { AssemblyIcon } from './AssemblyIcons';
import { useAssembly } from '../useAssembly';
import { useState } from 'react';

export const channelLabels: Record<OrderChannel, string> = { IFOOD: 'iFood', WHATSAPP: 'WhatsApp', PICKUP: 'Retirada', COUNTER: 'Balcão', OTHER: 'Outro' };
export function ChannelBadge({ channel }: { channel: OrderChannel }) {
  return <span className={`ka-channel ka-channel-${channel.toLowerCase()}`}>{channelLabels[channel]}</span>;
}
export function WaitTime({ receivedAt, now }: { receivedAt: string; now: number }) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(receivedAt)) / 60_000));
  return <span className="ka-wait" aria-label={`${minutes} minutos de espera`}><AssemblyIcon name="clock" />{minutes} min</span>;
}
export function OrderCounts({ order }: { order: AssemblyOrder }) {
  const pizzas = pizzasOf(order).length;
  const extras = order.extraCount;
  return <span className="ka-counts"><span><AssemblyIcon name="pizza" />{String(pizzas).padStart(2, '0')} {pizzas === 1 ? 'Pizza' : 'Pizzas'}</span><span><AssemblyIcon name="extra" />{String(extras).padStart(2, '0')} {extras === 1 ? 'Extra' : 'Extras'}</span></span>;
}
function OrderQueueCard({ order, selected, now, onSelect }: { order: AssemblyOrder; selected: boolean; now: number; onSelect: () => void }) {
  return <button type="button" className={`ka-queue-card${selected ? ' is-selected' : ''}`} aria-pressed={selected} aria-label={`Pedido #${order.number}, ${order.customerName}`} onClick={onSelect}>
    <span className="ka-queue-card-top"><strong>#{order.number}</strong><ChannelBadge channel={order.channel} /><WaitTime receivedAt={order.receivedAt} now={now} /></span>
    <span className="ka-queue-customer">{order.customerName}</span>
    {selected && <OrderCounts order={order} />}
  </button>;
}
export function OrderQueue({ orders, selectedId, now, onSelect, sortDirection, onToggleSort, mode, loading, refreshing, error, reload }: { orders: AssemblyOrder[]; selectedId: string | null; now: number; onSelect: (id: string) => void; sortDirection: QueueSortDirection; onToggleSort: () => void; mode: 'API' | 'DEMO'; loading: boolean; refreshing: boolean; error: string; reload: () => void }) {
  const { state, commandBusy, pendingCommand, commandNotice, retryCommand, connection, operatorSession, sessionBusy, sessionError, endSession, setAvailability } = useAssembly();
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const inProgress = state.orders.some(order => order.items.some(pizza => pizza.assignment?.operatorId === operatorSession?.operatorId && ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'].includes(pizza.status)));
  return <aside className="ka-queue" aria-labelledby="ka-queue-title">
    <div className="ka-queue-heading"><h2 id="ka-queue-title">Fila de Pedidos</h2><button className="ka-sort" type="button" aria-label={`Ordenar fila: ${sortDirection === 'ASC' ? 'mais antigo primeiro' : 'mais recente primeiro'}`} aria-pressed={sortDirection === 'DESC'} onClick={onToggleSort}><AssemblyIcon name="sort" /></button></div>
    <p className="ka-sort-label">{sortDirection === 'ASC' ? 'Mais antigo primeiro' : 'Mais recente primeiro'}</p>
    {mode === 'API' && <Link to="/kitchen/oven">Forno</Link>}
    {mode === 'API' && <span className={`ka-connection ka-connection-${connection.toLowerCase()}`} role="status" aria-label="Conexão Assembly">{({ ONLINE: 'Online', RECONNECTING: 'Reconectando', OFFLINE: 'Offline' })[connection]}</span>}
    {operatorSession && <div className="ka-operator-identity"><span aria-label="Identidade operacional">{operatorSession.operatorName} • {operatorSession.workstationName} • {connection === 'OFFLINE' ? 'Sem conexão' : ({ ONLINE: 'Online', STALE: 'Presença atrasada', OFFLINE: 'Offline' })[operatorSession.presenceStatus]}</span>
      <button type="button" aria-label="Receber novas pizzas neste tablet" aria-pressed={operatorSession.available} disabled={commandBusy || pendingCommand || sessionBusy} onClick={() => void setAvailability(!operatorSession.available)}>{operatorSession.available ? 'Recebendo neste tablet' : 'Suspenso neste tablet'}</button>
      <button type="button" disabled={commandBusy || pendingCommand || sessionBusy} onClick={() => { if (inProgress) setConfirmSwitch(true); else void endSession(); }}>Trocar montador</button>
      <button type="button" disabled={commandBusy || pendingCommand || sessionBusy} onClick={() => { if (inProgress) setConfirmSwitch(true); else void endSession(); }}>Encerrar turno</button>
      {operatorSession.role === 'SUPERVISOR' && <Link to="/kitchen/assembly/recovery">Recuperar pizzas</Link>}
      {confirmSwitch && <div role="alert"><p>Há pizzas sob sua responsabilidade. Pause e libere as pizzas, ou solicite recuperação ao supervisor, antes de trocar montador ou encerrar turno.</p><button type="button" onClick={() => setConfirmSwitch(false)}>Continuar montando</button></div>}
      {sessionError && <p role="alert">{sessionError}</p>}
    </div>}
    {loading && <p role="status">Carregando pedidos...</p>}
    {error && <p className="ka-read-error" role="alert">{error}</p>}
    {commandNotice && <p role="status">{commandNotice}</p>}
    {pendingCommand && <button type="button" disabled={commandBusy} onClick={retryCommand}>{commandBusy ? 'Confirmando comando...' : 'Confirmar comando novamente'}</button>}
    <div className="ka-queue-scroll">{orders.length ? orders.map(order => <OrderQueueCard key={order.id} order={order} selected={order.id === selectedId} now={now} onSelect={() => onSelect(order.id)} />) : <p className="ka-muted">Nenhum pedido na fila.</p>}</div>
    <footer className="ka-queue-footer"><Link to="/">Balcão</Link><span>{mode === 'API' ? 'Persistidos · montagem' : 'DEV · Simulador local'}</span>{mode === 'API' && <button type="button" disabled={refreshing || commandBusy} onClick={reload}>{refreshing ? 'Atualizando...' : 'Atualizar'}</button>}{mode === 'DEMO' && <Link to="/kitchen/assembly">Pedidos persistidos</Link>}{import.meta.env.DEV && <Link to="/kitchen/assembly/dev" aria-label="Abrir simulador de desenvolvimento">Dev</Link>}</footer>
  </aside>;
}
