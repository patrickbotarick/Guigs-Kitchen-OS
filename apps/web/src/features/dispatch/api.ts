import { dispatchCommandResultSchema, type DispatchCommandInput } from '@guigs/shared';
import { apiUrl } from '../../api';
import { AssemblyApiError, createAssemblyApi } from '../kitchen/api';
import { invalidateSession, sessionHeaders, type SessionCredentials } from '../kitchen/operatorSession';
export const dispatchApi = { ...createAssemblyApi(apiUrl),
  async command(orderId: string, input: DispatchCommandInput, signal: AbortSignal, credentials: SessionCredentials) {
    const response = await fetch(`${apiUrl}/orders/v2/${encodeURIComponent(orderId)}/dispatch/commands`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...sessionHeaders(credentials) }, body: JSON.stringify(input) });
    const data: unknown = await response.json();
    if (!response.ok) { if (response.status === 401) invalidateSession(credentials.token); throw new AssemblyApiError(typeof data === 'object' && data !== null && 'error' in data ? String(data.error) : `HTTP ${response.status}`, response.status); }
    return dispatchCommandResultSchema.parse(data);
  },
};
