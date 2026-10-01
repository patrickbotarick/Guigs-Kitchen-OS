import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { OrderView } from '@guigs/shared';
import { apiUrl, checkHealth, getOrders } from './api';

export function useKitchen() {
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [apiOnline, setApiOnline] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const next = await getOrders();
      setOrders(next);
      setApiOnline(true);
      setError('');
    } catch {
      setApiOnline(false);
      setError('Não foi possível carregar a fila. Tentando reconectar.');
    }
  }, []);

  useEffect(() => {
    const socket = io(apiUrl, { reconnection: true });
    socket.on('connect', () => { setRealtime(true); void refresh(); });
    socket.on('disconnect', () => setRealtime(false));
    socket.on('order.created', () => { void refresh(); });
    void refresh();
    const interval = window.setInterval(async () => {
      if (await checkHealth()) void refresh();
      else setApiOnline(false);
    }, 30000);
    return () => { socket.disconnect(); window.clearInterval(interval); };
  }, [refresh]);

  return { orders, apiOnline, realtime, error, refresh };
}
