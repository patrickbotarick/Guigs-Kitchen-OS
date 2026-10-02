import { additionalIngredients, crustsById, flavorsById, ingredientsById } from './catalog';
import type { Ingredient, PizzaDraft, PizzaHalf, PizzaRecipe } from './types';

export function createPizzaDraft(flavorId = 'calabresa'): PizzaDraft & { composition: 'WHOLE' } {
  return { size: 'GRANDE', composition: 'WHOLE', firstHalf: { flavorId, modifiers: [] }, crustId: 'tradicional', notes: null };
}
export function pizzaName(pizza: PizzaRecipe): string {
  const first = flavorsById[pizza.firstHalf.flavorId].name;
  return pizza.composition === 'HALF_HALF' ? `${first} / ${flavorsById[pizza.secondHalf.flavorId].name}` : first;
}
export function crustLabel(pizza: PizzaDraft): string {
  return pizza.crustId === 'tradicional' ? 'Borda tradicional' : `Borda: ${crustsById[pizza.crustId].name}`;
}
export function resolveIngredients(half: PizzaHalf): Ingredient[] {
  const flavor = flavorsById[half.flavorId];
  return [
    ...flavor.ingredientIds.map(id => ({ ...ingredientsById[id], kind: half.modifiers.some(modifier => modifier.type === 'REMOVE' && modifier.ingredientId === id) ? 'REMOVED' as const : 'NORMAL' as const })),
    ...half.modifiers.filter(modifier => modifier.type === 'ADD').map(modifier => ({ ...ingredientsById[modifier.ingredientId], kind: 'ADDED' as const })),
  ];
}
export function validatePizzaDraft(pizza: PizzaDraft): void {
  if (!['BROTO', 'GRANDE'].includes(pizza.size) || !['WHOLE', 'HALF_HALF'].includes(pizza.composition)) throw new Error('Tamanho ou composição inválida.');
  if (pizza.size === 'BROTO' && pizza.composition !== 'WHOLE') throw new Error('Broto aceita somente sabor único.');
  if (pizza.composition === 'WHOLE' && pizza.secondHalf) throw new Error('Pizza inteira não pode ter segunda metade.');
  if (!crustsById[pizza.crustId]) throw new Error('Borda não cadastrada.');
  if (pizza.notes !== null && (typeof pizza.notes !== 'string' || pizza.notes.length > 1000)) throw new Error('Observação deve ter até 1000 caracteres.');
  const halves = pizza.composition === 'HALF_HALF' ? [pizza.firstHalf, pizza.secondHalf] : [pizza.firstHalf];
  for (const half of halves) {
    if (!half || !flavorsById[half.flavorId]) throw new Error('Selecione um sabor do catálogo para cada metade.');
    const seen = new Set<string>();
    for (const modifier of half.modifiers) {
      const key = `${modifier.type}:${modifier.ingredientId}`;
      if (seen.has(key)) throw new Error('Modificador duplicado.');
      seen.add(key);
      if (modifier.type === 'REMOVE') {
        if (!flavorsById[half.flavorId].ingredientIds.includes(modifier.ingredientId)) throw new Error('Só é possível remover ingredientes da ficha selecionada.');
      } else if (modifier.type === 'ADD') {
        if (!additionalIngredients.some(item => item.ingredientId === modifier.ingredientId)) throw new Error('Adicional não listado no cardápio.');
      } else throw new Error('Modificador inválido.');
    }
  }
}
