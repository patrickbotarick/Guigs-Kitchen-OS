import { useState } from 'react';
import { OperationalNavigation } from '../../../components/OperationalNavigation';
import { useAssembly } from '../useAssembly';
export function AssemblyStationMenu() {
  const { state, operatorSession, commandBusy, pendingCommand, sessionBusy, sessionError, endSession, setAvailability } = useAssembly();
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const inProgress = state.orders.some(order => order.items.some(pizza => pizza.assignment?.operatorId === operatorSession?.operatorId && ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'].includes(pizza.status)));
  const disabled = commandBusy || pendingCommand || sessionBusy;
  function end() { if (inProgress) setConfirmSwitch(true); else void endSession(); }
  return <div className="ka-station-menu"><OperationalNavigation upward stationActions={operatorSession && <>
    <button type="button" aria-label="Receber novas pizzas neste tablet" aria-pressed={operatorSession.available} disabled={disabled} onClick={() => void setAvailability(!operatorSession.available)}>Recebimento <strong>{operatorSession.available ? 'Ativo' : 'Pausado'}</strong></button>
    <button type="button" disabled={disabled} onClick={end}>Trocar montador</button><button type="button" disabled={disabled} onClick={end}>Encerrar turno</button>
    {confirmSwitch && <div role="alert"><p>Há pizzas sob sua responsabilidade. Pause e libere as pizzas, ou solicite recuperação ao supervisor, antes de trocar montador ou encerrar turno.</p><button type="button" onClick={() => setConfirmSwitch(false)}>Continuar montando</button></div>}{sessionError && <p role="alert">{sessionError}</p>}
  </>} /></div>;
}
