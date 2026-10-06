import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ovenConfigurationSchema, pizzaCommandSchema, type Order, type PizzaCommandInput } from '@guigs/shared';
import { apiUrl } from '../../api';
import { clientId } from '../../utils/clientId';
import { AssemblyApiError, createAssemblyApi } from '../kitchen/api';
import { KitchenReconciliation, type AssemblyConnection } from '../kitchen/realtime';
import type { SessionCredentials } from '../kitchen/operatorSession';

const api = createAssemblyApi(apiUrl), pendingKey = 'guigs-oven-pending-command';
type Pending = { orderId: string; pizzaId: string; sessionId: string; input: PizzaCommandInput };
function loadPending(sessionId: string): Pending | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null');
    if (!value || typeof value !== 'object' || !('sessionId' in value) || value.sessionId !== sessionId || !('orderId' in value) || typeof value.orderId !== 'string' || !('pizzaId' in value) || typeof value.pizzaId !== 'string' || !('input' in value)) return null;
    const parsed = pizzaCommandSchema.safeParse(value.input);
    return parsed.success && ['ENTER_OVEN', 'REMOVE_FROM_OVEN'].includes(parsed.data.command) ? { sessionId, orderId: value.orderId, pizzaId: value.pizzaId, input: parsed.data } : null;
  } catch { return null; }
}
function savePending(value: Pending | null) { try { if (value) sessionStorage.setItem(pendingKey, JSON.stringify(value)); else sessionStorage.removeItem(pendingKey); } catch { /* Kept in memory if storage is unavailable. */ } }
export function useOven(credentials: SessionCredentials, sessionId: string) {
  const [orders, setOrders] = useState<Order[]>([]), [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [error, setError] = useState('');
  const [connection, setConnection] = useState<AssemblyConnection>('RECONNECTING'), [revision, setRevision] = useState(0);
  const [config, setConfig] = useState<{ defaultOvenMinutes: number; ovenCapacity: number | null; ovenOccupancy: number; offset: number } | null>(null);
  const reconciliation = useRef(new KitchenReconciliation<Order>(order => order)), socketConnected = useRef(false), validRead = useRef(false), readEpoch = useRef(0);
  const [pending, setPending] = useState(() => loadPending(sessionId)), pendingRef = useRef(pending), sending = useRef(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(pending ? 'Há um comando de forno pendente de confirmação nesta aba.' : '');
  const alive = useRef(true), commandController = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; commandController.current?.abort(); }; }, []);
  useEffect(() => {
    const socket = io(apiUrl, { reconnection: true }); let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => { if (!timer) timer = setTimeout(() => { timer = undefined; setRevision(value => value + 1); }, 100); };
    socket.on('connect', () => { socketConnected.current = true; validRead.current = false; setConnection('RECONNECTING'); reload(); });
    const disconnected = () => { socketConnected.current = false; validRead.current = false; setConnection(navigator.onLine ? 'RECONNECTING' : 'OFFLINE'); };
    socket.on('disconnect', disconnected); socket.on('connect_error', () => { socketConnected.current = false; validRead.current = false; setConnection('OFFLINE'); });
    socket.on('kitchen.pizza.updated', value => { if (reconciliation.current.notify('kitchen.pizza.updated', value)) reload(); });
    socket.on('kitchen.order.updated', value => { if (reconciliation.current.notify('kitchen.order.updated', value)) reload(); });
    socket.on('order.created', value => { if (reconciliation.current.created(value)) reload(); });
    socket.on('order.updated', value => { if (reconciliation.current.created(value)) reload(); });
    socket.on('operators.changed', () => window.dispatchEvent(new Event('guigs-operators-changed')));
    const online = () => { validRead.current = false; setConnection('RECONNECTING'); socket.connect(); reload(); };
    const offline = () => { validRead.current = false; setConnection('OFFLINE'); };
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    return () => { clearTimeout(timer); socket.disconnect(); window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);
  useEffect(() => {
    if (busy) return; let active = true, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController;
    async function load() {
      controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000), epoch = readEpoch.current, readRevision = reconciliation.current.beginRead(), began = Date.now();
      setRefreshing(true);
      try {
        const [current, response] = await Promise.all([api.listOrders(controller.signal), fetch(`${apiUrl}/kitchen/oven/config`, { signal: controller.signal, cache: 'no-store' })]);
        if (!response.ok) throw new Error(`Configuração de forno indisponível (HTTP ${response.status}).`);
        const currentConfig = ovenConfigurationSchema.parse(await response.json());
        if (!active || epoch !== readEpoch.current) return;
        setOrders(reconciliation.current.reconcile(current, readRevision)); setConfig({ ...currentConfig, offset: Date.parse(currentConfig.serverTime) - (began + Date.now()) / 2 });
        validRead.current = true; setError(''); setConnection(socketConnected.current ? 'ONLINE' : 'OFFLINE');
      } catch (cause) {
        if (active) { validRead.current = false; setConnection('OFFLINE'); setError(`Não foi possível validar a fila do forno. ${cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'API indisponível.'} Dados anteriores preservados; ações bloqueadas.`); }
      } finally { clearTimeout(timeout); if (active) { setLoading(false); setRefreshing(false); timer = setTimeout(() => void load(), 30000); } }
    }
    void load(); return () => { active = false; controller?.abort(); clearTimeout(timer); };
  }, [revision, busy]);
  function clear() { pendingRef.current = null; savePending(null); if (alive.current) setPending(null); }
  async function send(value: Pending) {
    if (sending.current || !validRead.current || !socketConnected.current || !navigator.onLine) return;
    sending.current = true; readEpoch.current++; setBusy(true); setNotice(''); setError(''); pendingRef.current = value; setPending(value); savePending(value);
    const controller = new AbortController(); commandController.current = controller; const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await api.command(value.orderId, value.pizzaId, value.input, controller.signal, credentials);
      const current = result.replayed ? await api.readOrder(value.orderId, controller.signal) : result.order;
      if (alive.current) { setOrders(reconciliation.current.confirm(current)); setNotice(value.input.command === 'ENTER_OVEN' ? 'Entrada no forno confirmada e salva.' : 'Retirada confirmada. Pizza assada, aguardando finalização.'); } clear();
    } catch (cause) {
      if (cause instanceof AssemblyApiError && cause.status === 409) {
        clear();
        try { const current = await api.readOrder(value.orderId, controller.signal); if (alive.current) { setOrders(reconciliation.current.confirm(current)); setNotice(`${cause.message} Os dados foram recarregados.`); } }
        catch { validRead.current = false; if (alive.current) { setConnection('OFFLINE'); setError('Conflito confirmado; use Atualizar para validar a fila.'); } }
      } else if (cause instanceof AssemblyApiError && [400, 401, 404].includes(cause.status)) { clear(); if (alive.current) setError(cause.message); }
      else if (alive.current) { validRead.current = false; setConnection('OFFLINE'); setError('O comando ainda não foi confirmado. Valide a conexão e use Confirmar comando novamente.'); }
    } finally { clearTimeout(timeout); sending.current = false; if (alive.current) setBusy(false); }
  }
  function command(orderId: string, pizzaId: string, command: 'ENTER_OVEN' | 'REMOVE_FROM_OVEN') {
    if (sending.current || pendingRef.current) return;
    const pizza = orders.find(order => order.id === orderId)?.items.find(pizza => pizza.id === pizzaId);
    if (!pizza || pizza.kind !== 'PIZZA') return;
    void send({ orderId, pizzaId, sessionId, input: { command, expectedState: pizza.production.state, expectedVersion: pizza.production.version, clientCommandId: clientId() } });
  }
  return { orders, loading, refreshing, error, connection, config, busy, notice, pending: Boolean(pending), canAct: connection === 'ONLINE' && !loading && !refreshing && !busy && !pending,
    command, retry: () => { if (pendingRef.current) void send(pendingRef.current); }, reload: () => setRevision(value => value + 1) };
}
