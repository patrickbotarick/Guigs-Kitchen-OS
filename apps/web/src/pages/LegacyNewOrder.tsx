import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createOrderSchema, type CreateOrderInput, type OrderView } from '@guigs/shared';
import { createOrder } from '../api';

type DraftPizza = { key: string; name: string; size: string; ingredients: string; removed: string; added: string; crust: string; notes: string };
const blankPizza = (): DraftPizza => ({ key: crypto.randomUUID(), name: '', size: 'Grande', ingredients: '', removed: '', added: '', crust: '', notes: '' });
const splitNames = (value: string) => value.split(',').map(part => part.trim()).filter(Boolean);

export function LegacyNewOrder() {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [type, setType] = useState<CreateOrderInput['type']>('DELIVERY');
  const [notes, setNotes] = useState('');
  const [pizzas, setPizzas] = useState<DraftPizza[]>([blankPizza()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<OrderView | null>(null);
  const sending = useRef(false);

  function editPizza(key: string, field: keyof Omit<DraftPizza, 'key'>, value: string) {
    setPizzas(current => current.map(pizza => pizza.key === key ? { ...pizza, [field]: value } : pizza));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setSaving(true);
    setError('');
    const input = {
      customerName, customerPhone, type, notes,
      items: pizzas.map(pizza => ({
        name: pizza.name, size: pizza.size, ingredients: pizza.ingredients, notes: pizza.notes,
        modifiers: [
          ...splitNames(pizza.removed).map(name => ({ kind: 'REMOVED' as const, name })),
          ...splitNames(pizza.added).map(name => ({ kind: 'ADDED' as const, name })),
          ...(pizza.crust.trim() ? [{ kind: 'CRUST' as const, name: pizza.crust.trim() }] : []),
        ],
      })),
    };
    try {
      const valid = createOrderSchema.safeParse(input);
      if (!valid.success) throw new Error('Confira os campos obrigatórios e os limites de texto.');
      setCreated(await createOrder(valid.data));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar o pedido.');
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }

  function reset() {
    setCustomerName(''); setCustomerPhone(''); setType('DELIVERY'); setNotes('');
    setPizzas([blankPizza()]); setCreated(null); setError('');
  }

  return <div className="page form-page">
    <div className="page-head"><div><div className="eyebrow">SIMULADOR · ENTRADA MANUAL</div><h1>Novo pedido de teste</h1><p>Preencha os dados abaixo para enviar um pedido à cozinha.</p></div><Link className="text-link" to="/kitchen">Ver fila da cozinha ↗</Link></div>
    {created ? <section className="success" role="status"><div className="success-mark">✓</div><div className="eyebrow">PEDIDO CRIADO</div><h2>#{String(created.number).padStart(4, '0')} enviado à cozinha</h2><p>O pedido de {created.customerName} foi salvo e já está na fila de produção.</p><div className="actions"><button className="button primary" type="button" onClick={reset}>Criar outro pedido</button><Link className="button secondary" to="/kitchen">Abrir fila</Link></div></section> :
      <form onSubmit={event => void submit(event)}>
        <section className="form-section"><div className="section-heading"><span className="step">01</span><div><h2>Dados do pedido</h2><p>Quem pediu e como será atendido.</p></div></div>
          <div className="form-grid"><label>Cliente <span>*</span><input required maxLength={120} value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="Nome do cliente" /></label><label>Telefone <small>opcional</small><input maxLength={30} value={customerPhone} onChange={event => setCustomerPhone(event.target.value)} placeholder="(00) 00000-0000" /></label></div>
          <fieldset className="type-field"><legend>Tipo de atendimento <span>*</span></legend><div className="type-options"><label className={type === 'DELIVERY' ? 'selected' : ''}><input type="radio" name="type" checked={type === 'DELIVERY'} onChange={() => setType('DELIVERY')} />Delivery</label><label className={type === 'PICKUP' ? 'selected' : ''}><input type="radio" name="type" checked={type === 'PICKUP'} onChange={() => setType('PICKUP')} />Retirada</label></div></fieldset>
          <label>Observação do pedido <small>opcional</small><textarea maxLength={1000} rows={2} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Instruções gerais" /></label>
        </section>
        <section className="form-section"><div className="section-heading"><span className="step">02</span><div><h2>Pizzas</h2><p>Adicione uma ou mais pizzas. Separe ingredientes por vírgula.</p></div></div>
          <div className="pizza-forms">{pizzas.map((pizza, index) => <div className="pizza-form" key={pizza.key}>
            <div className="pizza-form-head"><h3>Pizza {index + 1}</h3>{pizzas.length > 1 && <button className="remove-button" type="button" onClick={() => setPizzas(current => current.filter(item => item.key !== pizza.key))}>Remover</button>}</div>
            <div className="form-grid"><label>Sabor / nome <span>*</span><input required maxLength={120} list="flavors" value={pizza.name} onChange={event => editPizza(pizza.key, 'name', event.target.value)} placeholder="Ex: Portuguesa" /></label><label>Tamanho <span>*</span><select value={pizza.size} onChange={event => editPizza(pizza.key, 'size', event.target.value)}><option>Pequena</option><option>Média</option><option>Grande</option></select></label></div>
            <label>Ingredientes / descrição <small>opcional</small><input maxLength={1000} value={pizza.ingredients} onChange={event => editPizza(pizza.key, 'ingredients', event.target.value)} placeholder="Ex: mussarela, ovo, presunto" /></label>
            <div className="form-grid"><label>Remover ingredientes <small>opcional</small><input value={pizza.removed} onChange={event => editPizza(pizza.key, 'removed', event.target.value)} placeholder="Ex: cebola, azeitona" /></label><label>Adicionais <small>opcional</small><input value={pizza.added} onChange={event => editPizza(pizza.key, 'added', event.target.value)} placeholder="Ex: bacon, queijo" /></label></div>
            <div className="form-grid"><label>Borda <small>opcional</small><input maxLength={120} value={pizza.crust} onChange={event => editPizza(pizza.key, 'crust', event.target.value)} placeholder="Ex: Catupiry" /></label><label>Observação da pizza <small>opcional</small><input maxLength={1000} value={pizza.notes} onChange={event => editPizza(pizza.key, 'notes', event.target.value)} placeholder="Ex: cortar em 8 pedaços" /></label></div>
          </div>)}</div>
          <datalist id="flavors"><option value="Calabresa" /><option value="Portuguesa" /><option value="Mussarela" /><option value="Frango com Catupiry" /></datalist>
          <button className="add-button" type="button" onClick={() => setPizzas(current => [...current, blankPizza()])}>+ Adicionar pizza</button>
        </section>
        {error && <div className="alert" role="alert">{error}</div>}
        <div className="submit-row"><span>Este pedido será enviado imediatamente à fila da cozinha.</span><button className="button primary" type="submit" disabled={saving}>{saving ? 'Enviando...' : 'Criar pedido →'}</button></div>
      </form>}
  </div>;
}
