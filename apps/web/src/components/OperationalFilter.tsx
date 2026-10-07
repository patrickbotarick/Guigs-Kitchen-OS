import { OperationalPopover } from './OperationalPopover';
export function OperationalFilter<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <OperationalPopover className="op-filter" label={label} trigger={open => <><span>{options.find(option => option.value === value)?.label}</span><span aria-hidden="true">{open ? '×' : '▾'}</span></>}>
    {close => <div role="group" aria-label={label}>{options.map(option => <button type="button" key={option.value} aria-pressed={option.value === value} onClick={() => { onChange(option.value); close(); }}>{option.label}</button>)}</div>}
  </OperationalPopover>;
}
