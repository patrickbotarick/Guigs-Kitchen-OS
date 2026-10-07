import type { PizzaItem } from '@guigs/shared';
import { AssemblyIcon } from '../kitchen/components/AssemblyIcons';
import { ovenFlavor } from '../oven/oven';

export function PhysicalPizzaSummary({ pizza }: { pizza: PizzaItem }) {
  const recipe = pizza.snapshot;
  const halves = [recipe.firstHalf, ...(recipe.secondHalf ? [recipe.secondHalf] : [])];
  return <div className="physical-pizza"><div className="physical-pizza-heading"><strong>Pizza {pizza.position + 1} · {ovenFlavor(pizza)}</strong><span className="physical-pizza-meta">{recipe.size === 'BROTO' ? 'Broto' : 'Grande'} · {recipe.composition === 'HALF_HALF' ? 'Meio a meio' : 'Inteira'}</span></div><span className="physical-pizza-meta">Borda: {recipe.crust.name}</span><ul className="physical-modifiers">{halves.flatMap((half, index) => half.ingredients.filter(ingredient => ingredient.kind !== 'NORMAL').map(ingredient => <li className={`physical-modifier ka-ingredient-${ingredient.kind.toLowerCase()}`} key={`${index}-${ingredient.kind}-${ingredient.ingredientId}`}><AssemblyIcon name={ingredient.kind === 'REMOVED' ? 'close' : 'plus'} /><span>{ingredient.kind === 'REMOVED' ? 'Sem ' : '+ '}{ingredient.name}{recipe.composition === 'HALF_HALF' && <small> · {index + 1}ª metade ({half.name})</small>}</span></li>))}</ul>{recipe.notes && <p className="physical-pizza-notes">{recipe.notes}</p>}</div>;
}
