import { createContext, useContext, useReducer, type Dispatch } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { assemblyReducer, createAssemblyState, type AssemblyAction, type AssemblyState } from './assembly';
import './assembly.css';
import { usePersistentAssembly } from './usePersistentAssembly';
import type { PizzaAction } from './types';
import type { AssemblyConnection } from './realtime';
import type { OperationalSession } from '@guigs/shared';
import { useOperatorSession } from './useOperatorSession';
import { OperatorPin } from './components/OperatorPin';
import type { SessionCredentials } from './operatorSession';

const AssemblyContext = createContext<{ state: AssemblyState; dispatch: Dispatch<AssemblyAction>; mode: 'API' | 'DEMO'; loading: boolean; refreshing: boolean; error: string; reload: () => void;
  performCommand: (orderId: string, pizzaId: string, action: PizzaAction) => void; connection: AssemblyConnection; commandBusy: boolean; pendingCommand: boolean; commandNotice: string; retryCommand: () => void;
  operatorSession: OperationalSession | null; sessionBusy: boolean; sessionError: string; endSession: () => Promise<void> } | null>(null);

export function AssemblyLayout() {
  const location = useLocation();
  const demo = import.meta.env.DEV && (location.pathname.endsWith('/dev') || new URLSearchParams(location.search).get('source') === 'demo');
  return demo ? <DemoAssembly /> : <OperationalAssembly />;
}
function DemoAssembly() {
  const [state, dispatch] = useReducer(assemblyReducer, undefined, () => createAssemblyState(Date.now()));
  return <AssemblyContext.Provider value={{ state, dispatch, mode: 'DEMO', loading: false, refreshing: false, error: '', reload: () => {},
    performCommand: (orderId, pizzaId, action) => dispatch({ type: 'PIZZA_ACTION', orderId, pizzaId, action }), connection: 'OFFLINE', commandBusy: false, pendingCommand: false, commandNotice: '', retryCommand: () => {},
    operatorSession: null, sessionBusy: false, sessionError: '', endSession: async () => {} }}><Outlet /></AssemblyContext.Provider>;
}
function OperationalAssembly() {
  const auth = useOperatorSession();
  if (!auth.session || !auth.credentials) return <OperatorPin {...auth} />;
  return <PersistentAssembly key={auth.session.sessionId} session={auth.session} credentials={auth.credentials} sessionBusy={auth.busy} sessionError={auth.error} endSession={auth.end} />;
}
function PersistentAssembly({ session, credentials, sessionBusy, sessionError, endSession }: { session: OperationalSession; credentials: SessionCredentials; sessionBusy: boolean; sessionError: string; endSession: () => Promise<void> }) {
  const value = usePersistentAssembly(credentials, session.sessionId);
  return <AssemblyContext.Provider value={{ ...value, mode: 'API', operatorSession: session, sessionBusy, sessionError, endSession }}><Outlet /></AssemblyContext.Provider>;
}

export function useAssembly() {
  const context = useContext(AssemblyContext);
  if (!context) throw new Error('useAssembly precisa de AssemblyLayout.');
  return context;
}
