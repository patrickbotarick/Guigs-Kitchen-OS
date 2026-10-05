import { useState } from 'react';
import { pizzaSizes } from '../catalog';
import { crustLabel, halfName, pizzaIngredients, pizzaName } from '../pizzaRecipe';
import type { Ingredient, PizzaAction, PizzaItem } from '../types';
import { AssemblyIcon } from './AssemblyIcons';

function IngredientRow({ ingredient }: { ingredient: Ingredient }) {
  const label = { NORMAL: 'Ingrediente', REMOVED: 'Removido', ADDED: 'Adicional' }[ingredient.kind];
  return <li className={`ka-ingredient ka-ingredient-${ingredient.kind.toLowerCase()}`}><span className="ka-ingredient-symbol"><AssemblyIcon name={ingredient.kind === 'NORMAL' ? 'checkCircle' : ingredient.kind === 'REMOVED' ? 'close' : 'plus'} /></span><span><span className="ka-sr-only">{label}: </span>{ingredient.name}</span></li>;
}
function IngredientList({ ingredients }: { ingredients: Ingredient[] }) {
  return <section className="ka-ingredients"><h3>Ingredientes de montagem</h3><ul>{ingredients.map((ingredient, index) => <IngredientRow key={`${index}-${ingredient.name}`} ingredient={ingredient} />)}</ul></section>;
}
function ObservationBox({ notes }: { notes: string | null }) {
  return <section className="ka-observations"><h3>Observações:</h3><p className={notes ? 'has-notes' : ''}>{notes || 'Nenhuma observação'}</p></section>;
}
function PizzaActions({ pizza, onAction, readOnly, busy }: { pizza: PizzaItem; onAction: (action: PizzaAction) => void; readOnly: boolean; busy: boolean }) {
  if (pizza.status === 'WAITING_OVEN') return <div className="ka-assembly-complete" role="status"><AssemblyIcon name="check" /><strong>Montagem concluída</strong><span>Pizza aguardando forno</span></div>;
  if (!['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'].includes(pizza.status)) return <div className="ka-assembly-complete"><strong>Somente leitura</strong><span>Pizza fora da etapa de montagem</span></div>;
  const action: PizzaAction = pizza.status === 'WAITING_ASSEMBLY' ? 'START' : pizza.paused ? 'RESUME' : 'PAUSE';
  const label = action === 'START' ? 'Iniciar montagem' : action === 'RESUME' ? 'Retomar' : 'Pausar';
  if (readOnly) return <div className="ka-pizza-actions"><button className="ka-start" type="button" disabled>{label}</button><button className="ka-send" type="button" disabled><AssemblyIcon name="flame" /><span>Enviar pro forno<small>Leitura persistida · ações indisponíveis nesta fase</small></span></button></div>;
  return <div className="ka-pizza-actions">
    <button className={`ka-start${action === 'PAUSE' ? ' ka-pause' : ''}`} type="button" disabled={busy} onClick={() => onAction(action)}>{action !== 'PAUSE' && <AssemblyIcon name="play" />}{label}</button>
    <button className="ka-send" type="button" disabled={busy || pizza.status !== 'ASSEMBLING' || pizza.paused} onClick={() => onAction('SEND_TO_OVEN')}><AssemblyIcon name="flame" /><span>Enviar pro forno{pizza.status === 'WAITING_ASSEMBLY' && <small>Disponível após iniciar a montagem</small>}{pizza.paused && <small>Retome a montagem para enviar</small>}</span></button>
  </div>;
}
export function PizzaDetail({ pizza, onAction, readOnly = false, busy = false }: { pizza: PizzaItem; onAction: (action: PizzaAction) => void; readOnly?: boolean; busy?: boolean }) {
  const [halfIndex, setHalfIndex] = useState<0 | 1>(0);
  return <aside className="ka-detail" aria-labelledby="ka-detail-title"><h2 id="ka-detail-title">Pizza selecionada</h2>
    <div className="ka-detail-scroll" key={pizza.id}><header className="ka-detail-header"><h3>{pizzaName(pizza)}</h3><div className="ka-detail-meta"><span>{pizzaSizes[pizza.size].label}</span>{pizza.composition === 'HALF_HALF' && <span>Meio a meio</span>}<span>{crustLabel(pizza)}</span></div></header>
      {pizza.composition === 'HALF_HALF' && <div className="ka-half-selector" role="group" aria-label="Metade exibida">{[0, 1].map(index => <button key={index} type="button" aria-pressed={halfIndex === index} onClick={() => setHalfIndex(index as 0 | 1)}>{index + 1}ª metade — {halfName(pizza, index as 0 | 1)}</button>)}</div>}
      <IngredientList ingredients={pizzaIngredients(pizza, halfIndex)} /><ObservationBox notes={pizza.notes} />
    </div>
    <PizzaActions pizza={pizza} onAction={onAction} readOnly={readOnly} busy={busy} />
  </aside>;
}
