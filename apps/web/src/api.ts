import type { CreateOrderInput, OrderHistoryView, OrderView, TransitionOrderInput } from '@guigs/shared';

export const apiUrl = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3333`;

async function parseResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function getOrders(signal?: AbortSignal): Promise<OrderView[]> {
  return parseResponse<OrderView[]>(await fetch(`${apiUrl}/orders`, { signal }));
}

export async function createOrder(input: CreateOrderInput): Promise<OrderView> {
  return parseResponse<OrderView>(await fetch(`${apiUrl}/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }));
}

export async function transitionOrder(id: string, input: TransitionOrderInput): Promise<OrderView> {
  return parseResponse<OrderView>(await fetch(`${apiUrl}/orders/${id}/transition`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }));
}

export async function getOrderHistory(id: string): Promise<OrderHistoryView[]> {
  return parseResponse<OrderHistoryView[]>(await fetch(`${apiUrl}/orders/${id}/history`));
}

export async function checkHealth(signal?: AbortSignal): Promise<boolean> {
  try { return (await fetch(`${apiUrl}/health`, { signal })).ok; } catch { return false; }
}
