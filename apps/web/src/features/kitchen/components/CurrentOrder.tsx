import { canCompleteAssembly, assemblyCompletedPizzas, orderStage, pizzasOf } from '../assembly';
import { pizzaSizes } from '../catalog';
import { crustLabel, pizzaName } from '../pizzaRecipe';
import type { AssemblyOrder, PizzaItem } from '../types';
import { AssemblyIcon, type IconName } from './AssemblyIcons';
import { ChannelBadge, OrderCounts, WaitTime } from './OrderQueue';

export function pizzaStatusLabel(pizza: PizzaItem) {
  const persistedLabels = { ASSEMBLY_PAUSED: 'Pausada', IN_OVEN: 'No forno', BAKED: 'Assada', FINISHING: 'Em finalização', FINISHED: 'Finalizada', CANCELLED: 'Cancelada' };
  if (pizza.status in persistedLabels) return persistedLabels[pizza.status as keyof typeof persistedLabels];
  if (pizza.status === 'WAITING_OVEN') return 'Aguardando forno';
  if (pizza.paused) return 'Pausada';
  return pizza.status === 'ASSEMBLING' ? 'Em montagem' : 'Aguardando';
}
function OrderHeader({ order, now }: { order: AssemblyOrder; now: number }) {
  return <header className="ka-order-header"><div className="ka-order-title"><h1>Pedido #{order.number}</h1><ChannelBadge channel={order.channel} /><WaitTime receivedAt={order.receivedAt} now={now} /></div><div className="ka-order-subtitle"><span>{order.customerName}</span><OrderCounts order={order} /></div></header>;
}
function PizzaCard({ pizza, index, selected, onSelect }: { pizza: PizzaItem; index: number; selected: boolean; onSelect: () => void }) {
  return <button type="button" className={`ka-pizza-card ka-pizza-${pizza.status.toLowerCase()}${selected ? ' is-selected' : ''}`} aria-pressed={selected} aria-label={`Pizza ${index + 1}, ${pizzaName(pizza)}, ${pizzaStatusLabel(pizza)}`} onClick={onSelect}>
    <span className="ka-pizza-card-top"><span className="ka-pizza-number">{pizza.status === 'WAITING_OVEN' ? <AssemblyIcon name="check" /> : index + 1}</span><strong>{pizzaName(pizza)}</strong><span className="ka-pizza-status">{pizzaStatusLabel(pizza)}</span></span>
    <span className="ka-pizza-meta"><span>{pizzaSizes[pizza.size].label}</span>{pizza.composition === 'HALF_HALF' && <span>Meio a meio</span>}<span>{crustLabel(pizza)}</span></span>
    {pizza.assignment && <span className="ka-pizza-meta">Montador: {pizza.assignment.operatorName}</span>}
  </button>;
}
const stages: { label: string; icon: IconName }[] = [
    { label: 'Na fila', icon: 'queue' }, { label: 'Montagem', icon: 'assembly' }, { label: 'Forno', icon: 'oven' },
  { label: 'Finalização', icon: 'check' }, { label: 'Concluído', icon: 'flag' },
];
function OrderTimeline({ order }: { order: AssemblyOrder }) {
  const active = { WAITING_PRODUCTION: 0, IN_PRODUCTION: 1, OVEN: 2 }[orderStage(order)];
  return <ol className="ka-timeline" aria-label="Etapas do pedido">{stages.map((stage, index) => <li key={stage.label} className={index <= active ? 'is-reached' : ''} aria-current={index === active ? 'step' : undefined}><span className="ka-stage-icon"><AssemblyIcon name={stage.icon} /></span><span>{stage.label}</span></li>)}</ol>;
}
function CompleteAssemblyButton({ order, onCompleteAssembly, readOnly }: { order: AssemblyOrder; onCompleteAssembly: () => void; readOnly: boolean }) {
  const ready = !readOnly && canCompleteAssembly(order);
  return <div className="ka-complete"><button type="button" disabled={!ready} onClick={onCompleteAssembly} aria-describedby="ka-complete-hint"><AssemblyIcon name="check" />Concluir montagem</button><span id="ka-complete-hint">{readOnly ? 'Pedido avança automaticamente após enviar todas as pizzas ao forno' : ready ? 'Montagem pronta · seguir para o forno' : 'Disponível após montar todas as pizzas'}</span></div>;
}
export function CurrentOrder({ order, selectedPizzaId, now, onSelectPizza, onCompleteAssembly, readOnly = false, visiblePizzaIds }: { order: AssemblyOrder; selectedPizzaId: string | undefined; now: number; onSelectPizza: (id: string) => void; onCompleteAssembly: () => void; readOnly?: boolean; visiblePizzaIds?: string[] }) {
  const pizzas = pizzasOf(order);
  return <section className="ka-current" aria-label={`Pedido atual #${order.number}`}>
    <OrderHeader order={order} now={now} />
    <div className="ka-pizzas-heading"><h2>Pizzas do pedido ({pizzas.length}){visiblePizzaIds && visiblePizzaIds.length < pizzas.length && <small> · exibidas {visiblePizzaIds.length}</small>}</h2><span role="status">Montagens concluídas ({assemblyCompletedPizzas(order)} / {pizzas.length})</span></div>
    <div className="ka-order-scroll" key={order.id}>
      {order.notes && <div className="ka-order-note" aria-label="Observação do pedido"><strong>Observação do pedido</strong><p>{order.notes}</p></div>}
      <div className="ka-pizza-grid">{pizzas.map((pizza, index) => (!visiblePizzaIds || visiblePizzaIds.includes(pizza.id)) && <PizzaCard key={pizza.id} pizza={pizza} index={index} selected={pizza.id === selectedPizzaId} onSelect={() => onSelectPizza(pizza.id)} />)}</div>
    </div>
    <footer className="ka-order-footer"><OrderTimeline order={order} /><CompleteAssemblyButton order={order} onCompleteAssembly={onCompleteAssembly} readOnly={readOnly} /></footer>
  </section>;
}
