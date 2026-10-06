import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperationalSession } from '@guigs/shared';
import { endOperatorSession, invalidateSession, loginOperator, onInvalidSession, OperatorApiError, sessionCredentials, sessionStorageKey, heartbeatOperatorSession, setOperatorAvailability, type SessionCredentials } from './operatorSession';

export function useOperatorSession() {
  const [session, setSession] = useState<OperationalSession | null>(null), [credentials, setCredentials] = useState<SessionCredentials | null>(null);
  const [checking, setChecking] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0), alive = useRef(true), operationBusy = useRef(false);
  const reading = useRef(false);
  const refresh = useCallback(async () => {
    if (operationBusy.current || reading.current) return;
    reading.current = true;
    const version = ++epoch.current;
    try {
      const auth = sessionCredentials();
      if (!auth) { if (alive.current) { setSession(null); setCredentials(null); } return; }
      const current = await heartbeatOperatorSession(auth);
      if (alive.current && epoch.current === version) { setSession(current); setCredentials(auth); setError(''); }
    } catch (cause) {
      if (alive.current && epoch.current === version) {
        if (cause instanceof OperatorApiError && cause.status === 401) { const auth = sessionCredentials(); if (auth) invalidateSession(auth.token); setSession(null); setCredentials(null); }
        setError(cause instanceof OperatorApiError ? cause.message : 'Não foi possível validar a sessão. Verifique a API e tente novamente.');
      }
    } finally { reading.current = false; if (alive.current && epoch.current === version) setChecking(false); else if (alive.current) void refresh(); }
  }, []);
  useEffect(() => {
    alive.current = true; void refresh();
    const clear = () => { epoch.current++; setSession(null); setCredentials(null); setChecking(false); setError('Sessão encerrada. Identifique-se novamente.'); };
    const removeInvalid = onInvalidSession(clear);
    const storage = (event: StorageEvent) => { if (event.key === sessionStorageKey) { setSession(null); setCredentials(null); setChecking(true); void refresh(); } };
    const focus = () => { void refresh(); };
    window.addEventListener('storage', storage); window.addEventListener('focus', focus); window.addEventListener('online', focus); window.addEventListener('guigs-operators-changed', focus);
    return () => { alive.current = false; epoch.current++; removeInvalid(); window.removeEventListener('storage', storage); window.removeEventListener('focus', focus); window.removeEventListener('online', focus); window.removeEventListener('guigs-operators-changed', focus); };
  }, [refresh]);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => void refresh(), session.heartbeatIntervalMs);
    return () => clearInterval(timer);
  }, [session?.sessionId, session?.heartbeatIntervalMs, refresh]);
  async function login(pin: string) {
    if (operationBusy.current) return; operationBusy.current = true; const version = ++epoch.current; setBusy(true); setError('');
    try {
      await loginOperator(pin);
      const auth = sessionCredentials();
      if (!auth) throw new Error('Credenciais indisponíveis.');
      const current = await heartbeatOperatorSession(auth);
      if (alive.current && epoch.current === version) { setSession(current); setCredentials(auth); setChecking(false); }
    } catch (cause) { if (alive.current) setError(cause instanceof OperatorApiError ? cause.message : 'Não foi possível iniciar a sessão. Verifique a API e o armazenamento do navegador.'); }
    finally { operationBusy.current = false; if (alive.current) { setBusy(false); if (epoch.current !== version) void refresh(); } }
  }
  async function end() {
    if (operationBusy.current || !credentials) return; operationBusy.current = true; setBusy(true); setError('');
    try { await endOperatorSession(credentials); }
    catch (cause) {
      if (cause instanceof OperatorApiError && cause.status === 401) invalidateSession(credentials.token);
      else if (alive.current) setError(cause instanceof OperatorApiError ? cause.message : 'Não foi possível encerrar a sessão. Tente novamente.');
    } finally { operationBusy.current = false; if (alive.current) setBusy(false); }
  }
  async function setAvailability(available: boolean) {
    if (operationBusy.current || !credentials) return;
    operationBusy.current = true; epoch.current++; setBusy(true); setError('');
    try { const current = await setOperatorAvailability(credentials, available); if (alive.current) setSession(current); }
    catch (cause) {
      if (cause instanceof OperatorApiError && cause.status === 401) invalidateSession(credentials.token);
      else if (alive.current) setError(cause instanceof OperatorApiError ? cause.message : 'Não foi possível alterar a disponibilidade. Tente novamente.');
    } finally { operationBusy.current = false; if (alive.current) setBusy(false); }
  }
  return { session, credentials, checking, busy, error, login, end, refresh, setAvailability };
}
