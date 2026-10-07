import type { AssemblyConnection } from '../features/kitchen/realtime';
export function StationIdentity({ operator, connection }: { operator?: string; connection: AssemblyConnection }) {
  return <div className="station-identity" aria-label="Identidade operacional">{operator && <><span>{operator}</span><span aria-hidden="true">•</span></>}<span className={`station-connection station-connection-${connection.toLowerCase()}`} role="status" aria-label="Conexão">{({ ONLINE: 'Online', RECONNECTING: 'Reconectando', OFFLINE: 'Offline' })[connection]}</span></div>;
}
