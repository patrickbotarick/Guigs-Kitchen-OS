import { z } from 'zod';

export const productionSettingsSchema = z.object({
  stationKey: z.literal('PRODUCTION'), autoOvenEntry: z.boolean(), version: z.number().int().nonnegative(),
}).strict();
export type ProductionSettings = z.infer<typeof productionSettingsSchema>;
export const productionSettingsCommandSchema = z.object({
  command: z.literal('SET_AUTO_OVEN_ENTRY'), autoOvenEntry: z.boolean(),
  expectedVersion: z.number().int().nonnegative(), clientCommandId: z.string().uuid(),
}).strict();
export type ProductionSettingsCommand = z.infer<typeof productionSettingsCommandSchema>;
export const productionSettingsUpdatedSchema = z.object({
  eventId: z.string().uuid(), stationKey: z.literal('PRODUCTION'), version: z.number().int().nonnegative(), timestamp: z.string().datetime(),
}).strict();
export type ProductionSettingsUpdated = z.infer<typeof productionSettingsUpdatedSchema>;
