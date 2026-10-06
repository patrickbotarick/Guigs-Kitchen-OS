// Temporary generic reference only; no recipe-specific baking time is asserted.
export function ovenConfiguration() {
  const defaultOvenMinutes = Number(process.env.OVEN_DEFAULT_MINUTES || 7);
  if (!Number.isFinite(defaultOvenMinutes) || defaultOvenMinutes <= 0 || defaultOvenMinutes > 240) throw new Error('OVEN_DEFAULT_MINUTES deve ser maior que zero e até 240.');
  const capacityValue = process.env.OVEN_CAPACITY?.trim();
  const ovenCapacity = capacityValue ? Number(capacityValue) : null;
  if (ovenCapacity !== null && (!Number.isSafeInteger(ovenCapacity) || ovenCapacity <= 0)) throw new Error('OVEN_CAPACITY deve ser um inteiro positivo ou vazio (sem limite configurado).');
  return { defaultOvenMinutes, ovenCapacity, serverTime: new Date().toISOString() };
}
