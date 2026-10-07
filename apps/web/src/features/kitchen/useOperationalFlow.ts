import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ovenConfigurationSchema, routeUpdatedSchema, productionSettingsSchema, productionSettingsUpdatedSchema, type ProductionSettings, type DispatchRouteView, type Order } from '@guigs/shared';
import { apiUrl } from '../../api';
import { clientId } from '../../utils/clientId';
import { createAssemblyApi } from './api';
import { KitchenReconciliation, type AssemblyConnection } from './realtime';
import { invalidateSession, sessionHeaders, type SessionCredentials } from './operatorSession';

type Pending = { path: string; body: Record<string, unknown>; sessionId: string };
const key = 'guigs-flow-v2-pending';
function readPending(sessionId: string): Pending | null { try { const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Pending | null; return value?.sessionId === sessionId && typeof value.path === 'string' && value.body && typeof value.body.clientCommandId === 'string' ? value : null; } catch { return null; } }
export function useOperationalFlow(credentials?: SessionCredentials, sessionId = 'overview') {
  const [orders, setOrders] = useState<Order[]>([]), [routes, setRoutes] = useState<DispatchRouteView[]>([]);
  const [config, setConfig] = useState<{ ovenCapacity: number | null; ovenOccupancy: number; offset: number } | null>(null);
  const [productionSettings, setProductionSettings] = useState<ProductionSettings | null>(null);
  const settingsVersion = useRef(-1);
  const [connection, setConnection] = useState<AssemblyConnection>('RECONNECTING'), [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(() => readPending(sessionId)), pendingRef = useRef(pending), sending = useRef(false);
  const valid = useRef(false), connected = useRef(false), alive = useRef(true), commandController = useRef<AbortController | null>(null);
  const reconciliation = useRef(new KitchenReconciliation<Order>(order => order)), routeVersions = useRef(new Map<string, number>()), routeEvents = useRef(new Set<string>());
  const reload = () => setRevision(value => value + 1);
  useEffect(() => { alive.current = true; return () => { alive.current = false; commandController.current?.abort(); }; }, []);
  useEffect(() => {
    const socket = io(apiUrl, { reconnection: true }); let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { if (!timer) timer = setTimeout(() => { timer = undefined; reload(); }, 100); };
    socket.on('connect', () => { connected.current = true; valid.current = false; setConnection('RECONNECTING'); refresh(); });
    const offline = () => { connected.current = false; valid.current = false; setConnection(navigator.onLine ? 'RECONNECTING' : 'OFFLINE'); };
    socket.on('disconnect', offline); socket.on('connect_error', () => { offline(); setConnection('OFFLINE'); });
    socket.on('kitchen.order.updated', value => { if (reconciliation.current.notify('kitchen.order.updated', value)) refresh(); });
    socket.on('kitchen.pizza.updated', value => { if (reconciliation.current.notify('kitchen.pizza.updated', value)) refresh(); });
    for (const event of ['order.created', 'order.updated']) socket.on(event, value => { if (reconciliation.current.created(value)) refresh(); });
    socket.on('dispatch.route.updated', value => { const parsed = routeUpdatedSchema.safeParse(value); if (!parsed.success || routeEvents.current.has(parsed.data.eventId)) return; routeEvents.current.add(parsed.data.eventId); if (routeEvents.current.size > 512) routeEvents.current.delete(routeEvents.current.values().next().value!); if (parsed.data.version > (routeVersions.current.get(parsed.data.routeId) ?? -1)) refresh(); });
    socket.on('kitchen.production.settings.updated', value => { const parsed = productionSettingsUpdatedSchema.safeParse(value); if (parsed.success && parsed.data.version > settingsVersion.current) refresh(); });
    const online = () => { valid.current = false; setConnection('RECONNECTING'); socket.connect(); refresh(); };
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    return () => { clearTimeout(timer); socket.disconnect(); window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);
  useEffect(() => {
    if (busy) return; let active = true, timer: ReturnType<typeof setTimeout>, controller: AbortController;
    async function load() {
      controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000), began = Date.now(), read = reconciliation.current.beginRead(); setRefreshing(true);
      try {
        const [next, routeResponse, configResponse, settingsResponse] = await Promise.all([createAssemblyApi(apiUrl).listOrders(controller.signal), fetch(`${apiUrl}/dispatch/routes`, { signal: controller.signal, cache: 'no-store' }), fetch(`${apiUrl}/kitchen/oven/config`, { signal: controller.signal, cache: 'no-store' }), fetch(`${apiUrl}/kitchen/production/settings`, { signal: controller.signal, cache: 'no-store' })]);
        if (!routeResponse.ok || !configResponse.ok || !settingsResponse.ok) throw new Error('Não foi possível validar rotas e configuração.');
        const nextRoutes = await routeResponse.json() as DispatchRouteView[], nextConfig = ovenConfigurationSchema.parse(await configResponse.json()), settings = productionSettingsSchema.parse(await settingsResponse.json()); if (!active) return;
        if (settings.version >= settingsVersion.current) { settingsVersion.current = settings.version; setProductionSettings(settings); }
        setOrders(reconciliation.current.reconcile(next, read));
        setRoutes(previous => nextRoutes.map(route => { const current = previous.find(value => value.id === route.id); const confirmed = current && current.version > route.version ? current : route; routeVersions.current.set(route.id, confirmed.version); return confirmed; }));
        setConfig({ ...nextConfig, offset: Date.parse(nextConfig.serverTime) - (began + Date.now()) / 2 }); valid.current = true; setError(''); setConnection(connected.current && navigator.onLine ? 'ONLINE' : 'OFFLINE');
      } catch (cause) { if (active) { valid.current = false; setConnection('OFFLINE'); setError(`${cause instanceof Error ? cause.message : 'API indisponível.'} Dados anteriores preservados.`); } }
      finally { clearTimeout(timeout); if (active) { setLoading(false); setRefreshing(false); timer = setTimeout(() => void load(), 30000); } }
    }
    void load(); return () => { active = false; controller?.abort(); clearTimeout(timer); };
  }, [revision, busy]);
  function save(value: Pending | null) { pendingRef.current = value; setPending(value); try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* Pending remains recoverable in this tab. */ } }
  async function send(value: Pending) {
    if (!credentials || sending.current || !valid.current || !connected.current || !navigator.onLine) return;
    sending.current = true; setBusy(true); setError(''); setNotice(''); save(value); const controller = new AbortController(); commandController.current = controller; const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${apiUrl}${value.path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...sessionHeaders(credentials) }, body: JSON.stringify(value.body), signal: controller.signal });
      const data = await response.json() as { error?: string; order?: Order; orders?: Order[]; productionSettings?: ProductionSettings };
      if (!response.ok) {
        if (response.status === 401) invalidateSession(credentials.token);
        if ([400, 401, 404, 409].includes(response.status)) { if (alive.current) { save(null); setNotice(response.status === 409 ? `${data.error ?? 'Atualizado em outro dispositivo.'} Os dados foram recarregados.` : data.error ?? 'Comando rejeitado.'); } reload(); return; }
        throw new Error('Resposta sem confirmação.');
      }
      if (alive.current) { if (data.order) setOrders(reconciliation.current.confirm(data.order)); for (const order of data.orders ?? []) setOrders(reconciliation.current.confirm(order)); if (data.productionSettings && data.productionSettings.version >= settingsVersion.current) { settingsVersion.current = data.productionSettings.version; setProductionSettings(data.productionSettings); } save(null); setNotice('Comando confirmado e salvo.'); reload(); }
    } catch { if (alive.current) setError('Envio sem confirmação. Use Confirmar envio para recuperar o mesmo comando.'); }
    finally { clearTimeout(timeout); sending.current = false; if (alive.current) setBusy(false); }
  }
  return { orders, routes, config, productionSettings, connection, loading, refreshing, error, notice, busy, pending: Boolean(pending), reload,
    canAct: !busy && !pending && connection === 'ONLINE' && valid.current && navigator.onLine,
    command: (path: string, body: Record<string, unknown>) => { if (!pendingRef.current && !sending.current) void send({ path, body: { clientCommandId: clientId(), ...body }, sessionId }); },
    retry: () => { if (pendingRef.current) void send(pendingRef.current); } };
}
