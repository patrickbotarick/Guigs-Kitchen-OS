import { finishingCommandResultSchema, type FinishingCommandInput } from '@guigs/shared';
import { apiUrl } from '../../api';
import { AssemblyApiError, createAssemblyApi } from '../kitchen/api';
import { invalidateSession, sessionHeaders, type SessionCredentials } from '../kitchen/operatorSession';
export const finishingApi = { ...createAssemblyApi(apiUrl),
  async command(orderId: string, input: FinishingCommandInput, signal: AbortSignal, credentials: SessionCredentials) {
    const response = await fetch(`${apiUrl}/orders/v2/${encodeURIComponent(orderId)}/finishing/commands`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...sessionHeaders(credentials) }, body: JSON.stringify(input) });
    const data: unknown = await response.json();
    if (!response.ok) { if (response.status === 401) invalidateSession(credentials.token); throw new AssemblyApiError(typeof data === 'object' && data !== null && 'error' in data ? String(data.error) : `HTTP ${response.status}`, response.status); }
    return finishingCommandResultSchema.parse(data);
  },
};
