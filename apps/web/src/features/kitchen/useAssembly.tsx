import { createContext, useContext, useReducer, type Dispatch } from 'react';
import { Outlet } from 'react-router-dom';
import { assemblyReducer, createAssemblyState, type AssemblyAction, type AssemblyState } from './assembly';
import './assembly.css';

const AssemblyContext = createContext<{ state: AssemblyState; dispatch: Dispatch<AssemblyAction> } | null>(null);

export function AssemblyLayout() {
  const [state, dispatch] = useReducer(assemblyReducer, undefined, () => createAssemblyState(Date.now()));
  return <AssemblyContext.Provider value={{ state, dispatch }}><Outlet /></AssemblyContext.Provider>;
}

export function useAssembly() {
  const context = useContext(AssemblyContext);
  if (!context) throw new Error('useAssembly precisa de AssemblyLayout.');
  return context;
}
