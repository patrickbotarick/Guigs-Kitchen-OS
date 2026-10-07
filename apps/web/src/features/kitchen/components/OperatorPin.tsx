import { useState, type FormEvent } from 'react';
import { workstationDeviceKey } from '../operatorSession';

export function OperatorPin({ busy, checking, error, login, refresh, module = 'montagem' }: { busy: boolean; checking: boolean; error: string; login: (pin: string) => Promise<void>; refresh: () => Promise<void>; module?: 'montagem' | 'forno' | 'finalização' | 'despacho' | 'Forno e Finalização' | 'Balcão · Despacho' | 'Visão geral' }) {
  const [pin, setPin] = useState('');
  const [deviceKey] = useState(() => { try { return workstationDeviceKey(); } catch { return 'Armazenamento indisponível'; } });
  async function submit(event: FormEvent) { event.preventDefault(); if (pin.length < 4 || busy || checking) return; const value = pin; setPin(''); await login(value); }
  return <main className="ka-pin-screen"><form className="ka-pin-panel" onSubmit={event => void submit(event)}>
    <h1>Identifique-se</h1><p>Digite seu PIN para abrir {module === 'despacho' ? 'o despacho' : module === 'forno' ? 'o forno' : module === 'Forno e Finalização' || module === 'Balcão · Despacho' ? module : `a ${module}`}.</p>
    <label htmlFor="operator-pin">{module === 'montagem' ? 'PIN do montador' : 'PIN do operador'}</label><input id="operator-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} disabled={busy || checking} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))} />
    <div className="ka-pin-keypad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '0', 'OK'].map(key => <button key={key} type={key === 'OK' ? 'submit' : 'button'} aria-label={key === '←' ? 'Apagar último número' : key} disabled={busy || checking || (key === 'OK' && pin.length < 4)} onClick={key === 'OK' ? undefined : () => setPin(value => key === '←' ? value.slice(0, -1) : `${value}${key}`.slice(0, 8))}>{key}</button>)}</div>
    {(checking || busy) && <p role="status">{checking ? 'Validando sessão...' : 'Validando PIN...'}</p>}{error && <p role="alert">{error}</p>}
    {error && <button type="button" disabled={busy || checking} onClick={() => void refresh()}>Validar sessão novamente</button>}
    <small aria-label="Identificador do terminal">Terminal: {deviceKey}</small>
  </form></main>;
}
