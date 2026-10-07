import { StationIdentity } from '../../../components/StationIdentity';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { pizzaCommandResultSchema, type SupervisorRecoveryInput } from '@guigs/shared';
import { useAssembly } from '../useAssembly';
import { OperatorApiError, recoverPizza, recoveryTargets, sessionCredentials, invalidateSession } from '../operatorSession';
import { clientId } from '../../../utils/clientId';
import { OperationalNavigation } from '../../../components/OperationalNavigation';

const targetsSchema = z.array(z.object({ sessionId: z.string(), operatorId: z.string(), operatorName: z.string(), workstationName: z.string() }).strict());
type PendingRecovery = { orderId: string; pizzaId: string; input: SupervisorRecoveryInput };
export function KitchenRecoveryPage() {
  const { state, operatorSession, reload, connection } = useAssembly();
  const [targets, setTargets] = useState<z.infer<typeof targetsSchema>>([]), [targetId, setTargetId] = useState('');
  const [pizzaId, setPizzaId] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [pending, setPending] = useState<PendingRecovery | null>(null);
  const [targetsVersion, setTargetsVersion] = useState(0);
  const entries = state.orders.flatMap(order => order.items.filter(pizza => pizza.assignment && ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'].includes(pizza.status)).map(pizza => ({ order, pizza })));
  const selected = entries.find(entry => entry.pizza.id === pizzaId);
  useEffect(() => {
    if (operatorSession?.role !== 'SUPERVISOR') return;
    let active = true;
    const auth = sessionCredentials();
    if (auth) void recoveryTargets(auth).then(value => { if (active) setTargets(targetsSchema.parse(value)); }).catch(cause => { if (active) { setTargets([]); setNotice(cause instanceof Error ? cause.message : 'Falha ao ler destinos.'); } });
    const changed = () => setTargetsVersion(version => version + 1);
    window.addEventListener('guigs-operators-changed', changed);
    return () => { active = false; window.removeEventListener('guigs-operators-changed', changed); };
  }, [operatorSession?.role, targetsVersion]);
  async function send(value: PendingRecovery) {
    const auth = sessionCredentials(); if (!auth || busy) return;
    setBusy(true); setPending(value); setNotice('');
    try {
      const result = pizzaCommandResultSchema.parse(await recoverPizza(auth, value.orderId, value.pizzaId, value.input));
      setPending(null); setNotice(result.replayed ? 'Recuperação já confirmada. Dados recarregados.' : 'Recuperação confirmada e auditada.'); reload(); setTargetsVersion(version => version + 1);
    } catch (cause) {
      if (cause instanceof OperatorApiError && [400, 401, 403, 404, 409].includes(cause.status)) { setPending(null); reload(); if (cause.status === 401) invalidateSession(auth.token); }
      setNotice(cause instanceof Error ? cause.message : 'Sem confirmação. Repita o mesmo comando.');
    } finally { setBusy(false); }
  }
  function act(command: SupervisorRecoveryInput['command']) {
    if (!selected || pending || !reason.trim() || selected.pizza.productionVersion === undefined) return;
    void send({ orderId: selected.order.id, pizzaId: selected.pizza.id, input: { command, expectedState: selected.pizza.status as SupervisorRecoveryInput['expectedState'], expectedVersion: selected.pizza.productionVersion,
      clientCommandId: clientId(), reason: reason.trim(), ...(command === 'SUPERVISOR_REASSIGN' ? { targetSessionId: targetId } : {}) } });
  }
  if (operatorSession?.role !== 'SUPERVISOR') return <section className="page recovery-page"><OperationalNavigation /><h1>Recuperação supervisionada</h1><p role="alert">Acesso restrito a supervisor.</p><Link className="button subtle" to="/kitchen">Voltar à visão geral</Link></section>;
  return <section className="page recovery-page"><header className="recovery-header"><OperationalNavigation /></header>
    <h1>Recuperação supervisionada</h1><StationIdentity operator={operatorSession.operatorName} connection={connection} />
    <p>Confira a situação física da pizza. Montagem ativa exige uma pausa explícita antes da liberação ou reatribuição.</p>
    <form onSubmit={event => event.preventDefault()}>
    <label>Pizza atribuída<select aria-label="Pizza para recuperação" value={pizzaId} disabled={busy || Boolean(pending)} onChange={event => setPizzaId(event.target.value)}><option value="">Selecione</option>{entries.map(({ order, pizza }) => <option key={pizza.id} value={pizza.id}>#{order.number} · Pizza {order.items.indexOf(pizza) + 1} · {pizza.assignment?.operatorName} · {pizza.status}</option>)}</select></label>
    <label>Motivo obrigatório<textarea aria-label="Motivo da recuperação" minLength={3} maxLength={500} value={reason} disabled={busy || Boolean(pending)} onChange={event => setReason(event.target.value)} /></label>
    <label>Novo responsável<select aria-label="Destino da recuperação" value={targetId} disabled={busy || Boolean(pending)} onChange={event => setTargetId(event.target.value)}><option value="">Selecione destino online</option>{targets.filter(target => target.operatorId !== selected?.pizza.assignment?.operatorId).map(target => <option key={target.sessionId} value={target.sessionId}>{target.operatorName} • {target.workstationName}</option>)}</select></label>
    <div className="actions recovery-actions">
      <button className="button secondary" type="button" disabled={busy || Boolean(pending) || reason.trim().length < 3 || selected?.pizza.status !== 'ASSEMBLING'} onClick={() => act('SUPERVISOR_PAUSE')}>Pausar sob supervisão</button>
      <button className="button secondary" type="button" disabled={busy || Boolean(pending) || reason.trim().length < 3 || !selected || selected.pizza.status === 'ASSEMBLING'} onClick={() => act('SUPERVISOR_RELEASE')}>Liberar sob supervisão</button>
      <button className="button secondary" type="button" disabled={busy || Boolean(pending) || reason.trim().length < 3 || !selected || selected.pizza.status === 'ASSEMBLING' || !targetId} onClick={() => act('SUPERVISOR_REASSIGN')}>Reatribuir sob supervisão</button>
      {pending && <button className="button secondary" type="button" disabled={busy} onClick={() => void send(pending)}>Confirmar recuperação novamente</button>}
    </div>
    </form>
    {notice && <p role="status">{notice}</p>}<Link className="button subtle" to="/kitchen">Voltar à visão geral</Link>
  </section>;
}
