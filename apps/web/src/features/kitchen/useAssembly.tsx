import { createContext, useContext, useReducer, type Dispatch } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { assemblyReducer, createAssemblyState, type AssemblyAction, type AssemblyState } from './assembly';
import './assembly.css';
import { usePersistentAssembly } from './usePersistentAssembly';

const AssemblyContext = createContext<{ state: AssemblyState; dispatch: Dispatch<AssemblyAction>; mode: 'API' | 'DEMO'; loading: boolean; refreshing: boolean; error: string; reload: () => void } | null>(null);

export function AssemblyLayout() {
  const location = useLocation();
  const demo = import.meta.env.DEV && (location.pathname.endsWith('/dev') || new URLSearchParams(location.search).get('source') === 'demo');
  return demo ? <DemoAssembly /> : <PersistentAssembly />;
}
function DemoAssembly() {
  const [state, dispatch] = useReducer(assemblyReducer, undefined, () => createAssemblyState(Date.now()));
  return <AssemblyContext.Provider value={{ state, dispatch, mode: 'DEMO', loading: false, refreshing: false, error: '', reload: () => {} }}><Outlet /></AssemblyContext.Provider>;
}
function PersistentAssembly() {
  const value = usePersistentAssembly();
  return <AssemblyContext.Provider value={{ ...value, mode: 'API' }}><Outlet /></AssemblyContext.Provider>;
}

export function useAssembly() {
  const context = useContext(AssemblyContext);
  if (!context) throw new Error('useAssembly precisa de AssemblyLayout.');
  return context;
}
