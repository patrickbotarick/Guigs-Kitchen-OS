import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AssemblyConnection } from '../features/kitchen/realtime';
import { StationIdentity } from './StationIdentity';
import { OperationalNavigation } from './OperationalNavigation';
export function OperationalHeader({ title, operator, connection, actions }: { title: string; operator?: string; connection: AssemblyConnection; actions?: ReactNode }) {
  return <header className="operational-header"><Link to="/kitchen" className="operational-logo" aria-label="Guig's Kitchen, visão geral"><img src="/logo-guigs.png" alt="Guig's" /></Link><h1>{title}</h1><div className="operational-header-right"><StationIdentity operator={operator} connection={connection} /><OperationalNavigation stationActions={actions} /></div></header>;
}
