import { useEffect, useReducer, useRef, useState } from 'react';
import { apiUrl } from '../../api';
import { createAssemblyApi } from './api';
import { assemblyReducer, type AssemblyAction, type AssemblyState } from './assembly';

const api = createAssemblyApi(apiUrl);
export function usePersistentAssembly() {
  const [state, reduce] = useReducer(assemblyReducer, { orders: [], selectedOrderId: null, selectedPizzaIds: {}, handoffs: [], nextNumber: 0, notice: '', sortDirection: 'ASC' } satisfies AssemblyState);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reloadVersion, setReloadVersion] = useState(0);
  const loaded = useRef(false);
  useEffect(() => {
    let active = true;
    let controller: AbortController;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      setLoading(!loaded.current); setRefreshing(true);
      try {
        const orders = await api.list(controller.signal);
        if (!active) return;
        reduce({ type: 'SYNC_ORDERS', orders }); loaded.current = true; setError('');
      } catch (cause) {
        if (active) setError(`Não foi possível carregar os pedidos. ${cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'API indisponível ou tempo de resposta excedido.'} Os dados já carregados foram preservados.`);
      } finally {
        clearTimeout(timeout);
        if (active) {
          setLoading(false); setRefreshing(false);
          // Delay after completion prevents overlapping requests, including slow/offline APIs.
          timer = setTimeout(() => void load(), 30_000);
        }
      }
    }
    void load();
    return () => { active = false; controller?.abort(); clearTimeout(timer); };
  }, [reloadVersion]);
  function dispatch(action: AssemblyAction) {
    if (['SELECT_ORDER', 'SELECT_PIZZA', 'TOGGLE_SORT'].includes(action.type)) reduce(action);
  }
  return { state, dispatch, loading, refreshing, error, reload: () => setReloadVersion(version => version + 1) };
}
