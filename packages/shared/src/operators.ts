import { z } from 'zod';

export const operatorPinSchema = z.string().regex(/^\d{4,8}$/, 'Digite um PIN de 4 a 8 números.');
export const operatorLoginSchema = z.object({ pin: operatorPinSchema, workstationDeviceKey: z.string().uuid() }).strict();
export type OperatorLoginInput = z.infer<typeof operatorLoginSchema>;
export const operatorSessionSchema = z.object({
  sessionId: z.string().min(1), operatorId: z.string().min(1), operatorName: z.string().min(1),
  workstationId: z.string().min(1), workstationName: z.string().min(1),
  startedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  available: z.boolean().default(true),
}).strict();
export const operatorAvailabilitySchema = z.object({ available: z.boolean() }).strict();
export type OperationalSession = z.infer<typeof operatorSessionSchema>;
export const operatorLoginResultSchema = z.object({ session: operatorSessionSchema, token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
