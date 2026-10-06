import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createStructuredOrderSchema, type CreateStructuredOrderInput, type Order } from '@guigs/shared';
import { extraCatalog } from '@guigs/shared/catalog';
import { ApiError, createStructuredOrder } from '../api';
import { PizzaBuilder } from '../features/kitchen/components/PizzaBuilder';
import { createPizzaDraft, crustLabel, pizzaName } from '../features/kitchen/pizzaRecipe';
import type { PizzaDraft } from '../features/kitchen/types';
import '../features/kitchen/assembly.css';
import { clientId as requestId } from '../utils/clientId';

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
  const [editingKey, setEditingKey] = useState<string | null>(() => pizzas[0]?.key ?? null);
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
    const next = blankPizza(); setPizzas([next]); setEditingKey(next.key); setExtras([]); setCreated(null); setError(''); setPending(null); storePending(null); clientRequestId.current = requestId();
  }

  return <div className="page form-page">
    <div className="page-head"><div><div className="eyebrow">SIMULADOR · ENTRADA FUTURA SAIPOS</div><h1 aria-label="Novo pedido de teste">Simulador de Pedido</h1><p>Simula a entrada que futuramente será recebida da Saipos e envia o pedido ao fluxo real do Kitchen OS.</p></div><Link className="text-link" to="/orders/new/legacy">Formulário legado ↗</Link></div>
    {created ? <section className="success" role="status"><div className="success-mark">✓</div><div className="eyebrow">PEDIDO SALVO</div><h2>#{String(created.number).padStart(4, '0')} aguardando montagem</h2><p>Pedido de {created.customerName} salvo com {created.items.filter(item => item.kind === 'PIZZA').length} pizza(s).</p><p>Este pedido pode ser consultado na fila de montagem.</p><div className="actions"><button className="button primary" type="button" onClick={reset}>Criar outro pedido</button><Link className="button secondary" to="/kitchen/assembly">Abrir montagem</Link></div></section> :
      <form onSubmit={event => void submit(event)}>
        <fieldset disabled={saving || pending !== null} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <section className="form-section"><div className="section-heading"><span className="step">01</span><div><h2>Dados do pedido</h2><p>Quem pediu e como será atendido.</p></div></div>
            <div className="form-grid"><label>Cliente <span>*</span><input required maxLength={120} value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="Nome do cliente" /></label><label>Telefone <small>opcional</small><input maxLength={30} value={customerPhone} onChange={event => setCustomerPhone(event.target.value)} /></label></div>
            <div className="form-grid"><label>Tipo de atendimento<select value={fulfillmentType} onChange={event => setFulfillmentType(event.target.value as typeof fulfillmentType)}><option value="DELIVERY">Delivery</option><option value="PICKUP">Retirada</option></select></label><label>Canal<select value={channel} onChange={event => setChannel(event.target.value as typeof channel)}><option value="COUNTER">Balcão</option><option value="WHATSAPP">WhatsApp (entrada manual)</option><option value="IFOOD">iFood (entrada manual)</option><option value="OTHER">Outro</option></select></label></div>
            <label>Observação do pedido<textarea maxLength={1000} rows={2} value={notes} onChange={event => setNotes(event.target.value)} /></label>
          </section>
          <section className="form-section simulator-pizzas"><div className="section-heading"><span className="step">02</span><div><h2>Pizzas</h2><p>Até 30 pizzas, com modificadores independentes por metade.</p></div></div>
            <div className="pizza-summary-list">{pizzas.map((entry, index) => {
              const modifications = [...entry.pizza.firstHalf.modifiers, ...(entry.pizza.composition === 'HALF_HALF' ? entry.pizza.secondHalf.modifiers : [])];
              const removals = modifications.filter(modifier => modifier.type === 'REMOVE').length;
              const additions = modifications.filter(modifier => modifier.type === 'ADD').length;
              const editing = editingKey === entry.key;
              return <article className={`simulator-pizza-card${editing ? ' is-editing' : ''}`} key={entry.key}>
                <div className="simulator-pizza-card-head"><div><span className="pizza-index">{index + 1}</span><h3>Pizza {index + 1}</h3></div><div className="simulator-pizza-actions"><button className="button subtle" type="button" onClick={() => setEditingKey(editing ? null : entry.key)}>{editing ? 'Fechar edição' : 'Editar'}</button>{<button className="button subtle" type="button" onClick={() => { const copy = { key: requestId(), pizza: JSON.parse(JSON.stringify(entry.pizza)) as PizzaDraft }; setPizzas(current => [...current.slice(0, index + 1), copy, ...current.slice(index + 1)]); setEditingKey(copy.key); }}>Duplicar</button>}{pizzas.length > 1 && <button className="remove-button" type="button" onClick={() => { setPizzas(current => current.filter(item => item.key !== entry.key)); if (editing) setEditingKey(null); }}>Remover</button>}</div></div>
                <div className="simulator-pizza-summary"><strong>{entry.pizza.size === 'BROTO' ? 'Broto' : 'Grande'} · {entry.pizza.composition === 'HALF_HALF' ? 'Meio a meio' : 'Inteira'}</strong><span>{pizzaName(entry.pizza)}</span><small>{crustLabel(entry.pizza)} · {removals} remoção(ões) · {additions} adicional(is){entry.pizza.notes ? ' · com observação' : ''}</small></div>
                <div className={`pizza-form${editing ? ' is-active-editor' : ''}`}><PizzaBuilder pizza={entry.pizza} index={index} onChange={pizza => setPizzas(current => current.map(item => item.key === entry.key ? { ...item, pizza } : item))} /></div>
              </article>;
            })}</div>
            <button className="add-button" type="button" disabled={pizzas.length >= 30} onClick={() => { const next = blankPizza(); setPizzas(current => [...current, next]); setEditingKey(next.key); }}>+ Adicionar pizza</button>
          </section>
          <section className="form-section"><div className="section-heading"><span className="step">03</span><div><h2>Extras</h2><p>Selecione itens e quantidades. Limite de 30 unidades.</p></div></div>
            <div className="extra-summary">{extras.length === 0 ? <span>Nenhum extra selecionado</span> : <strong>{extras.reduce((sum, extra) => sum + extra.quantity, 0)} unidades · {extras.length} tipo(s)</strong>}</div>
            <div className="structured-extras">{extraCatalog.map(entry => {
              const selected = extras.find(extra => extra.extraCatalogId === entry.id);
              return <div className={`extra-entry${selected ? ' is-selected' : ''}`} key={entry.id}><label><span>{entry.name}</span><input aria-label={`Quantidade — ${entry.name}`} type="number" min={0} max={30} value={selected?.quantity ?? 0} onChange={event => {
                const quantity = Number(event.target.value);
                setExtras(current => [...current.filter(extra => extra.extraCatalogId !== entry.id), ...(quantity > 0 ? [{ extraCatalogId: entry.id, quantity, notes: selected?.notes ?? null }] : [])]);
              }} /></label>{selected && <label>Observação<input aria-label={`Observação de ${entry.name}`} maxLength={1000} value={selected.notes ?? ''} onChange={event => setExtras(current => current.map(extra => extra.extraCatalogId === entry.id ? { ...extra, notes: event.target.value || null } : extra))} /></label>}</div>;
            })}</div>
          </section>
        </fieldset>
        {error && <div className="alert" role="alert">{error}{pending && <p>O envio ainda não foi confirmado. Tente novamente para recuperar o mesmo pedido; os dados estão preservados.</p>}</div>}
        <div className="simulator-submit"><div><strong>Resumo do pedido</strong><span>{pizzas.length} {pizzas.length === 1 ? 'pizza' : 'pizzas'} · {extras.reduce((sum, extra) => sum + extra.quantity, 0)} {extras.reduce((sum, extra) => sum + extra.quantity, 0) === 1 ? 'extra' : 'extras'} · {fulfillmentType === 'DELIVERY' ? 'Delivery' : 'Retirada'} · {channel === 'COUNTER' ? 'Balcão' : channel}</span><small>Envia ao POST /orders/v2 e distribui automaticamente para a Montagem.</small></div><button className="button primary" aria-label={pending ? 'Confirmar envio novamente' : 'Criar pedido →'} type="submit" disabled={saving}>{saving ? 'Enviando ao fluxo...' : pending ? 'Confirmar envio novamente' : 'Enviar ao fluxo do Kitchen OS'}</button></div>
      </form>}
  </div>;
}
