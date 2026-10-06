import { useEffect, useRef, useState } from 'react';
import type { FinishingCommandInput } from '@guigs/shared';

export type CorrectionInput = Extract<FinishingCommandInput, { command: 'UNCHECK_PIZZA' | 'UNCHECK_EXTRA' | 'UNCONFIRM_PACKAGING' }>;
export function CorrectionDialog({ input, label, enabled, cancel, confirm }: { input: CorrectionInput; label: string; enabled: boolean; cancel: () => void; confirm: (input: CorrectionInput) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), [reason, setReason] = useState(''), [quantity, setQuantity] = useState(input.command === 'UNCHECK_EXTRA' ? input.checkedQuantity : 0);
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  return <dialog ref={dialog} className="finishing-correction" aria-labelledby="correction-title" onCancel={cancel}>
    <form onSubmit={event => { event.preventDefault(); if (enabled) confirm({ ...input, reason, ...(input.command === 'UNCHECK_EXTRA' ? { checkedQuantity: quantity } : {}) }); }}>
      <h2 id="correction-title">Corrigir conferência</h2><p>{label}</p>
      <p>O histórico será preservado. Corrigir um item também invalida a embalagem confirmada.</p>
      {input.command === 'UNCHECK_EXTRA' && <label>Quantidade que permanece conferida<input type="number" min={0} max={input.checkedQuantity} step={1} required value={quantity} onChange={event => setQuantity(Number(event.target.value))} /></label>}
      <label>Motivo (opcional)<textarea maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div><button type="button" className="button secondary" autoFocus onClick={cancel}>Cancelar</button><button type="submit" className="button danger" disabled={!enabled}>Confirmar correção</button></div>
    </form>
  </dialog>;
}
