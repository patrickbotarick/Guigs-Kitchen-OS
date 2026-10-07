import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function OperationalPopover({ label, trigger, children, upward = false, className = '' }: {
  label: string; trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; upward?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false), id = useId();
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); button.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div ref={root} className={`op-popover ${upward ? 'op-popover-up' : ''} ${className}`}>
    <button type="button" ref={button} className="op-trigger" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} onKeyDown={event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('a, button:not(:disabled), summary')?.focus()); }
    }}>{trigger(open)}</button>
    {open && <div className="op-panel" ref={panel} id={id} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('a, button:not(:disabled), summary') ?? [])].filter(item => item.getClientRects().length);
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (index < 0) return;
      event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }}>{children(close)}</div>}
  </div>;
}
