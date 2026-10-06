import { useEffect, useReducer, useRef, useState } from 'react';
import { apiUrl } from '../../api';
import { AssemblyApiError, createAssemblyApi } from './api';
import { assemblyReducer, type AssemblyAction, type AssemblyState } from './assembly';
import { pizzaCommandSchema, type PizzaCommandInput } from '@guigs/shared';
import { clientId } from '../../utils/clientId';
import type { PizzaAction } from './types';
import { io } from 'socket.io-client';
import { AssemblyReconciliation, type AssemblyConnection } from './realtime';
import type { SessionCredentials } from './operatorSession';

type PendingCommand = { orderId: string; pizzaId: string; input: PizzaCommandInput; operatorSessionId: string };
const storageKey = 'guigs-assembly-pending-command';
function readPending(operatorSessionId: string): PendingCommand | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    if (typeof value !== 'object' || value === null || !('orderId' in value) || typeof value.orderId !== 'string' || !('pizzaId' in value) || typeof value.pizzaId !== 'string' || !('input' in value)) return null;
    const input = pizzaCommandSchema.safeParse(value.input);
    // Never attribute an uncertain command from a prior session to the new operator.
    if (!('operatorSessionId' in value) || value.operatorSessionId !== operatorSessionId) { sessionStorage.removeItem(storageKey); return null; }
    return input.success ? { orderId: value.orderId, pizzaId: value.pizzaId, input: input.data, operatorSessionId } : null;
  } catch { return null; }
}
function storePending(value: PendingCommand | null) {
  try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* Retry still works in memory if browser storage is disabled. */ }
}

const api = createAssemblyApi(apiUrl);
export function usePersistentAssembly(credentials: SessionCredentials, operatorSessionId: string) {
  const [state, reduce] = useReducer(assemblyReducer, { orders: [], selectedOrderId: null, selectedPizzaIds: {}, handoffs: [], nextNumber: 0, notice: '', sortDirection: 'ASC' } satisfies AssemblyState);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reloadVersion, setReloadVersion] = useState(0);
  const loaded = useRef(false);
  const readEpoch = useRef(0);
  const reconciliation = useRef(new AssemblyReconciliation());
  const [connection, setConnection] = useState<AssemblyConnection>('RECONNECTING');
  // Coalesce the pizza/order pair and bursts without opening parallel list requests.
  useEffect(() => {
    const socket = io(apiUrl, { reconnection: true });
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { if (refreshTimer) return; refreshTimer = setTimeout(() => { refreshTimer = undefined; setReloadVersion(version => version + 1); }, 100); };
    const online = () => { setConnection('RECONNECTING'); socket.connect(); refresh(); };
    const offline = () => setConnection('OFFLINE');
    socket.on('connect', () => { setConnection('ONLINE'); refresh(); }); // Every connection, including reconnection, performs GET.
    socket.on('disconnect', () => setConnection(navigator.onLine ? 'RECONNECTING' : 'OFFLINE'));
    socket.on('connect_error', () => setConnection('OFFLINE'));
    socket.io.on('reconnect_attempt', () => setConnection(navigator.onLine ? 'RECONNECTING' : 'OFFLINE'));
    socket.on('kitchen.pizza.updated', value => { if (reconciliation.current.notify('kitchen.pizza.updated', value)) refresh(); });
    socket.on('kitchen.order.updated', value => { if (reconciliation.current.notify('kitchen.order.updated', value)) refresh(); });
    socket.on('order.created', value => { if (reconciliation.current.created(value)) refresh(); });
    socket.on('order.updated', value => { if (reconciliation.current.created(value)) refresh(); });
    socket.on('operators.changed', () => { window.dispatchEvent(new Event('guigs-operators-changed')); refresh(); });
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    return () => { socket.disconnect(); clearTimeout(refreshTimer); window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);
  const [orphanedCommand] = useState(() => {
    try { const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'); return typeof value === 'object' && value !== null && (!('operatorSessionId' in value) || value.operatorSessionId !== operatorSessionId); }
    catch { return false; }
  });
  const [pending, setPending] = useState(() => readPending(operatorSessionId));
  const pendingRef = useRef(pending);
  const [commandBusy, setCommandBusy] = useState(false);
  const sending = useRef(false);
  const [commandNotice, setCommandNotice] = useState(orphanedCommand ? 'Havia um comando sem confirmação de outra sessão. Confira o estado carregado antes de continuar.' : pending ? 'Há um comando pendente de confirmação nesta aba.' : '');
  const [commandError, setCommandError] = useState('');
  const alive = useRef(true);
  const commandController = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; commandController.current?.abort(); }; }, []);
  useEffect(() => {
    if (commandBusy) return;
    let active = true;
    let controller: AbortController;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      const epoch = readEpoch.current;
      const revision = reconciliation.current.beginRead();
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      setLoading(!loaded.current); setRefreshing(true);
      try {
        const orders = await api.listOrders(controller.signal);
        if (!active || epoch !== readEpoch.current) return;
        reduce({ type: 'SYNC_ORDERS', orders: reconciliation.current.reconcile(orders, revision) }); loaded.current = true; setError('');
      } catch (cause) {
        if (active) setError(`Não foi possível carregar os pedidos. ${cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'API indisponível ou tempo de resposta excedido.'} Os dados já carregados foram preservados.`);
      } finally {
        clearTimeout(timeout);
        if (active) {
          setLoading(false); setRefreshing(false);
          // Delay after completion prevents overlapping requests, including slow/offline APIs.
          timer = setTimeout(() => void load(), 120_000);
        }
      }
    }
    void load();
    return () => { active = false; controller?.abort(); clearTimeout(timer); };
  }, [reloadVersion, commandBusy]);
  function dispatch(action: AssemblyAction) {
    if (['SELECT_ORDER', 'SELECT_PIZZA', 'TOGGLE_SORT'].includes(action.type)) reduce(action);
  }
  function clearPending() { pendingRef.current = null; storePending(null); if (alive.current) setPending(null); }
  async function send(value: PendingCommand) {
    if (sending.current) return;
    sending.current = true; readEpoch.current++; setCommandBusy(true); setCommandError(''); setCommandNotice('');
    pendingRef.current = value; setPending(value); storePending(value);
    const controller = new AbortController(); commandController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await api.command(value.orderId, value.pizzaId, value.input, controller.signal, credentials);
      // A receipt returns the original response. Read current data before applying a replay.
      const confirmed = result.replayed ? await api.readOrder(value.orderId, controller.signal) : result.order;
      if (alive.current) {
        loaded.current = true; setLoading(false);
        reduce({ type: 'SYNC_ORDERS', orders: reconciliation.current.confirm(confirmed) });
        setCommandNotice(value.input.command === 'SEND_TO_OVEN' ? 'Montagem confirmada. Pizza aguardando forno.' : 'Comando confirmado e salvo.');
      }
      clearPending();
    } catch (cause) {
      if (cause instanceof AssemblyApiError && cause.status === 409) {
        clearPending();
        try {
          const current = await api.readOrder(value.orderId, controller.signal);
          if (alive.current) { loaded.current = true; setLoading(false); reduce({ type: 'SYNC_ORDERS', orders: reconciliation.current.confirm(current) }); setCommandNotice('Esta pizza foi atualizada ou o comando está em conflito. Os dados foram recarregados.'); }
        } catch { if (alive.current) setCommandError('Conflito confirmado, mas não foi possível recarregar o pedido. Use Atualizar.'); }
      } else if (cause instanceof AssemblyApiError && [400, 401, 404].includes(cause.status)) {
        clearPending(); if (alive.current) setCommandError(cause.message);
      } else if (alive.current) setCommandError('O comando ainda não foi confirmado. Use Confirmar comando novamente para recuperar o mesmo envio.');
    } finally {
      clearTimeout(timeout); sending.current = false;
      if (alive.current) setCommandBusy(false);
    }
  }
  function performCommand(orderId: string, pizzaId: string, action: PizzaAction) {
    if (sending.current || pendingRef.current) return;
    const pizza = state.orders.find(order => order.id === orderId)?.items.find(pizza => pizza.id === pizzaId);
    if (!pizza || pizza.productionVersion === undefined) return;
    const command = { START: 'START_ASSEMBLY', PAUSE: 'PAUSE_ASSEMBLY', RESUME: 'RESUME_ASSEMBLY', SEND_TO_OVEN: 'SEND_TO_OVEN', CLAIM: 'CLAIM_PIZZA', RELEASE: 'RELEASE_PIZZA' } as const;
    void send({ orderId, pizzaId, operatorSessionId, input: { command: command[action], expectedState: pizza.status, expectedVersion: pizza.productionVersion, clientCommandId: clientId() } });
  }
  return { state, dispatch, loading, refreshing, error: [error, commandError].filter(Boolean).join(' '), reload: () => setReloadVersion(version => version + 1), performCommand,
    connection, commandBusy, pendingCommand: pending !== null, commandNotice, retryCommand: () => { if (pendingRef.current) void send(pendingRef.current); } };
}
