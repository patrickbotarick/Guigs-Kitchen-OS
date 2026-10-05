import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { channelLabels } from '../components/OrderQueue';
import { createMockOrder } from '../mockOrders';
import { createPizzaDraft } from '../pizzaRecipe';
import { catalogReviews, pizzaFlavors } from '../catalog';
import { PizzaBuilder } from '../components/PizzaBuilder';
import type { OrderChannel, SimulatedOrderInput } from '../types';
import { useAssembly } from '../useAssembly';

export function KitchenSimulatorPage() {
  const { state, dispatch } = useAssembly();
  const navigate = useNavigate();
  const [input, setInput] = useState<SimulatedOrderInput>({ customerName: 'Cliente de teste', channel: 'WHATSAPP', pizzas: Array.from({ length: 3 }, () => createPizzaDraft()), extraCount: 0 });
  const [quantity, setQuantity] = useState('3');
  const [error, setError] = useState('');
  function arrive(event: FormEvent) {
    event.preventDefault();
    const receivedAt = new Date().toISOString();
    try {
      createMockOrder(state.nextNumber, input, receivedAt);
      dispatch({ type: 'ARRIVE', input, receivedAt });
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Confira os campos.'); }
  }
  return <div className="ka-dev page form-page"><div className="page-head"><div><div className="eyebrow">DESENVOLVIMENTO · SIMULATOR 2.0</div><h1>Simulador da montagem</h1><p>{pizzaFlavors.length} sabores do cardápio oficial. Dados em memória nesta aba. Recarregar reinicia a demonstração. Nenhum pedido é gravado na API ou no banco.</p></div><Link className="button secondary" to="/kitchen/assembly">Abrir montagem</Link></div>
    <form className="form-section" onSubmit={arrive}><h2>Simular chegada de pedido</h2>
      <label>Cliente<input required maxLength={120} value={input.customerName} onChange={event => setInput({ ...input, customerName: event.target.value })} /></label>
      <div className="form-grid"><label>Canal<select aria-label="Canal" value={input.channel} onChange={event => setInput({ ...input, channel: event.target.value as OrderChannel })}>{Object.entries(channelLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>Quantidade de pizzas<input type="number" required min={1} max={30} value={quantity} onChange={event => {
          setQuantity(event.target.value);
          const count = event.target.valueAsNumber;
          if (Number.isInteger(count) && count >= 1 && count <= 30) setInput(current => ({ ...current, pizzas: Array.from({ length: count }, (_, index) => current.pizzas[index] ?? createPizzaDraft()) }));
        }} /></label></div>
      <label>Quantidade de extras<input type="number" required min={0} max={30} value={input.extraCount} onChange={event => setInput({ ...input, extraCount: event.target.valueAsNumber })} /><small>Somente contador. Os extras serão tratados pelo balcão e pela finalização.</small></label>
      {input.pizzas.map((pizza, index) => <PizzaBuilder key={index} pizza={pizza} index={index} onChange={next => setInput(current => ({ ...current, pizzas: current.pizzas.map((item, itemIndex) => itemIndex === index ? next : item) }))} />)}
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="actions"><button className="button primary" type="submit">Simular chegada de novo pedido</button><button className="button secondary" type="button" onClick={() => navigate('/kitchen/assembly')}>Voltar à fila ({state.orders.length})</button></div>
      <p role="status">{state.notice}</p>
    </form>
    <section className="form-section"><h2>Montagens concluídas ({state.handoffs.length})</h2><p>Registro local da transferência. As pizzas ainda precisam passar pelo forno e pela finalização.</p>{state.handoffs.length ? <ul>{state.handoffs.map(event => <li key={event.order.id}>Pedido #{event.order.number} · {event.order.customerName} · Montagem → Fila do forno</li>)}</ul> : <p>Nenhum pedido transferido.</p>}</section>
    <details className="form-section ka-catalog-review"><summary>Catálogo oficial · pontos para revisão</summary><ul>{catalogReviews.map(review => <li key={review.id}><code>{review.status}</code>: {review.detail}</li>)}</ul></details>
  </div>;
}
