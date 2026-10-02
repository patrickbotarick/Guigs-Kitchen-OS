import { useState } from 'react';
import { flavorsById, pizzaSizes } from '../catalog';
import { crustLabel, pizzaName, resolveIngredients } from '../pizzaRecipe';
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
function PizzaActions({ pizza, onAction }: { pizza: PizzaItem; onAction: (action: PizzaAction) => void }) {
  if (pizza.status === 'OVEN') return <div className="ka-pizza-done" role="status"><AssemblyIcon name="check" /><strong>Montagem concluída</strong><span>Pizza enviada para o forno</span></div>;
  const action: PizzaAction = pizza.status === 'WAITING' ? 'START' : pizza.paused ? 'RESUME' : 'PAUSE';
  const label = action === 'START' ? 'Iniciar montagem' : action === 'RESUME' ? 'Retomar' : 'Pausar';
  return <div className="ka-pizza-actions">
    <button className={`ka-start${action === 'PAUSE' ? ' ka-pause' : ''}`} type="button" onClick={() => onAction(action)}>{action !== 'PAUSE' && <AssemblyIcon name="play" />}{label}</button>
    <button className="ka-send" type="button" disabled={pizza.status !== 'IN_PRODUCTION' || pizza.paused} onClick={() => onAction('SEND_TO_OVEN')}><AssemblyIcon name="flame" /><span>Enviar pro forno{pizza.status === 'WAITING' && <small>Disponível após iniciar a montagem</small>}{pizza.paused && <small>Retome a montagem para enviar</small>}</span></button>
  </div>;
}
export function PizzaDetail({ pizza, onAction }: { pizza: PizzaItem; onAction: (action: PizzaAction) => void }) {
  const [halfIndex, setHalfIndex] = useState<0 | 1>(0);
  const half = halfIndex === 1 && pizza.composition === 'HALF_HALF' ? pizza.secondHalf : pizza.firstHalf;
  return <aside className="ka-detail" aria-labelledby="ka-detail-title"><h2 id="ka-detail-title">Pizza selecionada</h2>
    <div className="ka-detail-scroll" key={pizza.id}><header className="ka-detail-header"><h3>{pizzaName(pizza)}</h3><div className="ka-detail-meta"><span>{pizzaSizes[pizza.size].label}</span>{pizza.composition === 'HALF_HALF' && <span>Meio a meio</span>}<span>{crustLabel(pizza)}</span></div></header>
      {pizza.composition === 'HALF_HALF' && <div className="ka-half-selector" role="group" aria-label="Metade exibida">{[pizza.firstHalf, pizza.secondHalf].map((part, index) => <button key={index} type="button" aria-pressed={halfIndex === index} onClick={() => setHalfIndex(index as 0 | 1)}>{index + 1}ª metade — {flavorsById[part.flavorId].name}</button>)}</div>}
      <IngredientList ingredients={resolveIngredients(half)} /><ObservationBox notes={pizza.notes} />
    </div>
    <PizzaActions pizza={pizza} onAction={onAction} />
  </aside>;
}
