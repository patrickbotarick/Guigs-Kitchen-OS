import { operatorLoginResultSchema, operatorSessionSchema, operatorLoginSchema, type OperationalSession } from '@guigs/shared';
import { apiUrl } from '../../api';
import { clientId } from '../../utils/clientId';

export const deviceStorageKey = 'guigs-workstation-device-key';
export const sessionStorageKey = 'guigs-operator-session-token';
const invalidEvent = 'guigs-operator-session-invalid';
export type SessionCredentials = { token: string; deviceKey: string };
export class OperatorApiError extends Error { constructor(message: string, public readonly status: number) { super(message); } }
export function workstationDeviceKey() {
  const saved = localStorage.getItem(deviceStorageKey);
  const parsed = operatorLoginSchema.shape.workstationDeviceKey.safeParse(saved);
  if (parsed.success) return parsed.data.toLowerCase();
  const key = clientId(); localStorage.setItem(deviceStorageKey, key); return key;
}
export function sessionCredentials(): SessionCredentials | null {
  const deviceKey = workstationDeviceKey(), token = localStorage.getItem(sessionStorageKey);
  return token ? { token, deviceKey } : null;
}
export const sessionHeaders = (credentials: SessionCredentials) => ({ Authorization: `Bearer ${credentials.token}`, 'X-Workstation-Device-Key': credentials.deviceKey });
export function invalidateSession(token: string) {
  if (localStorage.getItem(sessionStorageKey) === token) { localStorage.removeItem(sessionStorageKey); window.dispatchEvent(new Event(invalidEvent)); }
}
export function onInvalidSession(callback: () => void) { window.addEventListener(invalidEvent, callback); return () => window.removeEventListener(invalidEvent, callback); }
async function call(method: string, credentials?: SessionCredentials, body?: unknown) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${apiUrl}/operators/session`, { method, headers: { 'Content-Type': 'application/json', ...(credentials ? sessionHeaders(credentials) : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal, cache: 'no-store' });
    if (response.status === 204) return null;
    const data: unknown = await response.json();
    if (!response.ok) throw new OperatorApiError(typeof data === 'object' && data && 'error' in data ? String(data.error) : `HTTP ${response.status}`, response.status);
    return data;
  } finally { clearTimeout(timeout); }
}
export async function loginOperator(pin: string) {
  const result = operatorLoginResultSchema.parse(await call('POST', undefined, { pin, workstationDeviceKey: workstationDeviceKey() }));
  localStorage.setItem(sessionStorageKey, result.token); return result;
}
export async function validateOperatorSession(credentials: SessionCredentials): Promise<OperationalSession> { return operatorSessionSchema.parse(await call('GET', credentials)); }
export async function setOperatorAvailability(credentials: SessionCredentials, available: boolean): Promise<OperationalSession> { return operatorSessionSchema.parse(await call('PATCH', credentials, { available })); }
export async function endOperatorSession(credentials: SessionCredentials) { await call('DELETE', credentials); invalidateSession(credentials.token); }
