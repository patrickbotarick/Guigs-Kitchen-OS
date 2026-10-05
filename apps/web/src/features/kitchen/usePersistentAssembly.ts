import { useEffect, useReducer, useRef, useState } from 'react';
import { apiUrl } from '../../api';
import { AssemblyApiError, createAssemblyApi, mapAssemblyOrder } from './api';
import { assemblyReducer, type AssemblyAction, type AssemblyState } from './assembly';
import { pizzaCommandSchema, type PizzaCommandInput } from '@guigs/shared';
import { clientId } from '../../utils/clientId';
import type { PizzaAction } from './types';

type PendingCommand = { orderId: string; pizzaId: string; input: PizzaCommandInput };
const storageKey = 'guigs-assembly-pending-command';
function readPending(): PendingCommand | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    if (typeof value !== 'object' || value === null || !('orderId' in value) || typeof value.orderId !== 'string' || !('pizzaId' in value) || typeof value.pizzaId !== 'string' || !('input' in value)) return null;
    const input = pizzaCommandSchema.safeParse(value.input);
    return input.success ? { orderId: value.orderId, pizzaId: value.pizzaId, input: input.data } : null;
  } catch { return null; }
}
function storePending(value: PendingCommand | null) {
  try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* Retry still works in memory if browser storage is disabled. */ }
}

const api = createAssemblyApi(apiUrl);
export function usePersistentAssembly() {
  const [state, reduce] = useReducer(assemblyReducer, { orders: [], selectedOrderId: null, selectedPizzaIds: {}, handoffs: [], nextNumber: 0, notice: '', sortDirection: 'ASC' } satisfies AssemblyState);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reloadVersion, setReloadVersion] = useState(0);
  const loaded = useRef(false);
  const readEpoch = useRef(0);
  const [pending, setPending] = useState(readPending);
  const pendingRef = useRef(pending);
  const [commandBusy, setCommandBusy] = useState(false);
  const sending = useRef(false);
  const [commandNotice, setCommandNotice] = useState(pending ? 'Há um comando pendente de confirmação nesta aba.' : '');
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
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      setLoading(!loaded.current); setRefreshing(true);
      try {
        const orders = await api.list(controller.signal);
        if (!active || epoch !== readEpoch.current) return;
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
      const result = await api.command(value.orderId, value.pizzaId, value.input, controller.signal);
      // A receipt returns the original response. Read current data before applying a replay.
      const confirmed = result.replayed ? await api.readOrder(value.orderId, controller.signal) : result.order;
      if (alive.current) {
        loaded.current = true; setLoading(false);
        reduce({ type: 'APPLY_SERVER_ORDER', orderId: confirmed.id, order: mapAssemblyOrder(confirmed), version: confirmed.version });
        setCommandNotice(value.input.command === 'SEND_TO_OVEN' ? 'Montagem confirmada. Pizza aguardando forno.' : 'Comando confirmado e salvo.');
      }
      clearPending();
    } catch (cause) {
      if (cause instanceof AssemblyApiError && cause.status === 409) {
        clearPending();
        try {
          const current = await api.readOrder(value.orderId, controller.signal);
          if (alive.current) { loaded.current = true; setLoading(false); reduce({ type: 'APPLY_SERVER_ORDER', orderId: current.id, order: mapAssemblyOrder(current), version: current.version }); setCommandNotice('Esta pizza foi atualizada ou o comando está em conflito. Os dados foram recarregados.'); }
        } catch { if (alive.current) setCommandError('Conflito confirmado, mas não foi possível recarregar o pedido. Use Atualizar.'); }
      } else if (cause instanceof AssemblyApiError && [400, 404].includes(cause.status)) {
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
    const command = { START: 'START_ASSEMBLY', PAUSE: 'PAUSE_ASSEMBLY', RESUME: 'RESUME_ASSEMBLY', SEND_TO_OVEN: 'SEND_TO_OVEN' } as const;
    void send({ orderId, pizzaId, input: { command: command[action], expectedState: pizza.status, expectedVersion: pizza.productionVersion, clientCommandId: clientId() } });
  }
  return { state, dispatch, loading, refreshing, error: [error, commandError].filter(Boolean).join(' '), reload: () => setReloadVersion(version => version + 1), performCommand,
    commandBusy, pendingCommand: pending !== null, commandNotice, retryCommand: () => { if (pendingRef.current) void send(pendingRef.current); } };
}
