import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { dispatchCommandSchema, type Order, type DispatchCommandInput } from '@guigs/shared';
import { apiUrl } from '../../api';
import { dispatchApi as api } from './api';
import { AssemblyApiError } from '../kitchen/api';
import { KitchenReconciliation, type AssemblyConnection } from '../kitchen/realtime';
import type { SessionCredentials } from '../kitchen/operatorSession';

const pendingKey = 'guigs-dispatch-pending-command';
type Pending = { orderId: string; sessionId: string; input: DispatchCommandInput };
function loadPending(sessionId: string): Pending | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null');
    if (!value || typeof value !== 'object' || !('sessionId' in value) || value.sessionId !== sessionId || !('orderId' in value) || typeof value.orderId !== 'string' || !('input' in value)) return null;
    const parsed = dispatchCommandSchema.safeParse(value.input);
    return parsed.success ? { sessionId, orderId: value.orderId, input: parsed.data } : null;
  } catch { return null; }
}
function savePending(value: Pending | null) { try { if (value) sessionStorage.setItem(pendingKey, JSON.stringify(value)); else sessionStorage.removeItem(pendingKey); } catch { /* Kept in memory if storage is unavailable. */ } }
export function useDispatch(credentials: SessionCredentials, sessionId: string) {
  const [orders, setOrders] = useState<Order[]>([]), [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [error, setError] = useState('');
  const [connection, setConnection] = useState<AssemblyConnection>('RECONNECTING'), [revision, setRevision] = useState(0);

  const reconciliation = useRef(new KitchenReconciliation<Order>(order => order)), socketConnected = useRef(false), validRead = useRef(false), readEpoch = useRef(0);
  const [pending, setPending] = useState(() => loadPending(sessionId)), pendingRef = useRef(pending), sending = useRef(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(pending ? 'Há um comando de despacho pendente de confirmação nesta aba.' : '');
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
      controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000), epoch = readEpoch.current, readRevision = reconciliation.current.beginRead();
      setRefreshing(true);
      try {
        const current = await api.listOrders(controller.signal);
        if (!active || epoch !== readEpoch.current) return;
        setOrders(reconciliation.current.reconcile(current, readRevision));
        validRead.current = true; setError(''); setConnection(socketConnected.current ? 'ONLINE' : 'OFFLINE');
      } catch (cause) {
        if (active) { validRead.current = false; setConnection('OFFLINE'); setError(`Não foi possível validar a fila de despacho. ${cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'API indisponível.'} Dados anteriores preservados; ações bloqueadas.`); }
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
      const result = await api.command(value.orderId, value.input, controller.signal, credentials);
      const current = result.replayed ? await api.readOrder(value.orderId, controller.signal) : result.order;
      if (alive.current) { setOrders(reconciliation.current.confirm(current)); setNotice('Estado do despacho confirmado e salvo.'); } clear();
    } catch (cause) {
      if (cause instanceof AssemblyApiError && cause.status === 409) {
        clear();
        try { const current = await api.readOrder(value.orderId, controller.signal); if (alive.current) { setOrders(reconciliation.current.confirm(current)); setNotice(`${cause.message} Os dados foram recarregados.`); } }
        catch { validRead.current = false; if (alive.current) { setConnection('OFFLINE'); setError('Conflito confirmado; use Atualizar para validar a fila.'); } }
      } else if (cause instanceof AssemblyApiError && [400, 401, 404].includes(cause.status)) { clear(); if (alive.current) setError(cause.message); }
      else if (alive.current) { validRead.current = false; setConnection('OFFLINE'); setError('O comando ainda não foi confirmado. Valide a conexão e use Confirmar comando novamente.'); }
    } finally { clearTimeout(timeout); sending.current = false; if (alive.current) setBusy(false); }
  }
  function command(orderId: string, input: DispatchCommandInput) {
    if (sending.current || pendingRef.current) return;
    void send({ orderId, sessionId, input });
  }
  // A background GET must not disable a touch between pointer-down and click.
  // Confirmed data remains usable with server CAS; errors/reconnect invalidate it.
  return { orders, loading, refreshing, error, connection, busy, notice, pending: Boolean(pending), canAct: connection === 'ONLINE' && validRead.current && !loading && !busy && !pending,
    command, retry: () => { if (pendingRef.current) void send(pendingRef.current); }, reload: () => setRevision(value => value + 1) };
}
