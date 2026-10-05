// Transcribed from the four visually verified pages of Cardapio Guig's Vertical 2026.pdf.
// No culinary defaults: recipe order and ingredient wording follow the primary category.
export type PizzaCategory = 'TRADICIONAL' | 'ESPECIAL' | 'PREMIUM' | 'DOCE';
export type { PizzaSize, PizzaComposition } from './kitchen.js';
import type { PizzaSize, RecipeCatalog } from './kitchen.js';
export interface CatalogIngredient { id: string; name: string }
export interface PizzaFlavor {
  id: string; name: string; category: PizzaCategory; ingredientIds: string[];
  sourceRecipe: string; sourcePage: number; sourcePosition: number; featured: boolean;
  pricesInCents: Record<PizzaSize, number>;
}
export interface PizzaCrust { id: string; name: string; source: 'PDF_PAGE_4' | 'USER_VALIDATED'; priceInCents: number | null }
export const categoryLabels: Record<PizzaCategory, string> = { TRADICIONAL: 'Tradicionais', ESPECIAL: 'Especiais', PREMIUM: 'Premium', DOCE: 'Doces' };
export const pizzaSizes = {
  BROTO: { label: 'Broto (4 fatias)', sourceName: 'Broto', slices: 4, compositions: ['WHOLE'] },
  GRANDE: { label: 'Grande (8 fatias)', sourceName: 'Tradicional', slices: 8, compositions: ['WHOLE', 'HALF_HALF'] },
} as const;
const ingredientNames = [
  'molho de tomate', 'atum', 'cebola', 'mussarela', 'tomate', 'azeitona', 'orégano', 'bacon',
  'calabresa', 'ovo', 'pimenta', 'presunto', 'brócolis', 'alho frito', 'requeijão', 'frango',
  'cheddar', 'milho', 'cream cheese', 'lombo', 'tomate cereja', 'manjericão', 'palmito', 'ervilha',
  'provolone', 'gorgonzola', 'carne seca', 'queijo coalho', 'melado de cana', 'costela desfiada',
  'cebola roxa', 'barbecue', 'batata palha', 'carne em tiras', 'molho strogonoff', 'cebolinha verde',
  'salmão', 'tarê', 'gergelim', 'rodelas de banana', 'cobertura de chocolate branco caramelizado',
  'cobertura de chocolate ao leite', 'granulado', 'morango', 'cobertura de chocolate branco',
  'M&M’s', 'biscoito negresco triturado', 'cobertura de leite ninho', 'leite em pó', 'ovomaltine',
] as const;
export const catalogId = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const ingredients: CatalogIngredient[] = ingredientNames.map(name => ({ id: catalogId(name), name }));
export const ingredientsById = Object.fromEntries(ingredients.map(ingredient => [ingredient.id, ingredient]));
// Columns: printed flavor name, ingredient names (verbatim tokens), Broto cents, Tradicional cents.
type Row = [string, string, number, number, string?];
const traditional: Row[] = [
  ['Atum', 'molho de tomate|atum|cebola|mussarela|tomate|azeitona|orégano', 4900, 7000],
  ['Bacon', 'molho de tomate|mussarela|bacon|tomate|azeitona|orégano', 5250, 7500],
  ['Baiana', 'molho de tomate|calabresa|ovo|cebola|pimenta|azeitona|orégano', 2800, 4000],
  ['Bauru', 'molho de tomate|presunto|mussarela|tomate|azeitona|orégano', 3850, 5500],
  ['Brócolis', 'molho de tomate|brócolis|mussarela|bacon|alho frito|azeitona|orégano', 4200, 6000],
  ['Calabacon', 'molho de tomate|mussarela|calabresa|bacon|azeitona|orégano', 4200, 6000],
  ['Calabresa', 'molho de tomate|calabresa|cebola|azeitona|orégano', 2800, 4000],
  ['Calabresa com Mussarela', 'molho de tomate|mussarela|calabresa|cebola|azeitona|orégano', 3500, 5000],
  ['Dois Queijos', 'molho de tomate|mussarela|requeijão|azeitona|orégano', 4550, 6500],
  ['Frango com Cheddar', 'molho de tomate|frango|mussarela|cheddar|azeitona|orégano', 4200, 6000],
  ['Frango com Requeijão', 'molho de tomate|frango|mussarela|requeijão|azeitona|orégano', 4200, 6000],
  ['Frango Cream Cheese', 'molho de tomate|frango|mussarela|milho|cream cheese|azeitona|orégano', 4550, 6500],
  ['Lombo', 'molho de tomate|mussarela|lombo|cebola|azeitona|orégano', 4200, 6000],
  ['Lombo com Requeijão', 'molho de tomate|mussarela|lombo|cebola|requeijão|azeitona|orégano', 4900, 7000],
  ['Marguerita', 'molho de tomate|mussarela|tomate cereja|manjericão|azeitona|orégano', 4550, 6500],
  ['Mussarela', 'molho de tomate|mussarela|tomate|azeitona|orégano', 4200, 6000],
  ['Palmito', 'molho de tomate|palmito|mussarela|tomate|azeitona|orégano', 4200, 6000],
  ['Palmito com Requeijão', 'molho de tomate|palmito|requeijão|tomate|azeitona|orégano', 4200, 6000],
  ['Paulista', 'molho de tomate|calabresa|requeijão|bacon|azeitona|orégano', 4200, 6000],
  ['Portuguesa', 'molho de tomate|presunto|ervilha|ovo|cebola|mussarela|tomate|azeitona|orégano', 3850, 5500],
  ['Quatro Queijos', 'molho de tomate|mussarela|requeijão|provolone|gorgonzola|azeitona|orégano', 4900, 7000],
];
const special: Row[] = [
  ['Brasileira', 'molho de tomate|atum|palmito|ovo|cebola|mussarela|azeitona|orégano', 4900, 7000],
  ['Calabresa Supreme', 'molho de tomate|calabresa|ovo|mussarela|bacon|azeitona|orégano', 4900, 7000],
  ['Calacheddar', 'molho de tomate|calabresa|cheddar|milho|cebola|bacon|azeitona|orégano', 4200, 6000],
  ['Carbonara', 'molho de tomate|mussarela|ovo|requeijão|bacon|azeitona|orégano', 4900, 7000],
  ['Carne Seca', 'molho de tomate|carne seca|cebola|mussarela|azeitona|orégano', 4900, 7000],
  ['Carne Seca com Requeijão', 'molho de tomate|carne seca|requeijão|cebola|mussarela|azeitona|orégano', 5250, 7500],
  ['Coalho com Melado de Cana', 'molho de tomate|mussarela|queijo coalho|melado de cana', 4200, 6000],
  ['Corn Bacon', 'molho de tomate|mussarela|milho|bacon|azeitona|orégano', 5250, 7500],
  ['Costela', 'molho de tomate|costela desfiada|cebola|mussarela|azeitona|orégano', 5250, 7500],
  ['Costela com Barbecue', 'molho de tomate|mussarela|costela desfiada|cream cheese|cebola roxa|barbecue|azeitona|orégano', 5600, 8000],
  ['Costela com Requeijão', 'molho de tomate|costela desfiada|cebola roxa|requeijão|mussarela|azeitona|orégano', 5950, 8500],
  ['Delícia', 'molho de tomate|palmito|ervilha|mussarela|bacon|tomate|azeitona|orégano', 4900, 7000],
  ['Do Pizzaiolo', 'molho de tomate|frango|presunto|requeijão|mussarela|azeitona|orégano', 4900, 7000],
  ['Frangalho', 'molho de tomate|frango|requeijão|mussarela|batata palha|alho frito|azeitona|orégano', 4550, 6500],
  ['Gostosona', 'molho de tomate|presunto|mussarela|calabresa|requeijão|provolone|tomate|azeitona|orégano', 4900, 7000],
  ['Maria Bonita', 'molho de tomate|calabresa|milho|ovo|requeijão|mussarela|bacon|azeitona|orégano', 5250, 7500],
  ['Moda da Casa', 'molho de tomate|mussarela|carne em tiras|queijo coalho|bacon|azeitona|orégano', 6300, 9000],
  ['Portuguesa Especial', 'molho de tomate|presunto|milho|ervilha|palmito|cebola|ovo|mussarela|bacon|tomate|azeitona|orégano', 4900, 7000],
  ['Strogonoff de Carne', 'molho de tomate|mussarela|molho strogonoff|carne em tiras|batata palha|azeitona|orégano', 5250, 7500],
  ['Vegetariana', 'molho de tomate|brócolis|palmito|milho|requeijão|provolone|tomate cereja|azeitona|orégano', 4200, 6000],
];
const premium: Row[] = [
  ['Brócolis Premium', 'molho de tomate|brócolis|cream cheese|mussarela|tomate cereja|bacon|alho frito|azeitona|orégano', 5250, 7500],
  ['Filé ao Alho', 'molho de tomate|mussarela|carne em tiras|requeijão|alho frito|azeitona|orégano', 5600, 8000],
  ['Filé Barbecue', 'molho de tomate|mussarela|carne em tiras|cream cheese|barbecue|azeitona|orégano', 5950, 8500],
  ['Filé Guig’s', 'molho de tomate|mussarela|carne em tiras|cebola roxa|cream cheese|tomate cereja|cebolinha verde|azeitona|orégano', 5950, 8500],
  ['Frango Premium', 'molho de tomate|frango|mussarela|bacon|cream cheese|azeitona|orégano', 5250, 7500],
  ['Quatro Queijos Premium', 'molho de tomate|mussarela|bacon|requeijão|queijo coalho|gorgonzola|azeitona|orégano', 5600, 8000],
  ['Salmão Cream Cheese', 'molho de tomate|mussarela|salmão|cream cheese|cebola roxa|tomate cereja', 6300, 9000],
  ['Temaki Atum', 'molho de tomate|mussarela|atum|cream cheese|tarê|gergelim|cebolinha verde', 5950, 8500],
  ['Temaki Salmão', 'molho de tomate|mussarela|salmão|cream cheese|tarê|gergelim|cebolinha verde', 6300, 9000],
];
const sweet: Row[] = [
  ['Banana Nevada', 'rodelas de banana|cobertura de chocolate branco caramelizado', 3500, 6000, 'rodelas de banana com cobertura de chocolate branco caramelizado'],
  ['Brigadeiro', 'cobertura de chocolate ao leite|granulado', 4000, 7000, 'cobertura de chocolate ao leite com granulado'],
  ['Chocolate ao Leite', 'cobertura de chocolate ao leite', 3500, 6000, 'cobertura de chocolate ao leite'],
  ['Chocolate ao Leite com Morango', 'cobertura de chocolate ao leite|morango', 4500, 8000, 'cobertura de chocolate ao leite com morango'],
  ['Chocolate Branco', 'cobertura de chocolate branco', 3500, 6000, 'cobertura de chocolate branco'],
  ['Chocolate Branco com Morango', 'cobertura de chocolate branco|morango', 4500, 8000, 'cobertura de chocolate branco com morango'],
  ['M&M’s', 'cobertura de chocolate ao leite|M&M’s', 4000, 7000, 'cobertura de chocolate ao leite com M&M’s'],
  ['Negresco', 'cobertura de chocolate branco|biscoito negresco triturado', 4000, 7000, 'cobertura de chocolate branco com biscoito negresco triturado'],
  ['Ninho', 'cobertura de leite ninho|leite em pó', 4000, 7000, 'cobertura de leite ninho com leite em pó'],
  ['Ovomaltine', 'cobertura de chocolate ao leite|ovomaltine', 4000, 7000, 'cobertura de chocolate ao leite com ovomaltine'],
];
export const featuredFlavorIds = ['file-guigs', 'portuguesa-especial', 'quatro-queijos-premium', 'strogonoff-de-carne', 'temaki-salmao'];
function categoryFlavors(rows: Row[], category: PizzaCategory, sourcePage: number): PizzaFlavor[] {
  return rows.map(([name, recipe, broto, grande, sourceRecipe], index) => {
    const names = recipe.split('|');
    const ingredientIds = names.map(catalogId);
    if (ingredientIds.some(id => !ingredientsById[id])) throw new Error(`Ingrediente não catalogado: ${name}`);
    const id = catalogId(name);
    return { id, name, category, ingredientIds, sourceRecipe: sourceRecipe ?? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`,
      sourcePage, sourcePosition: index + 1, featured: featuredFlavorIds.includes(id), pricesInCents: { BROTO: broto, GRANDE: grande } };
  });
}
export const pizzaFlavors: PizzaFlavor[] = [
  ...categoryFlavors(traditional, 'TRADICIONAL', 1), ...categoryFlavors(special, 'ESPECIAL', 2),
  ...categoryFlavors(premium, 'PREMIUM', 3), ...categoryFlavors(sweet, 'DOCE', 4),
];
export const flavorsById = Object.fromEntries(pizzaFlavors.map(flavor => [flavor.id, flavor]));
export const additionalIngredients = [
  ['cebola-roxa', 300], ['ovo', 300], ['pimenta', 300], ['cebola', 300], ['milho', 300], ['alho-frito', 300],
  ['palmito', 700], ['cheddar', 1000], ['requeijao', 1000], ['cream-cheese', 1500], ['bacon', 1500], ['mussarela', 1500],
].map(([id, price]) => ({ ingredientId: String(id), priceInCents: Number(price), sourcePage: 4 }));
export const pizzaCrusts: PizzaCrust[] = [
  { id: 'tradicional', name: 'Tradicional / sem recheio', source: 'USER_VALIDATED', priceInCents: null },
  { id: 'requeijao', name: 'Requeijão', source: 'PDF_PAGE_4', priceInCents: 1000 },
  { id: 'cheddar', name: 'Cheddar', source: 'PDF_PAGE_4', priceInCents: 1000 },
  { id: 'cream-cheese', name: 'Cream cheese', source: 'PDF_PAGE_4', priceInCents: 1500 },
  { id: 'chocolate-branco', name: 'Chocolate branco', source: 'PDF_PAGE_4', priceInCents: 2000 },
  { id: 'chocolate-ao-leite', name: 'Chocolate ao leite', source: 'PDF_PAGE_4', priceInCents: 2000 },
];
export const crustsById = Object.fromEntries(pizzaCrusts.map(crust => [crust.id, crust]));

// Editorial reprints reference the existing flavor; never create another recipe/entity.
export const favoriteReprints = featuredFlavorIds.map(flavorId => ({ flavorId, sourcePage: 3,
  sourceRecipe: flavorId === 'portuguesa-especial'
    ? 'molho de tomate, presunto, milho, ervilha, palmito, ovo, cebola, mussarela, bacon, tomate, azeitona e orégano'
    : flavorId === 'quatro-queijos-premium'
      ? 'molho de tomate, mussarela, requeijão, queijo coalho, gorgonzola, bacon, azeitona e orégano'
      : flavorsById[flavorId].sourceRecipe,
}));
export const catalogSource = {
  fileName: "Cardapio Guig's Vertical 2026.pdf", pages: 4,
  sha256: '533f14a1719bd4cd79866879a64e049374c1f0f6a0d98db5acfe8f1dbcb9d04d',
  halfHalfPricing: { standard: 'Pizzas meio a meio, prevalece o maior valor.', linkOrders: 'Pedidos pelo link, pizzas meio a meio terão o valor médio.' },
};
export const catalogReviews = [
  { id: 'featured-reprints', status: 'needs_review', detail: 'Favoritas repete cinco sabores. Portuguesa Especial e Quatro Queijos Premium mudam a ordem dos ingredientes, sem mudar o conjunto. Preservadas ambas as transcrições; receita operacional segue a categoria principal.' },
  { id: 'catupiry-not-listed', status: 'needs_review', detail: 'Catupiry aparece nos exemplos do pedido de desenvolvimento, mas não no PDF. Não cadastrado nem convertido em requeijão; confirmar se deve existir como exceção.' },
  { id: 'technical-quantities', status: 'needs_review', detail: 'O PDF não informa gramagens, sub-receitas de coberturas/molhos, tempos de forno ou quantidades dos adicionais por tamanho/metade. Nenhum desses dados foi inferido.' },
  { id: 'link-channel-pricing', status: 'needs_review', detail: 'O PDF distingue maior preço e média para pedidos pelo link, mas não define o mapeamento do link para os canais. Textos preservados; nenhum cálculo financeiro implementado.' },
  { id: 'traditional-crust-price', status: 'needs_review', detail: 'A borda tradicional/sem recheio foi solicitada explicitamente, mas não é listada no PDF. A opção identifica a origem USER_VALIDATED e mantém preço null, sem presumir gratuidade.' },
] as const;

// Bump this revision when any operational recipe/border data changes.
export const kitchenCatalogRevisionId = 'guigs-menu-2026-r1';
export const recipeCatalog: RecipeCatalog = {
  revisionId: kitchenCatalogRevisionId,
  flavors: flavorsById,
  ingredients: ingredientsById,
  crusts: Object.fromEntries(pizzaCrusts.map(crust => [crust.id, { id: crust.id, revisionId: kitchenCatalogRevisionId, name: crust.name, priceInCents: crust.priceInCents }])),
  additionalIngredientIds: additionalIngredients.map(item => item.ingredientId),
};
// Initial internal extras requested for the counter flow; not transcribed from the pizza PDF.
export const extraCatalogRevisionId = 'counter-extras-r1';
export const extraCatalog = [
  { id: 'coca-cola-2l', name: 'Coca-Cola 2L' },
  { id: 'molho-extra', name: 'Molho extra' },
  { id: 'sobremesa', name: 'Sobremesa' },
] as const;
