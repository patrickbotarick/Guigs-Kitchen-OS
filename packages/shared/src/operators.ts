import { z } from 'zod';

export const operatorPinSchema = z.string().regex(/^\d{4,8}$/, 'Digite um PIN de 4 a 8 números.');
export const operatorLoginSchema = z.object({ pin: operatorPinSchema, workstationDeviceKey: z.string().uuid() }).strict();
export type OperatorLoginInput = z.infer<typeof operatorLoginSchema>;
export const operatorSessionSchema = z.object({
  sessionId: z.string().min(1), operatorId: z.string().min(1), operatorName: z.string().min(1),
  workstationId: z.string().min(1), workstationName: z.string().min(1),
  startedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  available: z.boolean().default(true),
  role: z.enum(['ASSEMBLER', 'SUPERVISOR']).default('ASSEMBLER'),
  lastSeenAt: z.string().datetime().nullable().default(null),
  presenceStatus: z.enum(['ONLINE', 'STALE', 'OFFLINE']).default('OFFLINE'),
  heartbeatIntervalMs: z.number().int().positive().default(20000),
}).strict();
export const operatorAvailabilitySchema = z.object({ available: z.boolean() }).strict();
export type OperationalSession = z.infer<typeof operatorSessionSchema>;
export const operatorLoginResultSchema = z.object({ session: operatorSessionSchema, token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const supervisorRecoverySchema = z.object({
  command: z.enum(['SUPERVISOR_PAUSE', 'SUPERVISOR_RELEASE', 'SUPERVISOR_REASSIGN']),
  expectedState: z.enum(['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED']),
  expectedVersion: z.number().int().nonnegative(), clientCommandId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500), targetSessionId: z.string().cuid().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.command === 'SUPERVISOR_REASSIGN') !== Boolean(value.targetSessionId)) ctx.addIssue({ code: 'custom', path: ['targetSessionId'], message: 'Destino obrigatório somente na reatribuição.' });
});
export type SupervisorRecoveryInput = z.infer<typeof supervisorRecoverySchema>;
