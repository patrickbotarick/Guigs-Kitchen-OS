import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperationalSession } from '@guigs/shared';
import { endOperatorSession, invalidateSession, loginOperator, onInvalidSession, OperatorApiError, sessionCredentials, sessionStorageKey, validateOperatorSession, type SessionCredentials } from './operatorSession';

export function useOperatorSession() {
  const [session, setSession] = useState<OperationalSession | null>(null), [credentials, setCredentials] = useState<SessionCredentials | null>(null);
  const [checking, setChecking] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0), alive = useRef(true), operationBusy = useRef(false);
  const refresh = useCallback(async () => {
    if (operationBusy.current) return;
    const version = ++epoch.current;
    try {
      const auth = sessionCredentials();
      if (!auth) { if (alive.current) { setSession(null); setCredentials(null); } return; }
      const current = await validateOperatorSession(auth);
      if (alive.current && epoch.current === version) { setSession(current); setCredentials(auth); setError(''); }
    } catch (cause) {
      if (alive.current && epoch.current === version) {
        if (cause instanceof OperatorApiError && cause.status === 401) { const auth = sessionCredentials(); if (auth) invalidateSession(auth.token); setSession(null); setCredentials(null); }
        setError(cause instanceof OperatorApiError ? cause.message : 'Não foi possível validar a sessão. Verifique a API e tente novamente.');
      }
    } finally { if (alive.current && epoch.current === version) setChecking(false); }
  }, []);
  useEffect(() => {
    alive.current = true; void refresh();
    const clear = () => { epoch.current++; setSession(null); setCredentials(null); setChecking(false); setError('Sessão encerrada. Identifique-se novamente.'); };
    const removeInvalid = onInvalidSession(clear);
    const storage = (event: StorageEvent) => { if (event.key === sessionStorageKey) { setSession(null); setCredentials(null); setChecking(true); void refresh(); } };
    const focus = () => { void refresh(); };
    const timer = setInterval(() => void refresh(), 60_000);
    window.addEventListener('storage', storage); window.addEventListener('focus', focus);
    return () => { alive.current = false; epoch.current++; removeInvalid(); clearInterval(timer); window.removeEventListener('storage', storage); window.removeEventListener('focus', focus); };
  }, [refresh]);
  async function login(pin: string) {
    if (operationBusy.current) return; operationBusy.current = true; const version = ++epoch.current; setBusy(true); setError('');
    try {
      const result = await loginOperator(pin);
      if (alive.current && epoch.current === version) { setSession(result.session); setCredentials(sessionCredentials()); setChecking(false); }
    } catch (cause) { if (alive.current) setError(cause instanceof OperatorApiError ? cause.message : 'Não foi possível iniciar a sessão. Verifique a API e o armazenamento do navegador.'); }
    finally { operationBusy.current = false; if (alive.current) { setBusy(false); if (epoch.current !== version) void refresh(); } }
  }
  async function end() {
    if (operationBusy.current || !credentials) return; operationBusy.current = true; setBusy(true); setError('');
    try { await endOperatorSession(credentials); }
    catch (cause) {
      if (cause instanceof OperatorApiError && cause.status === 401) invalidateSession(credentials.token);
      else if (alive.current) setError('Não foi possível encerrar a sessão. Tente novamente.');
    } finally { operationBusy.current = false; if (alive.current) setBusy(false); }
  }
  return { session, credentials, checking, busy, error, login, end, refresh };
}
