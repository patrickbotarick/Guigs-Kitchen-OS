import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { OperationalSession } from '@guigs/shared';
import { useOperatorSession } from '../kitchen/useOperatorSession';
import { OperatorPin } from '../kitchen/components/OperatorPin';
import type { SessionCredentials } from '../kitchen/operatorSession';
import { useOven } from './useOven';
import { elapsedSeconds, formatDuration, ovenFlavor, ovenQueues, ovenTiming, type OvenEntry } from './oven';
import '../kitchen/assembly.css';
import './oven.css';

const phaseLabels = { NORMAL: 'Assando', NEAR: 'Próxima do tempo', REACHED: 'Tempo atingido', OVER: 'Acima do tempo' } as const;
function OvenCard({ entry: { order, pizza }, now, enabled, full, act }: { entry: OvenEntry; now: number; enabled: boolean; full: boolean; act: (orderId: string, pizzaId: string, command: 'ENTER_OVEN' | 'REMOVE_FROM_OVEN') => void }) {
  const inside = pizza.production.state === 'IN_OVEN', timing = ovenTiming(pizza, now);
  return <article className={`oven-card${inside ? ` oven-time-${timing.phase.toLowerCase()}` : ''}`} aria-label={`Pedido #${order.number}, Pizza ${pizza.position + 1}`} data-pizza-id={pizza.id}>
    <div className="oven-card-heading"><strong>#{order.number} <span>Pizza {pizza.position + 1}</span></strong><span className="oven-size">{pizza.snapshot.size === 'BROTO' ? 'Broto' : 'Grande'}</span></div>
    <h3>{ovenFlavor(pizza)}</h3><p className="oven-composition">{pizza.snapshot.composition === 'HALF_HALF' ? 'Meio a meio' : 'Inteira'}</p>
    {inside ? <div className="oven-clock"><strong aria-label="Tempo no forno">{formatDuration(timing.elapsed)}</strong><span>no forno · entrada {new Date(pizza.production.ovenStartedAt!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      <span>Previsão {timing.duration === null ? 'indisponível' : formatDuration(timing.duration)} · <b>{phaseLabels[timing.phase]}</b></span>
      {pizza.production.ovenExpectedEndAt && <span>Saída prevista {new Date(pizza.production.ovenExpectedEndAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
      <progress aria-label="Indicador de tempo" value={timing.ratio} max={1} /></div>
      : <p className="oven-wait">Aguardando <strong>{formatDuration(elapsedSeconds(pizza.production.assemblyCompletedAt ?? pizza.production.queuedAt, now))}</strong></p>}
    <p className="oven-assembler">Montagem: {pizza.assignment?.operatorName ?? 'Responsável não registrado'}</p>
    {inside && pizza.production.ovenOperator && <p className="oven-assembler">Entrada: {pizza.production.ovenOperator.operatorName}</p>}
    {(pizza.snapshot.notes || order.notes) && <p className="oven-notes">{pizza.snapshot.notes}{pizza.snapshot.notes && order.notes ? ' · ' : ''}{order.notes ? `Pedido: ${order.notes}` : ''}</p>}
    <button type="button" className={`button ${inside ? 'secondary' : 'primary'}`} disabled={!enabled || (!inside && full)} onClick={() => act(order.id, pizza.id, inside ? 'REMOVE_FROM_OVEN' : 'ENTER_OVEN')}>{inside ? 'Retirar do forno' : 'Colocar no forno'}</button>
  </article>;
}
export function OvenPage() {
  const auth = useOperatorSession();
  if (!auth.session || !auth.credentials) return <OperatorPin {...auth} module="forno" />;
  return <OperationalOven key={auth.session.sessionId} session={auth.session} credentials={auth.credentials} sessionBusy={auth.busy} sessionError={auth.error} end={auth.end} setAvailability={auth.setAvailability} />;
}
function OperationalOven({ session, credentials, sessionBusy, sessionError, end, setAvailability }: { session: OperationalSession; credentials: SessionCredentials; sessionBusy: boolean; sessionError: string; end: () => Promise<void>; setAvailability: (available: boolean) => Promise<void> }) {
  const oven = useOven(credentials, session.sessionId), [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const queues = ovenQueues(oven.orders), serverNow = now + (oven.config?.offset ?? 0);
  // GET configuration counts every IN_OVEN pizza, including orders outside the active list.
  const occupied = Math.max(queues.inside.length, oven.config?.ovenOccupancy ?? 0), capacity = oven.config?.ovenCapacity ?? null;
  const vacancies = capacity === null ? null : Math.max(0, capacity - occupied);
  const full = capacity !== null && occupied >= capacity;
  const canAct = oven.canAct && !sessionBusy && !sessionError && session.presenceStatus === 'ONLINE';
  return <section className="oven-page">
    <header className="oven-header"><div><h1>Forno</h1><p aria-label="Identidade operacional">{session.operatorName} • {session.workstationName} • {session.presenceStatus === 'ONLINE' ? 'Presença válida' : 'Confirme presença'}</p></div>
      <div className="oven-header-actions"><span role="status" aria-label="Conexão Forno" className={`oven-connection oven-connection-${oven.connection.toLowerCase()}`}>{({ ONLINE: 'Online', RECONNECTING: 'Reconectando', OFFLINE: 'Offline' })[oven.connection]}</span>
        <button type="button" className="button secondary" disabled={oven.busy || oven.pending || sessionBusy} onClick={() => void end()}>Encerrar turno</button><Link className="button subtle" to="/kitchen/finishing">Finalização</Link><Link className="button subtle" to="/kitchen/assembly">Montagem</Link><Link className="button subtle" to="/">Balcão</Link></div>
    </header>
    <div className="oven-toolbar"><p>Fila compartilhada · previsão temporária {oven.config ? formatDuration(oven.config.defaultOvenMinutes * 60) : 'carregando'} · retirada sempre manual</p>
      <button type="button" className="button secondary" disabled={oven.refreshing || oven.busy} onClick={oven.reload}>{oven.refreshing ? 'Atualizando...' : 'Atualizar'}</button>
      <button type="button" className="button subtle" aria-label="Receber novas pizzas de montagem" aria-pressed={session.available} disabled={sessionBusy || oven.busy || oven.pending} onClick={() => void setAvailability(!session.available)}>{session.available ? 'Recebendo montagem · suspender' : 'Montagem suspensa · retomar'}</button>
    </div>
    {session.available && <p className="oven-hint">Se atuar somente no forno, suspenda o recebimento de novas pizzas de montagem nesta sessão.</p>}
    <div className={`oven-occupancy${full ? ' oven-full' : ''}`} role="status" aria-label="Ocupação do forno">{capacity === null ? `Forno ${occupied} · capacidade não configurada` : `Forno ${occupied} / ${capacity} · ${vacancies} ${vacancies === 1 ? 'vaga' : 'vagas'}`}{full && <strong>Forno cheio</strong>}</div>
    {(oven.error || sessionError) && <p className="oven-alert" role="alert">{oven.error} {sessionError}</p>}
    {oven.notice && <p className="oven-notice" role="status">{oven.notice}</p>}
    {oven.pending && <button type="button" className="button secondary" disabled={oven.busy || oven.connection !== 'ONLINE' || sessionBusy} onClick={oven.retry}>{oven.busy ? 'Confirmando comando...' : 'Confirmar comando novamente'}</button>}
    {oven.loading && <p role="status">Carregando fila do forno...</p>}
    <div className="oven-columns">
      <section className="oven-column" aria-labelledby="oven-waiting"><h2 id="oven-waiting">Aguardando forno <span>{queues.waiting.length}</span></h2><p className="oven-sort">Mais antiga primeiro</p><div className="oven-cards">{queues.waiting.length ? queues.waiting.map(entry => <OvenCard key={entry.pizza.id} entry={entry} now={serverNow} enabled={canAct} full={full} act={oven.command} />) : !oven.loading && <p className="oven-empty">Nenhuma pizza aguardando forno</p>}</div></section>
      <section className="oven-column" aria-labelledby="oven-inside"><h2 id="oven-inside">No forno <span>{queues.inside.length}</span></h2><p className="oven-sort">Saída prevista mais próxima primeiro · timer orientativo</p><div className="oven-cards">{queues.inside.length ? queues.inside.map(entry => <OvenCard key={entry.pizza.id} entry={entry} now={serverNow} enabled={canAct} full={full} act={oven.command} />) : !oven.loading && <p className="oven-empty">Nenhuma pizza no forno</p>}</div></section>
    </div>
  </section>;
}
