import type { Order, PizzaItem } from '@guigs/shared';
import { pizzaName } from '../kitchen/pizzaRecipe';
export type OvenEntry = { order: Order; pizza: PizzaItem };
export function ovenQueues(orders: Order[]) {
  const entries = orders.flatMap(order => order.items.flatMap(pizza => pizza.kind === 'PIZZA' ? [{ order, pizza }] : []));
  const waiting = entries.filter(({ pizza }) => pizza.production.state === 'WAITING_OVEN').sort((a, b) => Date.parse(a.pizza.production.assemblyCompletedAt ?? a.pizza.production.queuedAt) - Date.parse(b.pizza.production.assemblyCompletedAt ?? b.pizza.production.queuedAt) || a.order.number - b.order.number || a.pizza.position - b.pizza.position);
  const inside = entries.filter(({ pizza }) => pizza.production.state === 'IN_OVEN').sort((a, b) => Date.parse(a.pizza.production.ovenStartedAt!) - Date.parse(b.pizza.production.ovenStartedAt!) || a.order.number - b.order.number || a.pizza.position - b.pizza.position);
  return { waiting, inside };
}
export function ovenFlavor(pizza: PizzaItem) { return pizzaName({ ...pizza.recipe, snapshot: pizza.snapshot }); }
export function elapsedSeconds(start: string, now: number) { return Math.max(0, Math.floor((now - Date.parse(start)) / 1000)); }
export function formatDuration(seconds: number) { const value = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
export function ovenTiming(pizza: PizzaItem, now: number) {
  const start = pizza.production.ovenStartedAt, expected = pizza.production.ovenExpectedEndAt;
  const elapsed = start ? elapsedSeconds(start, now) : 0;
  const duration = start && expected ? Math.max(1, Math.round((Date.parse(expected) - Date.parse(start)) / 1000)) : null;
  const phase: 'NORMAL' | 'NEAR' | 'REACHED' | 'OVER' = duration === null || elapsed < duration * 0.8 ? 'NORMAL' : elapsed < duration ? 'NEAR' : elapsed < duration + 60 ? 'REACHED' : 'OVER';
  return { elapsed, duration, phase, ratio: duration ? Math.min(1, elapsed / duration) : 0 };
}
