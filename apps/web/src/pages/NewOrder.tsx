import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createStructuredOrderSchema, type CreateStructuredOrderInput, type Order } from '@guigs/shared';
import { extraCatalog } from '@guigs/shared/catalog';
import { ApiError, createStructuredOrder } from '../api';
import { PizzaBuilder } from '../features/kitchen/components/PizzaBuilder';
import { createPizzaDraft } from '../features/kitchen/pizzaRecipe';
import type { PizzaDraft } from '../features/kitchen/types';
import '../features/kitchen/assembly.css';

// getRandomValues also works over LAN HTTP, where randomUUID requires HTTPS.
function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
type DraftExtra = { extraCatalogId: string; quantity: number; notes: string | null };
type PizzaEntry = { key: string; pizza: PizzaDraft };
const blankPizza = (): PizzaEntry => ({ key: requestId(), pizza: createPizzaDraft() });
const pendingStorageKey = 'guigs-counter-v2-pending';
function readPending(): CreateStructuredOrderInput | null {
  try {
    const saved = sessionStorage.getItem(pendingStorageKey);
    const parsed = saved ? createStructuredOrderSchema.safeParse(JSON.parse(saved)) : null;
    return parsed?.success ? parsed.data : null;
  } catch { return null; }
}
function storePending(input: CreateStructuredOrderInput | null) {
  try {
    if (input) sessionStorage.setItem(pendingStorageKey, JSON.stringify(input));
    else sessionStorage.removeItem(pendingStorageKey);
  } catch { /* In-memory retry remains available if browser storage is disabled. */ }
}

export function NewOrder() {
  const [restored] = useState(readPending);
  const [customerName, setCustomerName] = useState(restored?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(restored?.customerPhone ?? '');
  const [fulfillmentType, setFulfillmentType] = useState<CreateStructuredOrderInput['fulfillmentType']>(restored?.fulfillmentType ?? 'DELIVERY');
  const [channel, setChannel] = useState<CreateStructuredOrderInput['channel']>(restored?.channel ?? 'COUNTER');
  const [notes, setNotes] = useState(restored?.notes ?? '');
  const [pizzas, setPizzas] = useState<PizzaEntry[]>(() => restored?.pizzas.map(pizza => ({ key: requestId(), pizza })) ?? [blankPizza()]);
  const [extras, setExtras] = useState<DraftExtra[]>(restored?.extras ?? []);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<CreateStructuredOrderInput | null>(restored);
  const [error, setError] = useState(restored ? 'Há um envio pendente de confirmação nesta aba.' : '');
  const [created, setCreated] = useState<Order | null>(null);
  const sending = useRef(false);
  const clientRequestId = useRef(restored?.clientRequestId ?? requestId());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true; setSaving(true); setError('');
    try {
      const valid = createStructuredOrderSchema.safeParse(pending ?? {
        clientRequestId: clientRequestId.current, customerName, customerPhone, fulfillmentType, channel, notes,
        pizzas: pizzas.map(entry => entry.pizza), extras,
      });
      if (!valid.success) throw new Error('Confira os campos obrigatórios e os limites: até 30 pizzas e 30 unidades de extras.');
      // Freeze the exact payload until the server confirms it; retries reuse its key.
      setPending(valid.data);
      storePending(valid.data);
      setCreated(await createStructuredOrder(valid.data));
      setPending(null); storePending(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 400) {
        setPending(null); storePending(null); clientRequestId.current = requestId();
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar o envio.');
    } finally { sending.current = false; setSaving(false); }
  }
  function reset() {
    setCustomerName(''); setCustomerPhone(''); setFulfillmentType('DELIVERY'); setChannel('COUNTER'); setNotes('');
    setPizzas([blankPizza()]); setExtras([]); setCreated(null); setError(''); setPending(null); storePending(null); clientRequestId.current = requestId();
  }

  return <div className="page form-page">
    <div className="page-head"><div><div className="eyebrow">BALCÃO · ENTRADA MANUAL</div><h1>Novo pedido de teste</h1><p>Selecione pizzas e extras do catálogo.</p></div><Link className="text-link" to="/orders/new/legacy">Formulário legado ↗</Link></div>
    {created ? <section className="success" role="status"><div className="success-mark">✓</div><div className="eyebrow">PEDIDO SALVO</div><h2>#{String(created.number).padStart(4, '0')} aguardando montagem</h2><p>Pedido de {created.customerName} salvo com {created.items.filter(item => item.kind === 'PIZZA').length} pizza(s).</p><p>Este pedido pode ser consultado na fila de montagem.</p><div className="actions"><button className="button primary" type="button" onClick={reset}>Criar outro pedido</button><Link className="button secondary" to="/kitchen/assembly">Abrir montagem</Link></div></section> :
      <form onSubmit={event => void submit(event)}>
        <fieldset disabled={saving || pending !== null} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <section className="form-section"><div className="section-heading"><span className="step">01</span><div><h2>Dados do pedido</h2><p>Quem pediu e como será atendido.</p></div></div>
            <div className="form-grid"><label>Cliente <span>*</span><input required maxLength={120} value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="Nome do cliente" /></label><label>Telefone <small>opcional</small><input maxLength={30} value={customerPhone} onChange={event => setCustomerPhone(event.target.value)} /></label></div>
            <div className="form-grid"><label>Tipo de atendimento<select value={fulfillmentType} onChange={event => setFulfillmentType(event.target.value as typeof fulfillmentType)}><option value="DELIVERY">Delivery</option><option value="PICKUP">Retirada</option></select></label><label>Canal<select value={channel} onChange={event => setChannel(event.target.value as typeof channel)}><option value="COUNTER">Balcão</option><option value="WHATSAPP">WhatsApp (entrada manual)</option><option value="IFOOD">iFood (entrada manual)</option><option value="OTHER">Outro</option></select></label></div>
            <label>Observação do pedido<textarea maxLength={1000} rows={2} value={notes} onChange={event => setNotes(event.target.value)} /></label>
          </section>
          <section className="form-section"><div className="section-heading"><span className="step">02</span><div><h2>Pizzas</h2><p>Até 30 pizzas, com modificadores independentes por metade.</p></div></div>
            <div className="pizza-forms">{pizzas.map((entry, index) => <div className="pizza-form" key={entry.key}><div className="pizza-form-head"><h3>Pizza {index + 1}</h3>{pizzas.length > 1 && <button className="remove-button" type="button" onClick={() => setPizzas(current => current.filter(item => item.key !== entry.key))}>Remover pizza {index + 1}</button>}</div><PizzaBuilder pizza={entry.pizza} index={index} onChange={pizza => setPizzas(current => current.map(item => item.key === entry.key ? { ...item, pizza } : item))} /></div>)}</div>
            <button className="add-button" type="button" disabled={pizzas.length >= 30} onClick={() => setPizzas(current => [...current, blankPizza()])}>+ Adicionar pizza</button>
          </section>
          <section className="form-section"><div className="section-heading"><span className="step">03</span><div><h2>Extras</h2><p>Selecione itens e quantidades. Limite de 30 unidades.</p></div></div>
            {extraCatalog.map(entry => {
              const selected = extras.find(extra => extra.extraCatalogId === entry.id);
              return <div className="form-grid" key={entry.id}><label>{entry.name}<input aria-label={`Quantidade — ${entry.name}`} type="number" min={0} max={30} value={selected?.quantity ?? 0} onChange={event => {
                const quantity = Number(event.target.value);
                setExtras(current => [...current.filter(extra => extra.extraCatalogId !== entry.id), ...(quantity > 0 ? [{ extraCatalogId: entry.id, quantity, notes: selected?.notes ?? null }] : [])]);
              }} /></label>{selected && <label>Observação de {entry.name}<input maxLength={1000} value={selected.notes ?? ''} onChange={event => setExtras(current => current.map(extra => extra.extraCatalogId === entry.id ? { ...extra, notes: event.target.value || null } : extra))} /></label>}</div>;
            })}
          </section>
        </fieldset>
        {error && <div className="alert" role="alert">{error}{pending && <p>O envio ainda não foi confirmado. Tente novamente para recuperar o mesmo pedido; os dados estão preservados.</p>}</div>}
        <div className="submit-row"><span>As pizzas serão salvas aguardando montagem.</span><button className="button primary" type="submit" disabled={saving}>{saving ? 'Enviando...' : pending ? 'Confirmar envio novamente' : 'Criar pedido →'}</button></div>
      </form>}
  </div>;
}
