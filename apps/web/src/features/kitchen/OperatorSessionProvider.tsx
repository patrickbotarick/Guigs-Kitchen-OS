import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { StationKind } from '@guigs/shared';
import { OperatorSessionContext, useManagedOperatorSession } from './useOperatorSession';

export function OperatorSessionProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const station: StationKind = pathname === '/kitchen/assembly' ? 'ASSEMBLY' : pathname === '/kitchen/finishing' || pathname === '/kitchen/oven' ? 'PRODUCTION' : pathname === '/counter/dispatch' || pathname === '/kitchen/dispatch' ? 'COUNTER' : 'SUPERVISION';
  const auth = useManagedOperatorSession(station);
  return <OperatorSessionContext.Provider value={auth}>{children}</OperatorSessionContext.Provider>;
}
