import type { AssemblyOrder, OrderChannel, PizzaDraft, PizzaItem, SimulatedOrderInput } from './types';
import { createPizzaDraft, validatePizzaDraft } from './pizzaRecipe';

export function createMockOrder(number: number, input: SimulatedOrderInput, receivedAt: string): AssemblyOrder {
  if (!input.customerName.trim() || input.customerName.trim().length > 120
    || !['IFOOD', 'WHATSAPP', 'PICKUP', 'COUNTER'].includes(input.channel)
    || !Array.isArray(input.pizzas) || input.pizzas.length < 1 || input.pizzas.length > 30
    || !Number.isInteger(input.extraCount) || input.extraCount < 0 || input.extraCount > 30) {
    throw new Error('Informe cliente, canal, 1 a 30 pizzas e 0 a 30 extras.');
  }
  const id = `demo-order-${number}`;
  const pizzas: PizzaItem[] = input.pizzas.map((draft, index) => {
    validatePizzaDraft(draft);
    return {
      ...structuredClone(draft), id: `${id}-pizza-${index + 1}`, kind: 'PIZZA',
      status: 'WAITING', paused: false,
    };
  });
  return {
    id, number, customerName: input.customerName.trim(), channel: input.channel, receivedAt,
    items: pizzas, extraCount: input.extraCount,
  };
}

export function createDemoOrders(now: number): AssemblyOrder[] {
  const channels: OrderChannel[] = ['IFOOD', 'WHATSAPP', 'PICKUP', 'IFOOD', 'WHATSAPP'];
  const customers = ['Mariana Costa', 'Rafael Lima', 'Ana Souza', 'Lucas Martins', 'João Santos'];
  const scenarios: PizzaDraft[] = [
    { ...createPizzaDraft('calabresa'), crustId: 'requeijao', firstHalf: { flavorId: 'calabresa', modifiers: [{ type: 'REMOVE', ingredientId: 'cebola' }, { type: 'ADD', ingredientId: 'bacon' }] }, notes: 'Bem assada' },
    { size: 'GRANDE', composition: 'HALF_HALF', firstHalf: { flavorId: 'calabresa', modifiers: [] }, secondHalf: { flavorId: 'portuguesa', modifiers: [] }, crustId: 'cheddar', notes: null },
    { ...createPizzaDraft('mussarela'), size: 'BROTO' },
  ];
  return channels.map((channel, index) => createMockOrder(1001 + index, {
    customerName: customers[index], channel, pizzas: index === 0 ? scenarios : Array.from({ length: (index % 3) + 1 }, () => createPizzaDraft()),
    extraCount: index === 0 ? 3 : index % 3,
  }, new Date(now - (15 - index * 2) * 60_000).toISOString()));
}
