import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { OperatorOverview, Order } from '@guigs/shared';
import { apiUrl } from '../../api';

export type OverviewConnection = 'ONLINE' | 'RECONNECTING' | 'OFFLINE';
export function useKitchenOverview() {
  const [orders, setOrders] = useState<Order[]>([]), [operators, setOperators] = useState<OperatorOverview[]>([]);
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [error, setError] = useState('');
  const [connection, setConnection] = useState<OverviewConnection>('RECONNECTING');
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [ordersResponse, operatorsResponse] = await Promise.all([fetch(`${apiUrl}/orders/v2`, { cache: 'no-store' }), fetch(`${apiUrl}/operators/overview`, { cache: 'no-store' })]);
      if (!ordersResponse.ok) throw new Error(`Pedidos indisponíveis (HTTP ${ordersResponse.status}).`);
      const next = await ordersResponse.json() as Order[]; setOrders(next);
      if (operatorsResponse.ok) setOperators(await operatorsResponse.json() as OperatorOverview[]); else setOperators([]);
      setError(''); setConnection('ONLINE');
    } catch (cause) { setConnection('OFFLINE'); setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a central.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => {
    const socket = io(apiUrl, { reconnection: true }); let timer: number | undefined;
    const reload = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void refresh(), 120); };
    socket.on('connect', () => { setConnection('ONLINE'); reload(); }); socket.on('disconnect', () => setConnection(navigator.onLine ? 'RECONNECTING' : 'OFFLINE')); socket.on('connect_error', () => setConnection('OFFLINE'));
    for (const event of ['kitchen.pizza.updated', 'kitchen.order.updated', 'order.created', 'order.updated', 'operators.changed']) socket.on(event, reload);
    const online = () => { setConnection('RECONNECTING'); socket.connect(); reload(); }, offline = () => setConnection('OFFLINE');
    window.addEventListener('online', online); window.addEventListener('offline', offline); void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    return () => { socket.disconnect(); window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, [refresh]);
  return { orders, operators, loading, refreshing, error, connection, refresh };
}
